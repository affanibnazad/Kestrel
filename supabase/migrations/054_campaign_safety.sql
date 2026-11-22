-- 054: campaign safety, from Affan's first real campaign (Batch 001 feedback, 18 Nov 2026). Safe to run twice.
--   1. campaign_deletions: every deleted campaign is recorded (who, when, how many leads and sends). restore_campaign()
--      brings back a deleted draft (no leads yet) within 30 days. Campaigns that had leads lose their sending history
--      on delete (016, cascade), so they are listed but cannot be restored.
--   2. start_campaign (053's) says why it refuses: deleted, another team, plan ended, or role.
--   3. email_steps_problem (039's) no longer blocks "per month / per video / per hour / per minute" on their own:
--      "How many videos do you edit per month?" is not a price. Money amounts and price words are still blocked.
--   4. campaign_set_accounts(): change the sending accounts of a draft, running or paused campaign. Leads whose first
--      email has not gone yet are shared out again over the new accounts; leads already emailed keep their account,
--      so follow-ups stay in the same thread.

-- ---------- 1. deleted campaigns
create table if not exists public.campaign_deletions (
  campaign_id uuid primary key,
  team_id     uuid not null,                 -- no foreign key: a team being deleted removes its campaigns too
  name        text not null,
  status      text not null,
  snapshot    jsonb not null,
  leads       integer not null default 0,
  sent        integer not null default 0,
  deleted_by  uuid,
  deleted_at  timestamptz not null default now()
);
create index if not exists campaign_deletions_team on public.campaign_deletions (team_id, deleted_at desc);
alter table public.campaign_deletions enable row level security;
revoke all on public.campaign_deletions from public, anon, authenticated;
grant select (campaign_id, team_id, name, status, leads, sent, deleted_by, deleted_at) on public.campaign_deletions to authenticated;
drop policy if exists "team reads its deleted campaigns" on public.campaign_deletions;
create policy "team reads its deleted campaigns" on public.campaign_deletions for select to authenticated using (public.is_member(team_id));

create or replace function public.campaign_log_delete() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into campaign_deletions as d (campaign_id, team_id, name, status, snapshot, leads, sent, deleted_by)
  values (old.id, old.team_id, old.name, old.status, to_jsonb(old),
          (select count(*) from campaign_leads cl where cl.campaign_id = old.id),
          (select count(*) from campaign_leads cl where cl.campaign_id = old.id and cl.first_sent_at is not null), auth.uid())
  on conflict (campaign_id) do update set name = excluded.name, status = excluded.status, snapshot = excluded.snapshot, leads = excluded.leads,
    sent = excluded.sent, deleted_by = excluded.deleted_by, deleted_at = now();
  -- Keep the log short: 90 days per team.
  delete from campaign_deletions x where x.team_id = old.team_id and x.deleted_at < now() - interval '90 days';
  return old;
end $$;
revoke all on function public.campaign_log_delete() from public, anon, authenticated;
drop trigger if exists campaigns_log_delete on public.campaigns;
create trigger campaigns_log_delete before delete on public.campaigns for each row execute function public.campaign_log_delete();

-- Who deleted it, as a name or email the team can read (members only).
create or replace function public.campaign_deletions_list() returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object('campaign_id', d.campaign_id, 'name', d.name, 'status', d.status, 'leads', d.leads, 'sent', d.sent,
    'deleted_at', d.deleted_at, 'deleted_by', coalesce(nullif(u.raw_user_meta_data ->> 'full_name', ''), u.email, 'Kestrel (automatic)'),
    'can_restore', d.leads = 0 and d.deleted_at > now() - interval '30 days') order by d.deleted_at desc), '[]'::json)
  from campaign_deletions d left join auth.users u on u.id = d.deleted_by
  where public.is_member(d.team_id) and d.team_id = public.my_team_id(false) and d.deleted_at > now() - interval '90 days';
$$;
revoke all on function public.campaign_deletions_list() from public, anon;
grant execute on function public.campaign_deletions_list() to authenticated;

create or replace function public.restore_campaign(campaign uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare d campaign_deletions; c campaigns; nm text;
begin
  select * into d from campaign_deletions where campaign_id = campaign;
  if d.campaign_id is null or not public.is_member(d.team_id) then raise exception 'Deleted campaign not found'; end if;
  if not public.can_edit(d.team_id) then raise exception 'Your role or plan cannot restore campaigns'; end if;
  if d.leads > 0 then raise exception 'Only campaigns that never had leads (drafts) can be restored: its leads and sending history were deleted with it. Make a new campaign instead.'; end if;
  if d.deleted_at < now() - interval '30 days' then raise exception 'Deleted more than 30 days ago: it can no longer be restored'; end if;
  c := jsonb_populate_record(null::campaigns, d.snapshot);
  nm := c.name;
  if exists (select 1 from campaigns x where x.team_id = d.team_id and x.name = nm) then nm := left(c.name, 68) || ' (restored)'; end if;
  insert into campaigns select (jsonb_populate_record(null::campaigns, d.snapshot || jsonb_build_object(
    'name', nm, 'status', 'draft', 'started_at', null,
    'sequence_id', case when exists (select 1 from sequences s where s.id = c.sequence_id and s.team_id = d.team_id) then c.sequence_id end,
    'mailbox_ids', coalesce((select jsonb_agg(m.id) from mailboxes m where m.id = any (c.mailbox_ids) and m.team_id = d.team_id), '[]'::jsonb)))).*;
  delete from campaign_deletions where campaign_id = campaign;
  return campaign;
end $$;
revoke all on function public.restore_campaign(uuid) from public, anon;
grant execute on function public.restore_campaign(uuid) to authenticated;

-- ---------- 2. start_campaign with clear reasons
create or replace function public.start_campaign(campaign uuid, lead_ids uuid[]) returns json
language plpgsql security definer set search_path = public as $$
declare c campaigns; boxes uuid[]; added integer := 0; n integer; skip jsonb;
begin
  select * into c from campaigns where id = campaign;
  -- 054: say why, instead of one 'Campaign not found' for four different cases (Affan's Batch 001 feedback, #1).
  if c.id is null then raise exception 'Campaign not found. It may have been deleted: see Campaigns → Recently deleted.'; end if;
  if not public.is_member(c.team_id) then raise exception 'This campaign is not in the team you are signed in to. Check which account you signed in with.'; end if;
  if not public.team_active(c.team_id) then raise exception 'PLAN_NEEDED: Your free trial or plan has ended. Choose a plan in Plan and billing to start campaigns.'; end if;
  if not public.can_edit(c.team_id) then raise exception 'Your role cannot start campaigns. Ask the team owner.'; end if;
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

-- ---------- 3. price words: "per month" on its own is not a price
create or replace function public.email_steps_problem(steps jsonb) returns text
language plpgsql immutable set search_path = public as $$
declare s jsonb; txt text; i integer := 0;
begin
  if jsonb_typeof(steps) <> 'array' then return null; end if;
  for s in select value from jsonb_array_elements(steps) loop
    i := i + 1;
    continue when coalesce(s ->> 'kind', 'email') <> 'email';
    txt := coalesce(s ->> 'subject', '') || E'\n' || coalesce(s ->> 'body', '');
    if txt !~* '(not interested|reply (with )?["''“]?no\M|unsubscribe|opt[- ]?out|rather not|won''?t (email|contact|write)|remove you|no more emails)' then
      return format('email %s has no opt-out line', i);
    end if;
    if txt ~ '\[[A-Z][A-Z_]{2,}\]' or txt ~ '\{\{|\}\}' then return format('email %s still has an empty merge field', i); end if;
    if txt ~* '[$€£¥][[:space:]]?[0-9]|\m[0-9]+([.,][0-9]+)?[[:space:]]?(usd|eur|gbp|dollars?|euros?|pounds?)\M' then
      return format('email %s mentions a money amount', i);
    end if;
    if txt ~* '\m(price|prices|pricing|priced|fee|fees|rate card|invoice|payment|payments|discount|cheap|cheapest|affordable|trial|free trial|for free|free work|free sample|free test|no charge|money back|refund)\M'
       or txt ~* '% off' then
      return format('email %s has price or payment words', i);
    end if;
  end loop;
  return null;
end $$;
revoke all on function public.email_steps_problem(jsonb) from public, anon, authenticated;

-- ---------- 4. change the sending accounts of a campaign
create or replace function public.campaign_set_accounts(campaign uuid, account_ids uuid[]) returns json
language plpgsql security definer set search_path = public as $$
declare c campaigns; boxes uuid[]; n integer; moved integer := 0;
begin
  select * into c from campaigns where id = campaign;
  if c.id is null or not public.is_member(c.team_id) then raise exception 'Campaign not found'; end if;
  if not public.can_edit(c.team_id) then raise exception 'Your role or plan cannot change campaigns'; end if;
  if c.status not in ('draft', 'running', 'paused') then raise exception 'A stopped or finished campaign cannot change its accounts'; end if;
  if c.status <> 'draft' and public.my_team_id(true) is distinct from c.team_id then raise exception 'Only the owner or a manager can change a sending campaign'; end if;
  if coalesce(cardinality(account_ids), 0) = 0 then raise exception 'Choose at least one email account'; end if;
  if exists (select 1 from unnest(account_ids) b where not exists (select 1 from mailboxes m where m.id = b and m.team_id = c.team_id)) then
    raise exception 'That email account belongs to another team';
  end if;
  select array_agg(m.id order by m.created_at) into boxes from mailboxes m where m.id = any (account_ids) and m.team_id = c.team_id and m.status = 'ok' and m.imap_ok is true;
  if c.status <> 'draft' and boxes is null then raise exception 'Choose at least one account whose sending and reading tests both passed'; end if;
  update campaigns set mailbox_ids = (select array_agg(distinct b) from unnest(account_ids) b) where id = c.id;
  if c.status = 'draft' then return json_build_object('ok', true, 'moved', 0, 'test_needed', true); end if;
  update campaigns set tested_at = c.tested_at where id = c.id;   -- a started campaign keeps its test
  n := array_length(boxes, 1);
  with x as (select cl.id, row_number() over (order by cl.next_at, cl.id) rn from campaign_leads cl
             where cl.campaign_id = c.id and cl.status = 'active' and cl.first_sent_at is null)
  update campaign_leads cl set mailbox_id = boxes[1 + ((x.rn - 1) % n)] from x where cl.id = x.id;
  get diagnostics moved = row_count;
  return json_build_object('ok', true, 'moved', moved, 'test_needed', false);
end $$;
revoke all on function public.campaign_set_accounts(uuid, uuid[]) from public, anon;
grant execute on function public.campaign_set_accounts(uuid, uuid[]) to authenticated;

notify pgrst, 'reload schema';
