-- Autopilot (and the Assistant) can add more leads to a campaign that is already sending or paused. Same rules as
-- start_campaign (018): owner or manager only; only email accounts whose sending and reading tests passed; each lead
-- needs an email and its written emails; never Do-not-contact; never a person already active in another running
-- campaign; at most 5,000 leads in one campaign. New leads start at once (inside the campaign's hours and limits).
-- Run once, after 034: node scripts/run-sql.mjs supabase/migrations/035_campaign_add_leads.sql  (safe to run again)

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
