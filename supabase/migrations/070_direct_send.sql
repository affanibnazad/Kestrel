-- Migration 070: Direct Send (Phase 5, 19 Nov 2026)
-- Allows sending a single email directly to a lead without creating or scheduling a campaign.

-- 1. Ensure a "Direct Outreach" system campaign exists for the team
create or replace function public.ensure_direct_campaign(p_team_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_campaign_id uuid;
begin
  select id into v_campaign_id from public.campaigns where team_id = p_team_id and name = 'Direct Outreach' limit 1;
  if v_campaign_id is null then
    insert into public.campaigns (team_id, name, status, daily_limit, schedule)
    values (p_team_id, 'Direct Outreach', 'active', 50, '{"from": 0, "to": 24, "days": [0,1,2,3,4,5,6]}')
    returning id into v_campaign_id;
  end if;
  return v_campaign_id;
end $$;

-- 2. Prepare a direct send: verifies auth, DNC, resolves mailbox and registers the campaign_lead entry
create or replace function public.mail_direct_prepare(
  server_secret text,
  p_lead_id uuid,
  p_to_email text,
  p_subject text,
  p_body text,
  p_mailbox_id uuid default null
) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_team_id uuid := public.my_team_id(true);
  v_campaign_id uuid;
  v_mailbox_id uuid := p_mailbox_id;
  v_cl_id uuid;
  v_to text := lower(trim(p_to_email));
  v_lead_name text;
begin
  if not public.mail_server_ok(server_secret) then raise exception 'Not allowed'; end if;
  if v_team_id is null then raise exception 'Only team members can send email'; end if;
  if v_to = '' or v_to not like '%@%.%' then raise exception 'Invalid recipient email address'; end if;

  -- Check team Do-not-contact list
  if exists (select 1 from public.team_dnc where team_id = v_team_id and (entry = v_to or entry = split_part(v_to, '@', 2))) then
    raise exception 'This email address is on your team''s Do-not-contact list.';
  end if;

  -- Select mailbox if not specified: pick first ready mailbox under limit
  if v_mailbox_id is null then
    select id into v_mailbox_id from public.mailboxes
    where team_id = v_team_id and status = 'ok'
    order by created_at limit 1;
  end if;
  if v_mailbox_id is null then
    raise exception 'No ready email account found. Connect and test a mailbox in Email accounts first.';
  end if;

  select name into v_lead_name from public.leads where id = p_lead_id;

  v_campaign_id := public.ensure_direct_campaign(v_team_id);

  -- Upsert into campaign_leads for timeline tracking
  insert into public.campaign_leads (
    campaign_id, team_id, lead_id, mailbox_id, to_email, lead_name, steps, next_step, status, first_sent_at
  ) values (
    v_campaign_id, v_team_id, p_lead_id, v_mailbox_id, v_to, coalesce(v_lead_name, 'Lead'),
    jsonb_build_array(jsonb_build_object('day', 0, 'subject', trim(p_subject), 'body', trim(p_body))),
    1, 'done', now()
  )
  on conflict (campaign_id, lead_id) do update set
    mailbox_id = v_mailbox_id,
    to_email = v_to,
    steps = jsonb_build_array(jsonb_build_object('day', 0, 'subject', trim(p_subject), 'body', trim(p_body))),
    next_step = 1,
    status = 'done',
    first_sent_at = now()
  returning id into v_cl_id;

  return json_build_object(
    'ok', true,
    'campaign_lead_id', v_cl_id,
    'mailbox_id', v_mailbox_id,
    'campaign_id', v_campaign_id
  );
end $$;

-- 3. Mark direct send complete and record mail_events
create or replace function public.mail_direct_sent(
  server_secret text,
  p_cl_id uuid,
  p_message_id text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_cl public.campaign_leads;
begin
  if not public.mail_server_ok(server_secret) then raise exception 'Not allowed'; end if;
  select * into v_cl from public.campaign_leads where id = p_cl_id;
  if v_cl.id is null then return; end if;

  insert into public.mail_events (
    team_id, campaign_id, campaign_lead_id, mailbox_id, step, kind, detail, message_id, at
  ) values (
    v_cl.team_id, v_cl.campaign_id, v_cl.id, v_cl.mailbox_id, 0, 'sent', 'Direct send from lead panel', p_message_id, now()
  );

  update public.leads set updated_at = now() where id = v_cl.lead_id;
end $$;

grant execute on function public.ensure_direct_campaign(uuid) to authenticated;
grant execute on function public.mail_direct_prepare(text, uuid, text, text, text, uuid) to authenticated;
grant execute on function public.mail_direct_sent(text, uuid, text) to authenticated;
