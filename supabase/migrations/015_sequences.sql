-- Kestrel Mail, phase 2: sequences. One sequence per offer (or campaign): the first email and up to 3 follow-ups
-- (by default day 5, 10 and 15, only to people who did not reply). Each step is a subject and a body with merge fields
-- such as {{FIRST_NAME}}, {{ICEBREAKER}}, {{QUESTION}} and {{FOLLOW_UP}}. The AI fills the personal parts for each lead;
-- Kestrel adds the sender name, postal address and opt-out line to every step. Nothing is sent in this phase.
-- Run once: node scripts/run-sql.mjs supabase/migrations/015_sequences.sql  (safe to run again; only adds)

-- Checks the shape of the steps: 1 to 4 steps, the first on day 0, later steps on later days (up to day 90),
-- a subject (empty on a follow-up = same thread) and a body of reasonable length.
create or replace function public.sequence_steps_ok(steps jsonb) returns boolean
language plpgsql immutable set search_path = public as $$
declare s jsonb; i integer := 0; prev integer := -1; d integer;
begin
  if steps is null or jsonb_typeof(steps) <> 'array' or jsonb_array_length(steps) not between 1 and 4 then return false; end if;
  for s in select value from jsonb_array_elements(steps) loop
    -- coalesce: a missing key gives null, which must count as wrong (not slip through).
    if jsonb_typeof(s) <> 'object' or coalesce(jsonb_typeof(s->'day'), '') <> 'number' or coalesce(jsonb_typeof(s->'subject'), '') <> 'string'
      or coalesce(jsonb_typeof(s->'body'), '') <> 'string' then return false; end if;
    d := (s->>'day')::numeric::integer;
    if (s->>'day')::numeric <> d or d < 0 or d > 90 or (i = 0 and d <> 0) or (i > 0 and d <= prev) then return false; end if;
    if length(s->>'subject') > 200 or length(s->>'body') not between 1 and 4000 or (i = 0 and length(trim(s->>'subject')) = 0) then return false; end if;
    prev := d; i := i + 1;
  end loop;
  return true;
end $$;
revoke all on function public.sequence_steps_ok(jsonb) from public, anon;
grant execute on function public.sequence_steps_ok(jsonb) to authenticated;

create table if not exists public.sequences (
  id            uuid primary key default gen_random_uuid(),
  team_id       uuid not null references public.teams (id) on delete cascade,
  offer_id      uuid references public.offer_profiles (id) on delete set null,
  name          text not null check (length(name) between 1 and 60),
  steps         jsonb not null check (public.sequence_steps_ok(steps)),
  stop_on_reply boolean not null default true,
  weekdays_only boolean not null default true,
  updated_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (team_id, name)
);
create index if not exists sequences_team_offer on public.sequences (team_id, offer_id);
alter table public.sequences enable row level security;
revoke all on public.sequences from anon, authenticated;
grant select, insert, update, delete on public.sequences to authenticated;
drop policy if exists "team reads sequences" on public.sequences;
create policy "team reads sequences" on public.sequences for select to authenticated using (public.is_member(team_id));
drop policy if exists "team adds sequences" on public.sequences;
create policy "team adds sequences" on public.sequences for insert to authenticated with check (public.can_edit(team_id));
drop policy if exists "team changes sequences" on public.sequences;
create policy "team changes sequences" on public.sequences for update to authenticated using (public.can_edit(team_id)) with check (public.can_edit(team_id));
drop policy if exists "team removes sequences" on public.sequences;
create policy "team removes sequences" on public.sequences for delete to authenticated using (public.can_edit(team_id));

-- A sequence may only point at an offer of the same team.
create or replace function public.sequence_offer_same_team() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.offer_id is not null and not exists (select 1 from offer_profiles o where o.id = new.offer_id and o.team_id = new.team_id) then
    raise exception 'That offer belongs to another team';
  end if;
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end $$;
revoke all on function public.sequence_offer_same_team() from public, anon, authenticated;
drop trigger if exists sequences_check on public.sequences;
create trigger sequences_check before insert or update on public.sequences for each row execute function public.sequence_offer_same_team();

notify pgrst, 'reload schema';
