-- Kestrel: AI in the App. Offer profiles (what you sell, who buys it), the team's AI settings and email sender,
-- and a way for the App's server to use the team's AI key. The key never goes to the browser.
-- Run once: node scripts/run-sql.mjs supabase/migrations/007_ai.sql  (safe to run again)

-- ---------- offer profiles: the same fields as the extension's AI → Your offer
create table if not exists public.offer_profiles (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.teams (id) on delete cascade,
  name       text not null check (length(name) between 1 and 40),
  offer      text not null default '' check (length(offer) <= 2000),
  customer   text not null default '' check (length(customer) <= 2000),
  good       text not null default '' check (length(good) <= 2000),
  bad        text not null default '' check (length(bad) <= 2000),
  criteria   text not null default '' check (length(criteria) <= 2000),
  strictness text not null default 'balanced' check (strictness in ('lenient', 'balanced', 'strict')),
  one_line   text not null default '' check (length(one_line) <= 400),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (team_id, name)
);
alter table public.offer_profiles enable row level security;
drop policy if exists "team reads offers" on public.offer_profiles;
create policy "team reads offers" on public.offer_profiles for select to authenticated using (public.is_member(team_id));
drop policy if exists "team adds offers" on public.offer_profiles;
create policy "team adds offers" on public.offer_profiles for insert to authenticated with check (public.can_edit(team_id));
drop policy if exists "team changes offers" on public.offer_profiles;
create policy "team changes offers" on public.offer_profiles for update to authenticated using (public.can_edit(team_id)) with check (public.can_edit(team_id));
drop policy if exists "team removes offers" on public.offer_profiles;
create policy "team removes offers" on public.offer_profiles for delete to authenticated using (public.can_edit(team_id));
revoke all on public.offer_profiles from anon;
grant select, insert, update, delete on public.offer_profiles to authenticated;

-- ---------- team AI settings: which AI and model, the offer in use, and who the emails come from
create table if not exists public.team_ai (
  team_id      uuid primary key references public.teams (id) on delete cascade,
  provider     text not null default 'anthropic' check (provider in ('anthropic', 'openai', 'gemini', 'openrouter')),
  model        text not null default 'claude-sonnet-5-5' check (length(model) between 1 and 120),
  offer_id     uuid references public.offer_profiles (id) on delete set null,
  sender_name  text not null default '' check (length(sender_name) <= 120),
  business     text not null default '' check (length(business) <= 120),
  address      text not null default '' check (length(address) <= 400),
  signature    text not null default '' check (length(signature) <= 400),
  updated_at   timestamptz not null default now()
);
alter table public.team_ai enable row level security;
drop policy if exists "team reads ai" on public.team_ai;
create policy "team reads ai" on public.team_ai for select to authenticated using (public.is_member(team_id));
drop policy if exists "team adds ai" on public.team_ai;
create policy "team adds ai" on public.team_ai for insert to authenticated with check (public.can_edit(team_id));
drop policy if exists "team changes ai" on public.team_ai;
create policy "team changes ai" on public.team_ai for update to authenticated using (public.can_edit(team_id)) with check (public.can_edit(team_id));
revoke all on public.team_ai from anon;
grant select, insert, update on public.team_ai to authenticated;

-- ---------- the team's AI key, for the App's server only (it calls the AI company itself).
-- Only people who can change leads get it, and only for the AI companies (never the data-source keys).
-- The same people's connected extensions already receive the team keys (ext_team_keys).
create or replace function public.ai_key_for_server(service text) returns text
language plpgsql stable security definer set search_path = public, vault as $$
declare t uuid; v text;
begin
  if service not in ('anthropic', 'openai', 'gemini', 'openrouter') then raise exception 'Not an AI service'; end if;
  select m.team_id into t from members m where m.user_id = auth.uid() and m.role in ('owner', 'manager', 'researcher') order by m.joined_at limit 1;
  if t is null then raise exception 'Only people who can change leads can use AI'; end if;
  select s.decrypted_secret into v from team_keys k join vault.decrypted_secrets s on s.id = k.secret_id where k.team_id = t and k.service = ai_key_for_server.service;
  return v;
end $$;
revoke all on function public.ai_key_for_server(text) from public, anon;
grant execute on function public.ai_key_for_server(text) to authenticated;

notify pgrst, 'reload schema';
