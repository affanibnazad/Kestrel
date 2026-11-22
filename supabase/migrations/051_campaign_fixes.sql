-- Kestrel 051: campaign fixes from the UX audit (17 Nov 2026, rows 1–4, 22).
--   * A stopped campaign that sent nothing can go back to Not started (reopen_campaign), keeping its settings.
--   * Duplicate a campaign (duplicate_campaign); the copy keeps the test when the sequence and email accounts are the same.
--   * A test counts for a campaign when another campaign of the team with the same sequence and the same email accounts
--     was tested in the last 30 days (a copy of a tested campaign no longer needs a new test).
--   * Start records which leads were skipped and why (campaigns.skipped), and never queues the same email twice.
--   * Stop records who stopped the campaign and when.
--   * Leads keep a short history of verdict changes (data.verdict_log, last 20), so conflicting verdicts show (row 15).
-- Run once: node scripts/run-sql.mjs supabase/migrations/051_campaign_fixes.sql  (safe to run again)

alter table public.campaigns add column if not exists stopped_at timestamptz;
alter table public.campaigns add column if not exists stopped_by uuid references auth.users (id) on delete set null;
alter table public.campaigns add column if not exists skipped jsonb;
-- (select on campaigns is already granted to members; these columns are written only by the functions below)

-- Is a test valid for this campaign? Its own test, or a recent test of the same sequence + the same email accounts.
create or replace function public.campaign_test_ok(c public.campaigns) returns boolean
language sql stable security definer set search_path = public as $$
  select c.tested_at is not null or (c.sequence_id is not null and exists (
    select 1 from campaigns o where o.team_id = c.team_id and o.id <> c.id and o.sequence_id = c.sequence_id
      and o.tested_at > now() - interval '30 days'
      and (select array_agg(x order by x) from unnest(o.mailbox_ids) x) = (select array_agg(x order by x) from unnest(c.mailbox_ids) x)));
$$;
revoke all on function public.campaign_test_ok(public.campaigns) from public, anon, authenticated;

-- Which of these leads Start would queue, and the reason for every one it would not.
create or replace function public.campaign_pick(c public.campaigns, lead_ids uuid[])
returns table (id uuid, name text, email text, steps jsonb, reason text)
language sql stable security definer set search_path = public as $$
  with asked as (select distinct x as id from unnest(lead_ids) x),
  picked as (
    select a.id, l.name, lower(trim(l.email)) as email, l.id is not null as found,
      coalesce(case when jsonb_typeof(l.data #> '{outreach,steps}') = 'array' and jsonb_array_length(l.data #> '{outreach,steps}') > 0 then l.data #> '{outreach,steps}' end,
        case when length(coalesce(l.data #>> '{outreach,body}', '')) > 0
          then jsonb_build_array(jsonb_build_object('day', 0, 'subject', coalesce(l.data #>> '{outreach,subject}', ''), 'body', l.data #>> '{outreach,body}')) end) as steps
    from asked a left join leads l on l.id = a.id and l.team_id = c.team_id
  ),
  judged as (
    select p.*, case
      when not p.found then 'Lead not found'
      when p.email is null or p.email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then 'No valid email'
      when p.steps is null then 'No written email'
      when not public.sequence_steps_ok(p.steps) then 'Its written email has a problem (open the lead and rewrite it)'
      when public.email_steps_problem(p.steps) is not null then 'Written email: ' || public.email_steps_problem(p.steps)
      when public.dnc_blocks_email(c.team_id, p.email) then 'On Do-not-contact'
      when exists (select 1 from campaign_leads x join campaigns y on y.id = x.campaign_id
                   where x.to_email = p.email and x.team_id = c.team_id and x.status = 'active' and y.status in ('running', 'paused') and y.id <> c.id)
        then 'Already in another running campaign'
    end as why,
    row_number() over (partition by lower(trim(p.email)) order by p.id) as dup
    from picked p
  )
  select j.id, j.name, j.email, j.steps,
    coalesce(j.why, case when j.email is not null and j.dup > 1 then 'Same email as another lead in this campaign' end)
  from judged j;
$$;
revoke all on function public.campaign_pick(public.campaigns, uuid[]) from public, anon, authenticated;

-- Start (same rules as 018, plus: the shared test, the skipped list, no duplicate emails).
create or replace function public.start_campaign(campaign uuid, lead_ids uuid[]) returns json
language plpgsql security definer set search_path = public as $$
declare c campaigns; boxes uuid[]; added integer := 0; n integer; skip jsonb;
begin
  select * into c from campaigns where id = campaign;
  if c.id is null or not public.can_edit(c.team_id) then raise exception 'Campaign not found'; end if;
  if public.my_team_id(true) is distinct from c.team_id then raise exception 'Only the owner or a manager can start a campaign'; end if;
  if c.status <> 'draft' then raise exception 'This campaign has already started (use Resume)'; end if;
  if not public.campaign_test_ok(c) then raise exception 'Send a test to yourself first'; end if;
  select array_agg(m.id order by m.created_at) into boxes from mailboxes m where m.id = any (c.mailbox_ids) and m.team_id = c.team_id and m.status = 'ok' and m.imap_ok is true;
  if boxes is null then raise exception 'Choose at least one mailbox whose sending and reading tests both passed'; end if;
  n := array_length(boxes, 1);
  if coalesce(array_length(lead_ids, 1), 0) > 5000 then raise exception 'At most 5,000 leads in one campaign'; end if;

  with ok as (
    select p.*, row_number() over (order by p.id) as rn from public.campaign_pick(c, lead_ids) p where p.reason is null
  ), ins as (
    insert into campaign_leads (campaign_id, team_id, lead_id, mailbox_id, to_email, lead_name, steps, next_at)
    select c.id, c.team_id, ok.id, boxes[1 + ((ok.rn - 1) % n)], ok.email, ok.name, ok.steps, now() from ok
    on conflict (campaign_id, lead_id) do nothing
    returning 1
  ) select count(*) into added from ins;
  select coalesce(jsonb_agg(jsonb_build_object('lead_id', p.id, 'name', p.name, 'email', p.email, 'reason', p.reason)), '[]'::jsonb)
    into skip from (select * from public.campaign_pick(c, lead_ids) p where p.reason is not null limit 1000) p;
  if added = 0 and not exists (select 1 from campaign_leads x where x.campaign_id = c.id) then
    raise exception 'No leads could be added: each needs an email and a written email, must not be on Do-not-contact and not already in another running campaign';
  end if;
  update campaigns set status = 'running', started_at = coalesce(started_at, now()), tested_at = coalesce(tested_at, now()), skipped = skip where id = c.id;
  return json_build_object('added', added, 'skipped', jsonb_array_length(skip), 'skipped_leads', skip);
end $$;
revoke all on function public.start_campaign(uuid, uuid[]) from public, anon;
grant execute on function public.start_campaign(uuid, uuid[]) to authenticated;

-- Stop: also who and when.
create or replace function public.stop_campaign(campaign uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c campaigns;
begin
  select * into c from campaigns where id = campaign;
  if c.id is null or not public.can_block(c.team_id) then raise exception 'Campaign not found'; end if;
  update campaigns set status = 'stopped', stopped_at = now(), stopped_by = auth.uid() where id = c.id and status in ('draft', 'running', 'paused');
  update campaign_leads set status = 'stopped', next_at = null where campaign_id = c.id and status = 'active';
end $$;
revoke all on function public.stop_campaign(uuid) from public, anon;
grant execute on function public.stop_campaign(uuid) to authenticated;

-- Back to Not started, only when not a single email went out. Keeps the name, settings and test.
create or replace function public.reopen_campaign(campaign uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c campaigns;
begin
  select * into c from campaigns where id = campaign;
  if c.id is null or not public.can_edit(c.team_id) or public.my_team_id(true) is distinct from c.team_id then raise exception 'Campaign not found'; end if;
  if c.status <> 'stopped' then raise exception 'Only a stopped campaign can be reopened'; end if;
  if exists (select 1 from campaign_leads x where x.campaign_id = c.id and x.first_sent_at is not null)
     or exists (select 1 from mail_events e where e.campaign_id = c.id and e.kind = 'sent') then
    raise exception 'Emails were already sent from this campaign. Use Duplicate to start a new one.';
  end if;
  delete from campaign_leads where campaign_id = c.id;
  update campaigns set status = 'draft', started_at = null, stopped_at = null, stopped_by = null, paused_reason = null, skipped = null where id = c.id;
end $$;
revoke all on function public.reopen_campaign(uuid) from public, anon;
grant execute on function public.reopen_campaign(uuid) to authenticated;

-- A copy with the same settings, Not started. The test carries over (same sequence and email accounts).
create or replace function public.duplicate_campaign(campaign uuid, new_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare c campaigns; nid uuid; nm text := left(trim(coalesce(new_name, '')), 80);
begin
  select * into c from campaigns where id = campaign;
  if c.id is null or not public.can_edit(c.team_id) then raise exception 'Campaign not found'; end if;
  if nm = '' then raise exception 'Give the copy a name'; end if;
  insert into campaigns (team_id, name, sequence_id, mailbox_ids, time_zone, window_start, window_end, weekdays_only, track_opens, verify_emails, lead_time_zone, stop_company, tested_at)
  values (c.team_id, nm, c.sequence_id, c.mailbox_ids, c.time_zone, c.window_start, c.window_end, c.weekdays_only, c.track_opens, c.verify_emails, c.lead_time_zone, c.stop_company, c.tested_at)
  returning id into nid;
  return nid;
exception when unique_violation then raise exception 'A campaign with that name already exists';
end $$;
revoke all on function public.duplicate_campaign(uuid, text) from public, anon;
grant execute on function public.duplicate_campaign(uuid, text) to authenticated;

-- ---------- verdict history on each lead (Good / Maybe / No changes), newest last, at most 20
create or replace function public.lead_verdict_log() returns trigger
language plpgsql security definer set search_path = public as $$
declare log jsonb; who text;
begin
  if new.verdict is not distinct from old.verdict then return new; end if;
  who := case when (new.data -> 'ai' ->> 'at') is distinct from (old.data -> 'ai' ->> 'at') then coalesce(new.data -> 'ai' ->> 'by', 'AI') else 'by hand' end;
  log := coalesce(new.data -> 'verdict_log', old.data -> 'verdict_log', '[]'::jsonb);
  if jsonb_typeof(log) <> 'array' then log := '[]'::jsonb; end if;
  log := log || jsonb_build_array(jsonb_build_object('from', old.verdict, 'to', new.verdict, 'at', now(), 'by', who));
  if jsonb_array_length(log) > 20 then
    select coalesce(jsonb_agg(e order by o), '[]'::jsonb) into log from jsonb_array_elements(log) with ordinality as x(e, o) where o > jsonb_array_length(log) - 20;
  end if;
  new.data := jsonb_set(coalesce(new.data, '{}'::jsonb), '{verdict_log}', log);
  return new;
end $$;
revoke all on function public.lead_verdict_log() from public, anon, authenticated;
drop trigger if exists leads_verdict_log on public.leads;
create trigger leads_verdict_log before update of verdict on public.leads for each row execute function public.lead_verdict_log();

notify pgrst, 'reload schema';
