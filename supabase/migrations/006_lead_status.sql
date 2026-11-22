-- Kestrel: keep or remove a lead in the App (the same Kept / Removed lists as the extension's Workspace).
-- Run: node /Users/affanibnazad/Documents/Database/quarry-cloud/scripts/run-sql.mjs /Users/affanibnazad/Documents/Database/quarry-cloud/supabase/migrations/006_lead_status.sql
-- Only adds a column. The extension's sync (ext_push_leads) does not touch it, so a choice made in the App stays.
alter table public.leads add column if not exists status text not null default 'new' check (status in ('new', 'kept', 'removed'));
create index if not exists leads_team_status_idx on public.leads (team_id, status);
notify pgrst, 'reload schema';
