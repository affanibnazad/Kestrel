-- Rollback for Migration 20261123f: Service Catalog
-- Reverts additive columns added to public.offer_profiles.

alter table public.offer_profiles
  drop column if exists service_type,
  drop column if exists deliverables,
  drop column if exists problems_solved,
  drop column if exists dream_outcome,
  drop column if exists time_to_result,
  drop column if exists client_effort,
  drop column if exists risk_reversal,
  drop column if exists first_step,
  drop column if exists buying_triggers,
  drop column if exists proof_ids,
  drop column if exists active;

notify pgrst, 'reload schema';
