-- Kestrel 068: the QC bot's hold (Phase 4C, 19 Nov 2026). After the Writer writes an email, the QC bot checks it and the
-- Writer fixes it; an email QC still finds a problem in is saved with outreach.qc.status = 'hold'. Campaigns leave it out
-- (Start and Add leads) until a person approves it in the App (status 'approved') or it is written again.
-- Only these two functions change: each is the same as before plus the hold check.
-- Run once: node scripts/run-sql.mjs supabase/migrations/068_qc_hold.sql  (safe to run again)

create or replace function public.campaign_pick(c public.campaigns, lead_ids uuid[])
returns table (id uuid, name text, email text, steps jsonb, reason text)
language sql stable security definer set search_path = public as $$
  with asked as (select distinct x as id from unnest(lead_ids) x),
  picked as (
    select a.id, l.name, lower(trim(l.email)) as email, l.id is not null as found,
      coalesce(case when jsonb_typeof(l.data #> '{outreach,steps}') = 'array' and jsonb_array_length(l.data #> '{outreach,steps}') > 0 then l.data #> '{outreach,steps}' end,
        case when length(coalesce(l.data #>> '{outreach,body}', '')) > 0
          then jsonb_build_array(jsonb_build_object('day', 0, 'subject', coalesce(l.data #>> '{outreach,subject}', ''), 'body', l.data #>> '{outreach,body}')) end) as steps,
      coalesce(l.data #>> '{outreach,qc,status}', '') = 'hold' as held
    from asked a left join leads l on l.id = a.id and l.team_id = c.team_id
  ),
  judged as (
    select p.*, case
      when not p.found then 'Lead not found'
      when p.email is null or p.email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then 'No valid email'
      when p.steps is null then 'No written email'
      when not public.sequence_steps_ok(p.steps) then 'Its written email has a problem (open the lead and rewrite it)'
      when public.email_steps_problem(p.steps) is not null then 'Written email: ' || public.email_steps_problem(p.steps)
      when p.held then 'Held by the QC bot (open the lead: approve or rewrite the email)'
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

create or replace function public.campaign_add_leads(campaign uuid, lead_ids uuid[]) returns json
language plpgsql security definer set search_path = public as $$
declare c campaigns; boxes uuid[]; added integer := 0; n integer; have integer;
begin
  select * into c from campaigns where id = campaign;
  if c.id is null or not public.can_edit(c.team_id) then raise exception 'Campaign not found'; end if;
  if public.my_team_id(true) is distinct from c.team_id then raise exception 'Only the owner or a manager can add leads to a campaign'; end if;
  if c.status not in ('running', 'paused') then raise exception 'Add leads to a campaign that is sending or paused (start a new one with Start)'; end if;
  select array_agg(m.id order by m.created_at) into boxes from mailboxes m where m.id = any (c.mailbox_ids) and m.team_id = c.team_id and m.status = 'ok' and m.imap_ok is true;
  if boxes is null then raise exception 'This campaign has no email account whose sending and reading tests both passed'; end if;
  n := array_length(boxes, 1);
  select count(*) into have from campaign_leads x where x.campaign_id = c.id;
  if have + coalesce(array_length(lead_ids, 1), 0) > 5000 then raise exception 'At most 5,000 leads in one campaign'; end if;

  with picked as (
    select l.id, l.name, lower(trim(l.email)) as email,
      coalesce(case when jsonb_typeof(l.data #> '{outreach,steps}') = 'array' and jsonb_array_length(l.data #> '{outreach,steps}') > 0 then l.data #> '{outreach,steps}' end,
        case when length(coalesce(l.data #>> '{outreach,body}', '')) > 0
          then jsonb_build_array(jsonb_build_object('day', 0, 'subject', coalesce(l.data #>> '{outreach,subject}', ''), 'body', l.data #>> '{outreach,body}')) end) as steps
    from leads l where l.id = any (lead_ids) and l.team_id = c.team_id
      and coalesce(l.data #>> '{outreach,qc,status}', '') <> 'hold'   -- 068: held by the QC bot
  ), ok as (
    select p.*, row_number() over (order by p.id) as rn from picked p
    where p.email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and p.steps is not null and public.sequence_steps_ok(p.steps)
      and not public.dnc_blocks_email(c.team_id, p.email)
      and not exists (select 1 from campaign_leads x join campaigns y on y.id = x.campaign_id
                      where x.to_email = p.email and x.team_id = c.team_id and x.status = 'active' and y.status in ('running', 'paused') and y.id <> c.id)
  ), ins as (
    insert into campaign_leads (campaign_id, team_id, lead_id, mailbox_id, to_email, lead_name, steps, next_at)
    select c.id, c.team_id, ok.id, boxes[1 + ((have + ok.rn - 1) % n)], ok.email, ok.name, ok.steps, now() from ok
    on conflict (campaign_id, lead_id) do nothing
    returning 1
  ) select count(*) into added from ins;
  return json_build_object('added', added, 'skipped', coalesce(array_length(lead_ids, 1), 0) - added);
end $$;
revoke all on function public.campaign_add_leads(uuid, uuid[]) from public, anon;
grant execute on function public.campaign_add_leads(uuid, uuid[]) to authenticated;

notify pgrst, 'reload schema';
