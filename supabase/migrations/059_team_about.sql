-- Kestrel 059: the About page (Phase 2, 18 Nov 2026): one row per team with how the team uses Kestrel (mode), its website,
-- what it does, proof (results, case studies, testimonials) and its tone of voice. The AI reads it for scoring, writing and
-- the Assistant. Business name, sender, postal address, signature and booking link stay in team_ai (007, 037); offers in
-- offer_profiles (007). Same access as team_ai: everyone in the team reads; people who can change leads write.
-- Run once: node scripts/run-sql.mjs supabase/migrations/059_team_about.sql  (safe to run again)

create table if not exists public.team_about (
  team_id    uuid primary key references public.teams (id) on delete cascade,
  mode       text not null default 'agency' check (mode in ('agency', 'solo', 'whitelabel')),
  website    text not null default '' check (length(website) <= 300 and (website = '' or website ~* '^https?://[^\s<>"]+$')),
  about      text not null default '' check (length(about) <= 2000),
  proof      jsonb not null default '[]'::jsonb check (jsonb_typeof(proof) = 'array' and jsonb_array_length(proof) <= 10 and length(proof::text) <= 8000),
  tone       text not null default '' check (length(tone) <= 600),
  avoid      text not null default '' check (length(avoid) <= 600),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.team_about enable row level security;
revoke all on public.team_about from anon, authenticated;
grant select, insert, update on public.team_about to authenticated;
drop policy if exists "team reads about" on public.team_about;
create policy "team reads about" on public.team_about for select to authenticated using (public.is_member(team_id));
drop policy if exists "team adds about" on public.team_about;
create policy "team adds about" on public.team_about for insert to authenticated with check (public.can_edit(team_id));
drop policy if exists "team changes about" on public.team_about;
create policy "team changes about" on public.team_about for update to authenticated using (public.can_edit(team_id)) with check (public.can_edit(team_id));

-- For the App's server only (Autopilot runs without a signed-in person): one team's About, with the server secret.
create or replace function public.team_about_for_server(server_secret text, team uuid) returns json
language plpgsql stable security definer set search_path = public as $$
declare a team_about;
begin
  if not public.mail_server_ok(server_secret) then raise exception 'Not allowed'; end if;
  select * into a from team_about where team_id = team;
  if a.team_id is null then return null; end if;
  return json_build_object('mode', a.mode, 'website', a.website, 'about', a.about, 'proof', a.proof, 'tone', a.tone, 'avoid', a.avoid);
end $$;
revoke all on function public.team_about_for_server(text, uuid) from public, anon, authenticated;
grant execute on function public.team_about_for_server(text, uuid) to anon, authenticated;   -- checked by the server secret

notify pgrst, 'reload schema';
