-- Kestrel leads: one table, walled off per team.
-- Paste into Supabase → SQL Editor → New query → Run (after 001_accounts.sql). Safe to run once.
--
--  * Every lead belongs to one team. Row-level security: people only ever see their own team's leads.
--  * Viewers can read; owners, managers and researchers can add, change and remove.
--  * One lead per business per team: "dedupe_key" is the website domain, else the email, else the phone,
--    else name + place. Importing the same lead again updates it instead of adding a copy.
--  * The whole lead from the extension is kept in "data" (no field is ever lost); the main fields are
--    copied into columns so the App can sort and filter quickly.

create table if not exists public.leads (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams (id) on delete cascade,
  dedupe_key  text not null,
  name        text,
  category    text,
  location    text,
  source      text,
  email       text,
  phone       text,
  website     text,
  verdict     text check (verdict in ('Good', 'Maybe', 'No') or verdict is null),
  reason      text,
  score       numeric,
  tier        text,
  hiring      boolean not null default false,
  named       boolean not null default false,
  sample      boolean not null default false,
  data        jsonb not null default '{}'::jsonb,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (team_id, dedupe_key)
);
create index if not exists leads_team_created_idx on public.leads (team_id, created_at desc);
create index if not exists leads_team_verdict_idx on public.leads (team_id, verdict);
create index if not exists leads_team_source_idx on public.leads (team_id, source);

alter table public.leads enable row level security;

create or replace function public.can_edit(t uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where team_id = t and user_id = auth.uid() and role in ('owner', 'manager', 'researcher'));
$$;
revoke all on function public.can_edit(uuid) from public, anon;
grant execute on function public.can_edit(uuid) to authenticated;

drop policy if exists "team reads its leads" on public.leads;
create policy "team reads its leads" on public.leads for select to authenticated using (public.is_member(team_id));
drop policy if exists "team adds leads" on public.leads;
create policy "team adds leads" on public.leads for insert to authenticated with check (public.can_edit(team_id));
drop policy if exists "team changes leads" on public.leads;
create policy "team changes leads" on public.leads for update to authenticated using (public.can_edit(team_id)) with check (public.can_edit(team_id));
drop policy if exists "team removes leads" on public.leads;
create policy "team removes leads" on public.leads for delete to authenticated using (public.can_edit(team_id));

grant select, insert, update, delete on public.leads to authenticated;

create or replace function public.touch_lead() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists leads_touch on public.leads;
create trigger leads_touch before update on public.leads for each row execute function public.touch_lead();
