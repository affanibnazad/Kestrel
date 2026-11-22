-- Kestrel 065: faster lead loading (19 Nov 2026). The App loads a team's leads newest first, 1000 at a time; without
-- this index the database sorted all of the team's leads again for every page. Only adds an index: no data changes.
-- Run once: node scripts/run-sql.mjs supabase/migrations/065_leads_speed.sql  (safe to run again)
create index if not exists leads_team_created on public.leads (team_id, created_at desc, id);
create index if not exists campaign_leads_team on public.campaign_leads (team_id, id);
create index if not exists do_not_contact_team_created on public.do_not_contact (team_id, created_at desc, entry);
analyze public.leads;
notify pgrst, 'reload schema';
