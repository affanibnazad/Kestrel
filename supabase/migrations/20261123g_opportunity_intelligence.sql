-- Migration 20261123g: Opportunity Intelligence & Human Outreach Approval
-- Blueprint Stage C: Additive columns on public.leads for Opportunity Approval and Matcher Tracking
-- Additive only. No existing columns or RLS dropped.

BEGIN;

-- 1. Extend public.leads with additive columns for Stage C
alter table public.leads
  add column if not exists outreach_approved boolean not null default false,
  add column if not exists outreach_approved_at timestamptz,
  add column if not exists outreach_approved_by uuid references auth.users (id) on delete set null,
  add column if not exists matched_service_id uuid references public.offer_profiles (id) on delete set null,
  add column if not exists buying_trigger text check (buying_trigger is null or length(buying_trigger) <= 500);

-- 2. Indexes for fast filtering and joins
create index if not exists leads_team_outreach_approved_idx on public.leads (team_id, outreach_approved);
create index if not exists leads_matched_service_idx on public.leads (matched_service_id);

COMMIT;

notify pgrst, 'reload schema';
