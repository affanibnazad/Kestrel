-- Rollback for Migration 20261123g: Opportunity Intelligence & Human Outreach Approval
BEGIN;

drop index if exists public.leads_matched_service_idx;
drop index if exists public.leads_team_outreach_approved_idx;

alter table public.leads
  drop column if exists buying_trigger,
  drop column if exists matched_service_id,
  drop column if exists outreach_approved_by,
  drop column if exists outreach_approved_at,
  drop column if exists outreach_approved;

COMMIT;

notify pgrst, 'reload schema';
