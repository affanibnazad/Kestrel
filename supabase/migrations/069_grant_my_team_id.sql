-- 069: Grant execute on my_team_id to authenticated users (DEF-03 fix).
-- Resolves permission denied error when authenticated users query tables
-- with RLS policies that evaluate public.my_team_id (e.g. team_webhooks).
-- Safe to run repeatedly.

grant execute on function public.my_team_id(boolean) to authenticated;

notify pgrst, 'reload schema';
