-- Kestrel P3: the extension sends leads and search progress to the team.
-- Run once: node scripts/run-sql.mjs supabase/migrations/004_extension_sync.sql  (safe to run again)
--
-- How the extension signs in: in the App (Connections) a team member clicks "Connect the extension".
-- The App makes a random connection key and hands it to the extension. The database keeps only a SHA-256
-- fingerprint of the key, never the key itself. The key can only add or update this team's leads and
-- progress through the ext_* functions below; it cannot read leads, members or anything else.
-- Remove a key any time (App → Connections → Disconnect): it stops working at once.

create table if not exists public.extension_keys (
  id           uuid primary key default gen_random_uuid(),
  team_id      uuid not null references public.teams (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  label        text not null default 'Kestrel extension',
  key_hash     text not null unique,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);
alter table public.extension_keys enable row level security;
drop policy if exists "people see their own extension keys" on public.extension_keys;
create policy "people see their own extension keys" on public.extension_keys for select to authenticated using (user_id = auth.uid());
-- Nobody reads the fingerprints or writes this table directly (Supabase grants new tables to everyone by default).
revoke all on public.extension_keys from anon, authenticated;
grant select (id, team_id, user_id, label, created_at, last_used_at) on public.extension_keys to authenticated;

-- Search progress shared by the team: one row per search (keyword × place × mode), the same keys the extension uses.
create table if not exists public.progress (
  team_id    uuid not null references public.teams (id) on delete cascade,
  key        text not null,
  status     text not null check (status in ('done', 'partial')),
  found      integer, saved integer,
  by_user    uuid references auth.users (id) on delete set null,
  at         timestamptz not null default now(),
  primary key (team_id, key)
);
alter table public.progress enable row level security;
drop policy if exists "team reads its progress" on public.progress;
create policy "team reads its progress" on public.progress for select to authenticated using (public.is_member(team_id));
revoke all on public.progress from anon, authenticated;
grant select on public.progress to authenticated;

-- Make a connection key (shown once, to hand to the extension). Viewers cannot connect an extension.
create or replace function public.create_extension_key(label text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  m   members;
  raw text := 'kst_' || encode(extensions.gen_random_bytes(24), 'hex');
begin
  select * into m from members where user_id = auth.uid() order by joined_at limit 1;
  if m.user_id is null then raise exception 'Not signed in'; end if;
  if m.role = 'viewer' then raise exception 'Viewers cannot connect an extension'; end if;
  insert into extension_keys (team_id, user_id, label, key_hash)
  values (m.team_id, m.user_id, left(coalesce(nullif(trim(label), ''), 'Kestrel extension'), 60), encode(extensions.digest(raw, 'sha256'), 'hex'));
  return raw;
end $$;

create or replace function public.remove_extension_key(key_id uuid) returns void
language sql security definer set search_path = public as $$
  delete from extension_keys where id = key_id and user_id = auth.uid();
$$;

-- Finds the key's owner and team (and notes when it was last used). Internal helper.
create or replace function public.ext_owner(k text) returns extension_keys
language plpgsql security definer set search_path = public, extensions as $$
declare r extension_keys;
begin
  select * into r from extension_keys where key_hash = encode(extensions.digest(coalesce(k, ''), 'sha256'), 'hex');
  if r.id is null then raise exception 'This connection key is not valid any more. Connect the extension again from the App.'; end if;
  if not exists (select 1 from members where team_id = r.team_id and user_id = r.user_id and role <> 'viewer') then
    raise exception 'This account can no longer add leads to the team.';
  end if;
  update extension_keys set last_used_at = now() where id = r.id;
  return r;
end $$;

-- Who am I (for the extension's Connections card).
create or replace function public.ext_whoami(k text) returns json
language plpgsql security definer set search_path = public as $$
declare r extension_keys;
begin
  r := ext_owner(k);
  return (select json_build_object('team', t.name, 'email', u.email) from teams t, auth.users u where t.id = r.team_id and u.id = r.user_id);
end $$;

-- Add or update leads (at most 500 per call). One lead per business per team (dedupe_key), as in the App.
create or replace function public.ext_push_leads(k text, rows jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare r extension_keys; n integer;
begin
  r := ext_owner(k);
  if jsonb_typeof(rows) <> 'array' or jsonb_array_length(rows) > 500 then raise exception 'Send between 1 and 500 leads at a time'; end if;
  insert into leads (team_id, dedupe_key, name, category, location, source, email, phone, website, verdict, reason, score, tier, hiring, named, sample, data, created_by)
  select r.team_id, x.dedupe_key, x.name, x.category, x.location, x.source, x.email, x.phone, x.website,
         case when x.verdict in ('Good', 'Maybe', 'No') then x.verdict end, x.reason, x.score, x.tier,
         coalesce(x.hiring, false), coalesce(x.named, false), false, coalesce(x.data, '{}'::jsonb), r.user_id
  from jsonb_to_recordset(rows) as x(dedupe_key text, name text, category text, location text, source text, email text, phone text, website text,
       verdict text, reason text, score numeric, tier text, hiring boolean, named boolean, data jsonb)
  where coalesce(x.dedupe_key, '') <> ''
  on conflict (team_id, dedupe_key) do update set
    name = excluded.name, category = excluded.category, location = excluded.location, source = excluded.source,
    email = excluded.email, phone = excluded.phone, website = excluded.website, verdict = excluded.verdict, reason = excluded.reason,
    score = excluded.score, tier = excluded.tier, hiring = excluded.hiring, named = excluded.named, data = excluded.data;
  get diagnostics n = row_count;
  return n;
end $$;

-- Search progress: send finished or part-done searches, and read the whole team's progress.
create or replace function public.ext_push_progress(k text, rows jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare r extension_keys; n integer;
begin
  r := ext_owner(k);
  insert into progress (team_id, key, status, found, saved, by_user, at)
  select r.team_id, x.key, x.status, x.found, x.saved, r.user_id, coalesce(x.at, now())
  from jsonb_to_recordset(rows) as x(key text, status text, found integer, saved integer, at timestamptz)
  where coalesce(x.key, '') <> '' and x.status in ('done', 'partial')
  on conflict (team_id, key) do update set
    status = case when progress.status = 'done' then 'done' else excluded.status end,
    found = greatest(coalesce(progress.found, 0), coalesce(excluded.found, 0)),
    saved = greatest(coalesce(progress.saved, 0), coalesce(excluded.saved, 0)),
    by_user = excluded.by_user, at = greatest(progress.at, excluded.at);
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.ext_pull_progress(k text) returns json
language plpgsql security definer set search_path = public as $$
declare r extension_keys;
begin
  r := ext_owner(k);
  return coalesce((select json_object_agg(p.key, json_build_object('status', p.status, 'found', p.found, 'saved', p.saved, 'at', (extract(epoch from p.at) * 1000)::bigint))
                   from progress p where p.team_id = r.team_id), '{}'::json);
end $$;

revoke all on function public.ext_owner(text) from public, anon, authenticated;
revoke all on function public.create_extension_key(text), public.remove_extension_key(uuid) from public, anon;
grant execute on function public.create_extension_key(text), public.remove_extension_key(uuid) to authenticated;
revoke all on function public.ext_whoami(text), public.ext_push_leads(text, jsonb), public.ext_push_progress(text, jsonb), public.ext_pull_progress(text) from public;
grant execute on function public.ext_whoami(text), public.ext_push_leads(text, jsonb), public.ext_push_progress(text, jsonb), public.ext_pull_progress(text) to anon, authenticated;

notify pgrst, 'reload schema';
