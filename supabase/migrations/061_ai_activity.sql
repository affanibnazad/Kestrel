-- Kestrel 061: AI activity log (Phase 3E, 19 Nov 2026): every change Kestrel AI made after someone clicked Confirm, and
-- every Score and write run, with who, when, what and whether it worked. Everyone in the team can read it; a person can
-- only add rows for themselves; nobody can change or delete a row (an honest record).
-- Run once: node scripts/run-sql.mjs supabase/migrations/061_ai_activity.sql  (safe to run again)

create table if not exists public.ai_activity (
  id         bigint generated always as identity primary key,
  team_id    uuid not null references public.teams (id) on delete cascade,
  user_id    uuid references auth.users (id) on delete set null default auth.uid(),
  kind       text not null check (kind ~ '^[a-z_]{2,40}$'),
  summary    text not null check (length(summary) between 1 and 400),
  ok         boolean not null default true,
  detail     text check (detail is null or length(detail) <= 400),
  ai         text check (ai is null or length(ai) <= 60),
  created_at timestamptz not null default now()
);
create index if not exists ai_activity_team_time on public.ai_activity (team_id, created_at desc);
alter table public.ai_activity enable row level security;
revoke all on public.ai_activity from anon, authenticated;
grant select, insert on public.ai_activity to authenticated;
grant usage on sequence public.ai_activity_id_seq to authenticated;
drop policy if exists "team reads ai activity" on public.ai_activity;
create policy "team reads ai activity" on public.ai_activity for select to authenticated using (public.is_member(team_id));
drop policy if exists "member adds own ai activity" on public.ai_activity;
create policy "member adds own ai activity" on public.ai_activity for insert to authenticated
  with check (public.is_member(team_id) and user_id = auth.uid() and created_at > now() - interval '1 minute');

notify pgrst, 'reload schema';
