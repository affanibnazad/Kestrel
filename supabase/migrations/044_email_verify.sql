-- Kestrel 044: email verifier labels on leads (Valid / Invalid / Risky). Design: docs/superpowers/specs/2026-11-14-email-verifier-design.md
-- Run once: node scripts/run-sql.mjs supabase/migrations/044_email_verify.sql  (safe to run again; only adds)
-- Written by /api/verify (part 1 checks in Kestrel, part 2 Affan's own verifier server, Hunter as fallback) with the
-- person's own rights (row-level security: can_edit). Read by every team member like the other lead columns.

alter table public.leads add column if not exists email_status text check (email_status is null or email_status in ('valid', 'invalid', 'risky'));
alter table public.leads add column if not exists email_checked_at timestamptz;
alter table public.leads add column if not exists email_check jsonb check (email_check is null or pg_column_size(email_check) < 4000);

-- A new email address means the old label no longer applies.
create or replace function public.leads_email_changed() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.email is distinct from old.email and new.email_status is not distinct from old.email_status
     and new.email_checked_at is not distinct from old.email_checked_at then
    new.email_status := null; new.email_checked_at := null; new.email_check := null;
  end if;
  return new;
end $$;
revoke all on function public.leads_email_changed() from public, anon, authenticated;
drop trigger if exists leads_email_changed on public.leads;
create trigger leads_email_changed before update on public.leads for each row execute function public.leads_email_changed();

-- Campaigns never take a lead whose email was found Invalid (on top of 039's email check). The others still start;
-- start_campaign / campaign_add_leads count the left-out ones as skipped.
create or replace function public.campaign_leads_check_emails() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.email_steps_problem(new.steps) is not null then return null; end if;
  if new.lead_id is not null and exists (select 1 from leads l where l.id = new.lead_id and l.email_status = 'invalid'
       and lower(coalesce(l.email, '')) = lower(new.to_email)) then
    return null;
  end if;
  return new;
end $$;
revoke all on function public.campaign_leads_check_emails() from public, anon, authenticated;

create index if not exists leads_team_email_status on public.leads (team_id, email_status);

notify pgrst, 'reload schema';
