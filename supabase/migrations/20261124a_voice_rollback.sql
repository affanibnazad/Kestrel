-- Rollback: Stage D Writing Quality & Voice Profile
BEGIN;

alter table public.team_about drop column if exists voice_notes;
alter table public.leads drop column if exists angle;
alter table public.leads drop column if exists angle_reason;
drop index if exists public.leads_team_angle_idx;

create or replace function public.team_about_for_server(server_secret text, team uuid) returns json
language plpgsql stable security definer set search_path = public as $$
declare a team_about;
begin
  if not public.mail_server_ok(server_secret) then raise exception 'Not allowed'; end if;
  select * into a from team_about where team_id = team;
  if a.team_id is null then return null; end if;
  return json_build_object('mode', a.mode, 'website', a.website, 'about', a.about, 'proof', a.proof, 'tone', a.tone, 'avoid', a.avoid);
end $$;

COMMIT;

notify pgrst, 'reload schema';
