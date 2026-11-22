-- Kestrel: profile and team details, team keys (encrypted in Supabase Vault), and team lists.
-- Run once: node scripts/run-sql.mjs supabase/migrations/005_profile_keys_lists.sql  (safe to run again)

-- ---------- profile and team details
create or replace function public.update_my_profile(name text, job text) returns void
language sql security definer set search_path = public as $$
  update members set full_name = left(nullif(trim(name), ''), 80), job_title = left(nullif(trim(job), ''), 80) where user_id = auth.uid();
$$;

create or replace function public.update_team(name text, site text, size text, place text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update teams set name = coalesce(left(nullif(trim(update_team.name), ''), 80), teams.name), website = left(nullif(trim(site), ''), 200),
         team_size = left(nullif(trim(size), ''), 20), country = left(nullif(trim(place), ''), 80)
  where id = (select team_id from members where user_id = auth.uid() and role = 'owner' order by joined_at limit 1);
  if not found then raise exception 'Only the team owner can change the team details'; end if;
end $$;

-- ---------- team keys: data sources and AI, encrypted in Supabase Vault. Only owners and managers set them.
-- The App only ever sees the last four characters. Connected extensions of the team receive the keys.
create table if not exists public.team_keys (
  team_id    uuid not null references public.teams (id) on delete cascade,
  service    text not null check (service in ('companiesHouse', 'hunter', 'listenNotes', 'anthropic', 'openai', 'gemini', 'openrouter')),
  secret_id  uuid not null,
  last4      text,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (team_id, service)
);
alter table public.team_keys enable row level security;
revoke all on public.team_keys from anon, authenticated;

create or replace function public.my_team_id(manage boolean) returns uuid
language sql stable security definer set search_path = public as $$
  select team_id from members where user_id = auth.uid() and (not manage or role in ('owner', 'manager')) order by joined_at limit 1;
$$;

create or replace function public.set_team_key(service text, value text) returns void
language plpgsql security definer set search_path = public, vault as $$
declare t uuid := public.my_team_id(true); v text := trim(coalesce(value, '')); old uuid;
begin
  if t is null then raise exception 'Only the owner or a manager can change keys'; end if;
  if length(v) < 8 or length(v) > 400 then raise exception 'That does not look like a key'; end if;
  select secret_id into old from team_keys k where k.team_id = t and k.service = set_team_key.service;
  if old is not null then
    perform vault.update_secret(old, v);
    update team_keys k set last4 = right(v, 4), updated_by = auth.uid(), updated_at = now() where k.team_id = t and k.service = set_team_key.service;
  else
    insert into team_keys (team_id, service, secret_id, last4, updated_by)
    values (t, set_team_key.service, vault.create_secret(v, 'kestrel:' || t || ':' || set_team_key.service || ':' || gen_random_uuid(), 'Kestrel team key'), right(v, 4), auth.uid());
  end if;
end $$;

create or replace function public.remove_team_key(service text) returns void
language plpgsql security definer set search_path = public, vault as $$
declare t uuid := public.my_team_id(true); old uuid;
begin
  if t is null then raise exception 'Only the owner or a manager can change keys'; end if;
  delete from team_keys k where k.team_id = t and k.service = remove_team_key.service returning secret_id into old;
  if old is not null then delete from vault.secrets where id = old; end if;
end $$;

create or replace function public.list_team_keys() returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object('service', service, 'last4', last4, 'updated_at', updated_at)), '[]'::json)
  from team_keys where team_id = public.my_team_id(false);
$$;

-- For a connected extension: the team's keys (decrypted), so it can use the same sources.
create or replace function public.ext_team_keys(k text) returns json
language plpgsql security definer set search_path = public, vault as $$
declare r extension_keys;
begin
  r := ext_owner(k);
  return coalesce((select json_object_agg(t.service, s.decrypted_secret) from team_keys t join vault.decrypted_secrets s on s.id = t.secret_id where t.team_id = r.team_id), '{}'::json);
end $$;

-- ---------- lists shared by the team
create table if not exists public.lists (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.teams (id) on delete cascade,
  name       text not null check (length(name) between 1 and 60),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (team_id, name)
);
create table if not exists public.list_leads (
  list_id uuid not null references public.lists (id) on delete cascade,
  lead_id uuid not null references public.leads (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  primary key (list_id, lead_id)
);
alter table public.lists enable row level security;
alter table public.list_leads enable row level security;
drop policy if exists "team reads lists" on public.lists;
create policy "team reads lists" on public.lists for select to authenticated using (public.is_member(team_id));
drop policy if exists "team adds lists" on public.lists;
create policy "team adds lists" on public.lists for insert to authenticated with check (public.can_edit(team_id));
drop policy if exists "team removes lists" on public.lists;
create policy "team removes lists" on public.lists for delete to authenticated using (public.can_edit(team_id));
drop policy if exists "team reads list leads" on public.list_leads;
create policy "team reads list leads" on public.list_leads for select to authenticated using (public.is_member(team_id));
drop policy if exists "team adds list leads" on public.list_leads;
create policy "team adds list leads" on public.list_leads for insert to authenticated
  with check (public.can_edit(team_id) and exists (select 1 from public.lists l where l.id = list_id and l.team_id = list_leads.team_id)
              and exists (select 1 from public.leads x where x.id = lead_id and x.team_id = list_leads.team_id));
drop policy if exists "team removes list leads" on public.list_leads;
create policy "team removes list leads" on public.list_leads for delete to authenticated using (public.can_edit(team_id));
revoke all on public.lists, public.list_leads from anon;
grant select, insert, delete on public.lists, public.list_leads to authenticated;

revoke all on function public.update_my_profile(text, text), public.update_team(text, text, text, text), public.set_team_key(text, text),
  public.remove_team_key(text), public.list_team_keys(), public.my_team_id(boolean) from public, anon;
grant execute on function public.update_my_profile(text, text), public.update_team(text, text, text, text), public.set_team_key(text, text),
  public.remove_team_key(text), public.list_team_keys() to authenticated;
revoke all on function public.ext_team_keys(text) from public;
grant execute on function public.ext_team_keys(text) to anon, authenticated;

notify pgrst, 'reload schema';
