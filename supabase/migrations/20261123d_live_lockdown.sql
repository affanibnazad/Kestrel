-- Migration 20261123d: Live Lockdown for Unverified Functions
-- Revokes execute on unverified functions on live (team credits and team files).
-- Tables remain intact; only execute access is removed.

revoke execute on function public.get_team_credits() from anon, authenticated, public;
revoke execute on function public.use_team_credits(text, uuid, text, integer, uuid, text, text) from anon, authenticated, public;
revoke execute on function public.save_team_file(text, text, text, text, text, text, bigint, jsonb) from anon, authenticated, public;
