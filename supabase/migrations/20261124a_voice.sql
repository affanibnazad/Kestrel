-- LIVE: Stage D: Writing Quality & Voice Profile
-- Blueprint Stage D: Voice Notes on team_about, Angle and Angle Reason on leads
-- Additive only. No existing columns or RLS dropped.

-- ============================================================================
-- PRE-CHECK: Verify target tables and existing column count
-- ============================================================================
SELECT
  table_name,
  column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
    (table_name = 'team_about' AND column_name = 'voice_notes')
    OR (table_name = 'leads' AND column_name IN ('angle', 'angle_reason'))
  );

BEGIN;

-- 1. Extend public.team_about with voice_notes jsonb
alter table public.team_about
  add column if not exists voice_notes jsonb not null default '{}'::jsonb
  check (jsonb_typeof(voice_notes) = 'object' and length(voice_notes::text) <= 4000);

-- 2. Extend public.leads with additive columns for Stage D angle tracking
alter table public.leads
  add column if not exists angle text check (angle is null or length(angle) <= 100),
  add column if not exists angle_reason text check (angle_reason is null or length(angle_reason) <= 500);

-- 3. Index for filtering leads by angle
create index if not exists leads_team_angle_idx on public.leads (team_id, angle);

-- 4. Update team_about_for_server helper to return voice_notes
create or replace function public.team_about_for_server(server_secret text, team uuid) returns json
language plpgsql stable security definer set search_path = public as $$
declare a team_about;
begin
  if not public.mail_server_ok(server_secret) then raise exception 'Not allowed'; end if;
  select * into a from team_about where team_id = team;
  if a.team_id is null then return null; end if;
  return json_build_object(
    'mode', a.mode,
    'website', a.website,
    'about', a.about,
    'proof', a.proof,
    'tone', a.tone,
    'avoid', a.avoid,
    'voice_notes', a.voice_notes
  );
end $$;

COMMIT;

notify pgrst, 'reload schema';

-- ============================================================================
-- POST-CHECK: Verify all 3 columns and index are present
-- ============================================================================
SELECT
  table_name,
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
    (table_name = 'team_about' AND column_name = 'voice_notes')
    OR (table_name = 'leads' AND column_name IN ('angle', 'angle_reason'))
  )
ORDER BY table_name, column_name;

SELECT
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'leads'
  AND indexname = 'leads_team_angle_idx';
