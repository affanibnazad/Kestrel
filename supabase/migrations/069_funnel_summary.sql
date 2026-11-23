-- Kestrel 069: Funnel Bot & Daily Summary (Phase 4D, 19 Nov 2026).
-- Computes live funnel metrics per team (stuck leads, leads by stage, held emails, today's sending & replies),
-- and provides safe functions for authenticated team members and the Funnel Bot (server secret).
-- Run once: node scripts/run-sql.mjs supabase/migrations/069_funnel_summary.sql  (safe to run again)

-- Internal calculation function
create or replace function public.funnel_calc_summary(team uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_unreviewed integer;
  v_stuck_review integer;
  v_needs_email integer;
  v_needs_write integer;
  v_held_qc integer;
  v_ready_send integer;
  v_in_outreach integer;
  v_replied integer;
  v_meetings integer;
  v_won integer;
  v_won_val numeric;
  v_lost integer;
  v_campaigns_running integer;
  v_campaigns_paused integer;
  v_sent_today integer;
  v_replies_today integer;
  v_last_report timestamptz;
begin
  -- 1. Unreviewed leads (no verdict or empty)
  select count(*) into v_unreviewed from leads
  where team_id = team and coalesce(status, 'active') <> 'removed'
    and (verdict is null or verdict = '');

  -- 2. Stuck in review: created over 3 days ago with no verdict
  select count(*) into v_stuck_review from leads
  where team_id = team and coalesce(status, 'active') <> 'removed'
    and (verdict is null or verdict = '')
    and created_at < (now() - interval '3 days');

  -- 3. Needs email: marked Good but no email found
  select count(*) into v_needs_email from leads
  where team_id = team and coalesce(status, 'active') <> 'removed'
    and verdict = 'Good' and (email is null or trim(email) = '');

  -- 4. Needs write: marked Good, has email, but no outreach written yet
  select count(*) into v_needs_write from leads
  where team_id = team and coalesce(status, 'active') <> 'removed'
    and verdict = 'Good' and email is not null and trim(email) <> ''
    and (data->'outreach' is null or (data->'outreach')::text = '{}');

  -- 5. Held by QC: emails where QC status is 'hold'
  select count(*) into v_held_qc from leads
  where team_id = team and coalesce(status, 'active') <> 'removed'
    and coalesce(data#>>'{outreach,qc,status}', '') = 'hold';

  -- 6. Ready to send: Good fit, has email, outreach written, QC not held, not in any campaign yet
  select count(*) into v_ready_send from leads l
  where l.team_id = team and coalesce(l.status, 'active') <> 'removed'
    and l.verdict = 'Good' and l.email is not null and trim(l.email) <> ''
    and l.data->'outreach' is not null and (l.data->'outreach')::text <> '{}'
    and coalesce(l.data#>>'{outreach,qc,status}', '') <> 'hold'
    and not exists (select 1 from campaign_leads cl where cl.lead_id = l.id and cl.team_id = team);

  -- 7. In outreach: active in running/paused campaigns
  select count(distinct cl.lead_id) into v_in_outreach from campaign_leads cl
  where cl.team_id = team and cl.status in ('active', 'done') and cl.lead_id is not null;

  -- 8. Replied: leads that replied
  select count(distinct cl.lead_id) into v_replied from campaign_leads cl
  where cl.team_id = team and cl.status = 'replied' and cl.lead_id is not null;

  -- 9. Pipeline outcomes (Meeting, Won, Lost)
  select count(*) into v_meetings from leads
  where team_id = team and coalesce(status, 'active') <> 'removed'
    and coalesce(data#>>'{result,stage}', '') = 'meeting';

  select count(*), coalesce(sum(coalesce((data#>>'{result,value}')::numeric, 0)), 0)
  into v_won, v_won_val from leads
  where team_id = team and coalesce(status, 'active') <> 'removed'
    and coalesce(data#>>'{result,stage}', '') = 'won';

  select count(*) into v_lost from leads
  where team_id = team and coalesce(status, 'active') <> 'removed'
    and coalesce(data#>>'{result,stage}', '') = 'lost';

  -- 10. Campaigns
  select count(*) into v_campaigns_running from campaigns where team_id = team and status = 'running';
  select count(*) into v_campaigns_paused from campaigns where team_id = team and status = 'paused';

  -- 11. Today's activity (since UTC midnight)
  select count(*) into v_sent_today from campaign_leads
  where team_id = team and first_sent_at >= date_trunc('day', now() at time zone 'UTC');

  select count(*) into v_replies_today from campaign_leads
  where team_id = team and status = 'replied' and next_at >= date_trunc('day', now() at time zone 'UTC');

  -- 12. Last funnel report
  select max(created_at) into v_last_report from bot_messages
  where team_id = team and author = 'funnel' and kind = 'report';

  return jsonb_build_object(
    'unreviewed', v_unreviewed,
    'stuck_review', v_stuck_review,
    'needs_email', v_needs_email,
    'needs_write', v_needs_write,
    'held_qc', v_held_qc,
    'ready_send', v_ready_send,
    'in_outreach', v_in_outreach,
    'replied', v_replied,
    'meetings', v_meetings,
    'won', v_won,
    'won_value', round(v_won_val, 2),
    'lost', v_lost,
    'campaigns_running', v_campaigns_running,
    'campaigns_paused', v_campaigns_paused,
    'sent_today', v_sent_today,
    'replies_today', v_replies_today,
    'last_report_at', v_last_report
  );
end $$;
revoke all on function public.funnel_calc_summary(uuid) from public, anon, authenticated;

-- For authenticated team members
create or replace function public.funnel_summary(team uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_member(team) then raise exception 'Not a team member'; end if;
  return public.funnel_calc_summary(team);
end $$;
revoke all on function public.funnel_summary(uuid) from public, anon;
grant execute on function public.funnel_summary(uuid) to authenticated;

-- For server secret (Autopilot tick / Funnel bot)
create or replace function public.funnel_summary_for_server(server_secret text, team uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.mail_server_ok(server_secret) then raise exception 'Not allowed'; end if;
  return public.funnel_calc_summary(team);
end $$;
revoke all on function public.funnel_summary_for_server(text, uuid) from public, anon, authenticated;
grant execute on function public.funnel_summary_for_server(text, uuid) to anon, authenticated;

-- Helper to format human-readable daily report message
create or replace function public.funnel_format_report(summary jsonb, is_daily boolean default true)
returns text
language plpgsql immutable as $$
declare
  t text;
  prefix text;
begin
  prefix := case when is_daily then 'Daily funnel report: ' else 'Funnel report: ' end;
  t := prefix || (summary->>'sent_today') || ' sent today, ' ||
       (summary->>'replied') || ' total replies, ' ||
       (summary->>'meetings') || ' meeting' || case when (summary->>'meetings')::int = 1 then '' else 's' end || '. ' ||
       (summary->>'ready_send') || ' lead' || case when (summary->>'ready_send')::int = 1 then '' else 's' end || ' ready to send. ';

  if (summary->>'held_qc')::int > 0 then
    t := t || (summary->>'held_qc') || ' email' || case when (summary->>'held_qc')::int = 1 then '' else 's' end || ' held by QC. ';
  end if;

  if (summary->>'stuck_review')::int > 0 then
    t := t || (summary->>'stuck_review') || ' lead' || case when (summary->>'stuck_review')::int = 1 then '' else 's' end || ' waiting in To review for 3+ days. ';
  end if;

  t := t || '@you';
  return t;
end $$;
revoke all on function public.funnel_format_report(jsonb, boolean) from public, anon, authenticated;
grant execute on function public.funnel_format_report(jsonb, boolean) to anon, authenticated;

-- Post daily report once per 20 hours (server secret)
create or replace function public.funnel_post_daily_report(server_secret text, team uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  summary jsonb;
  report_text text;
  has_recent boolean;
begin
  if not public.mail_server_ok(server_secret) then raise exception 'Not allowed'; end if;

  select exists (
    select 1 from bot_messages
    where team_id = team and author = 'funnel' and kind = 'report'
      and created_at > (now() - interval '20 hours')
  ) into has_recent;

  if has_recent then
    return jsonb_build_object('posted', false, 'reason', 'already_posted_recently');
  end if;

  summary := public.funnel_calc_summary(team);
  report_text := public.funnel_format_report(summary, true);

  insert into bot_messages (team_id, author, mentions, kind, text, meta)
  values (team, 'funnel', array['you'], 'report', report_text, summary);

  return jsonb_build_object('posted', true, 'text', report_text, 'summary', summary);
end $$;
revoke all on function public.funnel_post_daily_report(text, uuid) from public, anon, authenticated;
grant execute on function public.funnel_post_daily_report(text, uuid) to anon, authenticated;

-- On-demand report requested by a team member in the App
create or replace function public.funnel_request_report(team uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  summary jsonb;
  report_text text;
begin
  if not public.can_edit(team) then raise exception 'Not allowed'; end if;

  summary := public.funnel_calc_summary(team);
  report_text := public.funnel_format_report(summary, false);

  insert into bot_messages (team_id, author, mentions, kind, text, meta)
  values (team, 'funnel', array['you'], 'report', report_text, summary);

  return jsonb_build_object('posted', true, 'text', report_text, 'summary', summary);
end $$;
revoke all on function public.funnel_request_report(uuid) from public, anon;
grant execute on function public.funnel_request_report(uuid) to authenticated;

notify pgrst, 'reload schema';
