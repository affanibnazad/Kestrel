-- 052: delete leads for good (Affan, 18 Nov 2026). Until now leads could only be Removed (hidden, can be put back).
--   delete_leads(ids)  deletes leads that are already in Removed, for people who can edit the team (active teams only,
--                      like every other lead change). Campaign history stays (campaign_leads.lead_id → null, from 016);
--                      list entries go with the lead (005, on delete cascade).
--   deleted_leads      remembers each deleted business by its duplicate key, so the extension's next sync (or
--                      "Send All Leads Now") does not add it back. A deliberate CSV import or backup upload in the App
--                      still brings it back; after that the extension updates it again as normal.
-- Do-not-contact is a separate list and is not touched. Safe to run twice.

create table if not exists public.deleted_leads (
  team_id    uuid not null references public.teams (id) on delete cascade,
  dedupe_key text not null,
  name       text,
  deleted_by uuid references auth.users (id) on delete set null,
  deleted_at timestamptz not null default now(),
  primary key (team_id, dedupe_key)
);
alter table public.deleted_leads enable row level security;
revoke all on public.deleted_leads from public, anon, authenticated;
grant select on public.deleted_leads to authenticated;
drop policy if exists "team reads its deleted leads" on public.deleted_leads;
create policy "team reads its deleted leads" on public.deleted_leads for select to authenticated using (public.is_member(team_id));

create or replace function public.delete_leads(ids uuid[]) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if ids is null or cardinality(ids) = 0 then return 0; end if;
  if cardinality(ids) > 1000 then raise exception 'Delete up to 1000 leads at a time'; end if;
  -- Only leads already in Removed, in teams this person can edit (can_edit = right role + active team).
  insert into deleted_leads as d (team_id, dedupe_key, name, deleted_by)
  select l.team_id, l.dedupe_key, left(l.name, 200), auth.uid()
  from leads l
  where l.id = any(ids) and l.status = 'removed' and coalesce(l.dedupe_key, '') <> '' and public.can_edit(l.team_id)
  on conflict (team_id, dedupe_key) do update set name = excluded.name, deleted_by = excluded.deleted_by, deleted_at = now();
  delete from leads l where l.id = any(ids) and l.status = 'removed' and public.can_edit(l.team_id);
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.delete_leads(uuid[]) from public, anon;
grant execute on function public.delete_leads(uuid[]) to authenticated;

-- 042's ext_push_leads, unchanged except one line: a business the team deleted for good is not added back by the
-- extension. If the App brought it back on purpose (a row with that key exists again), the extension updates it.
create or replace function public.ext_push_leads(k text, rows jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare r extension_keys; n integer;
begin
  r := ext_owner(k);
  if jsonb_typeof(rows) <> 'array' or jsonb_array_length(rows) > 500 then raise exception 'Send between 1 and 500 leads at a time'; end if;
  insert into leads as l (team_id, dedupe_key, name, category, location, source, email, phone, website, verdict, reason, score, tier, hiring, named, sample, data, created_by)
  select r.team_id, x.dedupe_key, x.name, x.category, x.location, x.source, x.email, x.phone, x.website,
         case when x.verdict in ('Good', 'Maybe', 'No') then x.verdict end, x.reason, x.score, x.tier,
         coalesce(x.hiring, false), coalesce(x.named, false), false, coalesce(x.data, '{}'::jsonb), r.user_id
  from jsonb_to_recordset(rows) as x(dedupe_key text, name text, category text, location text, source text, email text, phone text, website text,
       verdict text, reason text, score numeric, tier text, hiring boolean, named boolean, data jsonb)
  where coalesce(x.dedupe_key, '') <> ''
    and (not exists (select 1 from deleted_leads d where d.team_id = r.team_id and d.dedupe_key = x.dedupe_key)
         or exists (select 1 from leads e where e.team_id = r.team_id and e.dedupe_key = x.dedupe_key))
  on conflict (team_id, dedupe_key) do update set
    name = excluded.name, category = excluded.category, location = excluded.location, source = excluded.source,
    email = coalesce(l.email, excluded.email), phone = coalesce(excluded.phone, l.phone), website = coalesce(excluded.website, l.website),
    verdict = coalesce(l.verdict, excluded.verdict), reason = case when l.verdict is not null then l.reason else excluded.reason end,
    score = case when l.email is not null and excluded.email is null then l.score else excluded.score end,
    tier = case when l.email is not null and excluded.email is null then l.tier else excluded.tier end,
    hiring = excluded.hiring, named = l.named or excluded.named,
    data = excluded.data
      || case when l.email is not null and excluded.email is null
           then jsonb_strip_nulls(jsonb_build_object('email', l.data -> 'email', 'emails', l.data -> 'emails', 'emailKind', l.data -> 'emailKind', 'contacts', l.data -> 'contacts'))
           else '{}'::jsonb end
      || jsonb_strip_nulls(jsonb_build_object('ai', l.data -> 'ai', 'outreach', l.data -> 'outreach', 'ap', l.data -> 'ap',
           'hunterAt', l.data -> 'hunterAt', 'foundBy', l.data -> 'foundBy'));
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.ext_push_leads(text, jsonb) from public;
grant execute on function public.ext_push_leads(text, jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
