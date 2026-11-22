-- Kestrel Assistant on any AI, personal for each person.
-- 1. Included AI (Kestrel pays): the Owner panel chooses the company (Claude, ChatGPT, Gemini, OpenRouter) and model.
--    Kestrel's Claude key stays where 023 put it; Kestrel's other keys go in assistant_kestrel_keys (Vault).
-- 2. Each person chooses: Kestrel's included AI, or their team's own key (from Connections) for any AI company and model.
-- 3. Each person: "About me" and an answer style, and short facts the Assistant remembers (they can see and delete them).
-- Keys are read only by the App's server (needs Kestrel's server secret). Nothing here is visible to other teams.
-- Run once, after 026: node scripts/run-sql.mjs supabase/migrations/027_assistant_any_ai.sql  (safe to run again; only adds)

-- ---------- 1. included AI: company + model, and Kestrel's keys for the other companies
alter table public.assistant_settings add column if not exists provider text not null default 'anthropic'
  check (provider in ('anthropic', 'openai', 'gemini', 'openrouter'));
alter table public.assistant_settings drop constraint if exists assistant_settings_model_check;
alter table public.assistant_settings drop constraint if exists assistant_settings_model_ok;
alter table public.assistant_settings add constraint assistant_settings_model_ok check (
  (provider = 'anthropic' and model in ('auto', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'))
  or (provider <> 'anthropic' and length(model) between 1 and 120 and model ~ '^[A-Za-z0-9._:/-]+$'));

create table if not exists public.assistant_kestrel_keys (
  provider   text primary key check (provider in ('openai', 'gemini', 'openrouter')),
  secret_id  uuid not null,
  last4      text,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);
alter table public.assistant_kestrel_keys enable row level security;
revoke all on public.assistant_kestrel_keys from anon, authenticated;

create or replace function public.set_assistant_provider_key(provider text, value text) returns void
language plpgsql security definer set search_path = public, vault as $$
declare v text := trim(coalesce(value, '')); old uuid;
begin
  if not public.is_admin() then raise exception 'Only Kestrel admins can change the Assistant keys'; end if;
  if provider not in ('openai', 'gemini', 'openrouter') then raise exception 'Unknown AI company'; end if;
  if length(v) < 16 or length(v) > 400 or v ~ '\s' then raise exception 'That does not look like an API key'; end if;
  select secret_id into old from assistant_kestrel_keys k where k.provider = set_assistant_provider_key.provider;
  if old is not null then
    perform vault.update_secret(old, v);
    update assistant_kestrel_keys k set last4 = right(v, 4), updated_at = now(), updated_by = auth.uid() where k.provider = set_assistant_provider_key.provider;
  else
    insert into assistant_kestrel_keys (provider, secret_id, last4, updated_by)
    values (set_assistant_provider_key.provider, vault.create_secret(v, 'kestrel:assistant-key:' || set_assistant_provider_key.provider || ':' || gen_random_uuid(), 'Kestrel Assistant key'), right(v, 4), auth.uid());
  end if;
end $$;

create or replace function public.remove_assistant_provider_key(provider text) returns void
language plpgsql security definer set search_path = public, vault as $$
declare old uuid;
begin
  if not public.is_admin() then raise exception 'Only Kestrel admins can change the Assistant keys'; end if;
  delete from assistant_kestrel_keys k where k.provider = remove_assistant_provider_key.provider returning secret_id into old;
  if old is not null then delete from vault.secrets where id = old; end if;
end $$;

-- The included AI company and model (admins). Claude models are checked by the table; others by name shape.
create or replace function public.set_assistant_provider(provider text, model text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only Kestrel admins can change the Assistant'; end if;
  update assistant_settings s set provider = set_assistant_provider.provider, model = trim(set_assistant_provider.model), updated_at = now(), updated_by = auth.uid() where s.id;
end $$;

-- The on/off switch (and Claude model) from 024, now also for a non-Claude included AI: any model name is checked by the table.
create or replace function public.set_assistant_options(model text, enabled boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only Kestrel admins can change the Assistant'; end if;
  if (select s.provider from assistant_settings s where s.id) = 'anthropic'
     and set_assistant_options.model not in ('auto', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5') then raise exception 'Unknown model'; end if;
  update assistant_settings s set model = set_assistant_options.model, enabled = set_assistant_options.enabled, updated_at = now(), updated_by = auth.uid() where s.id;
end $$;
revoke all on function public.set_assistant_options(text, boolean) from public, anon;
grant execute on function public.set_assistant_options(text, boolean) to authenticated;

-- What the Owner panel shows about the included AI (never a key).
create or replace function public.assistant_admin_providers() returns json
language sql stable security definer set search_path = public as $$
  select case when not public.is_admin() then null else json_build_object(
    'provider', (select s.provider from assistant_settings s where s.id),
    'model', (select s.model from assistant_settings s where s.id),
    'claude_key', (select s.secret_id is not null from assistant_settings s where s.id),
    'keys', coalesce((select json_agg(json_build_object('provider', k.provider, 'last4', k.last4, 'updated_at', k.updated_at)) from assistant_kestrel_keys k), '[]'::json)) end;
$$;

-- For the App's server only: the included AI's company, model, switch and key.
create or replace function public.assistant_included(server_secret text) returns json
language plpgsql stable security definer set search_path = public, vault as $$
declare s assistant_settings; k text;
begin
  if not public.mail_server_ok(server_secret) then raise exception 'Not allowed'; end if;
  select * into s from assistant_settings where id;
  if coalesce(s.provider, 'anthropic') = 'anthropic' then
    if s.secret_id is not null then select decrypted_secret into k from vault.decrypted_secrets where id = s.secret_id; end if;
  else
    select d.decrypted_secret into k from assistant_kestrel_keys x join vault.decrypted_secrets d on d.id = x.secret_id where x.provider = s.provider;
  end if;
  return json_build_object('provider', coalesce(s.provider, 'anthropic'), 'model', coalesce(s.model, 'auto'), 'enabled', coalesce(s.enabled, true), 'key', k);
end $$;

-- For the App's server only: the signed-in person's team key for an AI company (people who can work on leads,
-- teams with an active plan or trial). Never returned to a browser.
create or replace function public.assistant_team_key(server_secret text, service text) returns text
language plpgsql stable security definer set search_path = public, vault as $$
declare t uuid; v text;
begin
  if not public.mail_server_ok(server_secret) then raise exception 'Not allowed'; end if;
  if service not in ('anthropic', 'openai', 'gemini', 'openrouter') then raise exception 'Not an AI service'; end if;
  select m.team_id into t from members m where m.user_id = auth.uid() and m.role in ('owner', 'manager', 'researcher') order by m.joined_at limit 1;
  if t is null then raise exception 'Only people who can change leads can use their team key'; end if;
  if not public.team_active(t) then raise exception 'Your plan has ended'; end if;
  select s.decrypted_secret into v from team_keys k join vault.decrypted_secrets s on s.id = k.secret_id where k.team_id = t and k.service = assistant_team_key.service;
  return v;
end $$;

-- ---------- 2 + 3. each person's choice, about me, style
create table if not exists public.assistant_prefs (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  team_id    uuid not null references public.teams (id) on delete cascade,
  source     text not null default 'included' check (source in ('included', 'team')),
  provider   text check (provider is null or provider in ('anthropic', 'openai', 'gemini', 'openrouter')),
  model      text check (model is null or (length(model) between 1 and 120 and model ~ '^[A-Za-z0-9._:/-]+$')),
  about      text not null default '' check (length(about) <= 1500),
  style      text not null default '' check (length(style) <= 600),
  updated_at timestamptz not null default now()
);
alter table public.assistant_prefs enable row level security;
revoke all on public.assistant_prefs from anon, authenticated;
grant select, insert, update, delete on public.assistant_prefs to authenticated;
drop policy if exists "own prefs read" on public.assistant_prefs;
create policy "own prefs read" on public.assistant_prefs for select to authenticated using (user_id = auth.uid());
drop policy if exists "own prefs add" on public.assistant_prefs;
create policy "own prefs add" on public.assistant_prefs for insert to authenticated with check (user_id = auth.uid() and public.is_member(team_id));
drop policy if exists "own prefs change" on public.assistant_prefs;
create policy "own prefs change" on public.assistant_prefs for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid() and public.is_member(team_id));
drop policy if exists "own prefs remove" on public.assistant_prefs;
create policy "own prefs remove" on public.assistant_prefs for delete to authenticated using (user_id = auth.uid());

-- ---------- 3. what the Assistant remembers about each person (short facts; at most 60)
create table if not exists public.assistant_memory (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  team_id    uuid not null references public.teams (id) on delete cascade,
  fact       text not null check (length(fact) between 2 and 240),
  created_at timestamptz not null default now()
);
create index if not exists assistant_memory_user on public.assistant_memory (user_id, created_at);
alter table public.assistant_memory enable row level security;
revoke all on public.assistant_memory from anon, authenticated;
grant select, delete on public.assistant_memory to authenticated;
drop policy if exists "own memory read" on public.assistant_memory;
create policy "own memory read" on public.assistant_memory for select to authenticated using (user_id = auth.uid());
drop policy if exists "own memory remove" on public.assistant_memory;
create policy "own memory remove" on public.assistant_memory for delete to authenticated using (user_id = auth.uid());

-- Add a fact for the signed-in person (the Assistant's "remember" tool, or the person). The oldest goes past 60.
create or replace function public.remember_fact(fact text) returns uuid
language plpgsql security definer set search_path = public as $$
declare t uuid := public.my_team_id(false); f text := left(regexp_replace(trim(coalesce(fact, '')), '\s+', ' ', 'g'), 240); id_out uuid;
begin
  if t is null then raise exception 'Not in a team'; end if;
  if length(f) < 2 then raise exception 'Nothing to remember'; end if;
  select m.id into id_out from assistant_memory m where m.user_id = auth.uid() and lower(m.fact) = lower(f);
  if id_out is not null then return id_out; end if;
  insert into assistant_memory (user_id, team_id, fact) values (auth.uid(), t, f) returning id into id_out;
  delete from assistant_memory m where m.user_id = auth.uid() and m.id in (
    select x.id from assistant_memory x where x.user_id = auth.uid() order by x.created_at desc offset 60);
  return id_out;
end $$;

revoke all on function public.set_assistant_provider_key(text, text), public.remove_assistant_provider_key(text), public.set_assistant_provider(text, text),
  public.assistant_admin_providers(), public.assistant_included(text), public.assistant_team_key(text, text), public.remember_fact(text) from public, anon;
grant execute on function public.set_assistant_provider_key(text, text), public.remove_assistant_provider_key(text), public.set_assistant_provider(text, text),
  public.assistant_admin_providers(), public.remember_fact(text) to authenticated;                  -- admin ones check is_admin()
grant execute on function public.assistant_included(text), public.assistant_team_key(text, text) to authenticated;   -- need the server secret

notify pgrst, 'reload schema';
