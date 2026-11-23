-- Rollback for Migration 20261123d: Live Lockdown
-- Restores execute grants on credits and team file functions to authenticated users.

grant execute on function public.get_team_credits() to authenticated;
grant execute on function public.use_team_credits(text, uuid, text, integer, uuid, text, text) to authenticated;
grant execute on function public.save_team_file(text, text, text, text, text, text, bigint, jsonb) to authenticated;
