-- Migration 20261123d: Live Lockdown for Unverified Functions & Vulnerable Tables
-- Tables remain intact; this only locks down execute access and unsafe table modifications.

-- 1. Direct Send (070): keep OFF until 074 security fix is rebuilt
revoke execute on function public.ensure_direct_campaign(uuid) from anon, authenticated, public;
revoke execute on function public.mail_direct_prepare(text, uuid, text, text, text, uuid) from anon, authenticated, public;
revoke execute on function public.mail_direct_sent(text, uuid, text) from anon, authenticated, public;

-- 2. Team Credits (071): keep OFF until 077 security fix is rebuilt
revoke execute on function public.get_team_credits() from anon, authenticated, public;
revoke execute on function public.use_team_credits(text, uuid, text, integer, uuid, text, text) from anon, authenticated, public;

-- 3. Team Files (072): keep OFF until 076 security fix is rebuilt
revoke execute on function public.save_team_file(text, text, text, text, text, text, bigint, jsonb) from anon, authenticated, public;
revoke insert, update, delete on table public.team_files from anon, authenticated;

-- 4. Team Automations (073): prevent unauthorized modifications
revoke insert, update, delete on table public.team_automations from anon, authenticated;

-- 5. Team Outside Bots (073): protect plaintext bot tokens & webhooks
revoke select, insert, update, delete on table public.team_outside_bots from anon, authenticated;
