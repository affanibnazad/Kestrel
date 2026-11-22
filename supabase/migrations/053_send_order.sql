-- 053: first emails go out in the order chosen in the App (Affan, 18 Nov 2026: "choose which 10 start first, then the
-- next day batch by batch"). start_campaign is 051's, with two changes:
--   1. leads are numbered in the order of lead_ids (the App sends the marked "Send first" leads first), not by id;
--   2. each lead's first email is due 1 ms after the one before, so the sender (mail_due: order by next_step desc,
--      next_at) works through them in that order. Mailboxes still take turns (lead 1 → account 1, lead 2 → account 2…).
-- No table changes. Safe to run twice.

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
    select p.*, row_number() over (order by coalesce(array_position(lead_ids, p.id), 2147483647), p.id) as rn from public.campaign_pick(c, lead_ids) p where p.reason is null
  ), ins as (
    insert into campaign_leads (campaign_id, team_id, lead_id, mailbox_id, to_email, lead_name, steps, next_at)
    select c.id, c.team_id, ok.id, boxes[1 + ((ok.rn - 1) % n)], ok.email, ok.name, ok.steps, now() + (ok.rn - 1) * interval '1 millisecond' from ok
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

notify pgrst, 'reload schema';
