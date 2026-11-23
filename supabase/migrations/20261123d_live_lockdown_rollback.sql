-- Rollback for Migration 20261123d: Live Lockdown
-- Restores original privileges from migrations 070-073 to authenticated users.

-- 1. Direct Send (070)
grant execute on function public.ensure_direct_campaign(uuid) to authenticated;
grant execute on function public.mail_direct_prepare(text, uuid, text, text, text, uuid) to authenticated;
grant execute on function public.mail_direct_sent(text, uuid, text) to authenticated;

-- 2. Team Credits (071)
grant execute on function public.get_team_credits() to authenticated;
grant execute on function public.use_team_credits(text, uuid, text, integer, uuid, text, text) to authenticated;

-- 3. Team Files (072)
grant execute on function public.save_team_file(text, text, text, text, text, text, bigint, jsonb) to authenticated;
grant insert, delete on table public.team_files to authenticated;

-- 4. Team Automations (073)
grant insert, update, delete on table public.team_automations to authenticated;

-- 5. Team Outside Bots (073)
grant select, insert, update on table public.team_outside_bots to authenticated;
