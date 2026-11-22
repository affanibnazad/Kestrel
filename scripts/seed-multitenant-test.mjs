// scripts/seed-multitenant-test.mjs
// Seeds two completely isolated test organizations for multi-tenant verification:
//   Tenant A: Kestrel QA Alpha (alpha-owner@kestrel-test.local)
//   Tenant B: Kestrel QA Beta  (beta-owner@kestrel-test.local)

import { execSync } from "node:child_process";

const DB = process.env.STAGING_DB || process.env.PGDATABASE || "kestrel_staging_test";
const USER = process.env.PGUSER || "aryanrawat";

const SEED_SQL = `
-- 1. Temporarily disable trigger for clean deterministic seeding
ALTER TABLE auth.users DISABLE TRIGGER on_auth_user_created;

-- 2. Clean previous test fixtures if present
DELETE FROM auth.users WHERE id IN ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001');
DELETE FROM public.teams WHERE id IN ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000002');
DELETE FROM public.teams WHERE name IN ('Kestrel QA Alpha', 'Kestrel QA Beta');

-- 3. Seed Tenant A (Alpha)
INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES ('a0000000-0000-0000-0000-000000000001', 'alpha-owner@kestrel-test.local', '{"full_name": "Alpha Owner", "company": "Kestrel QA Alpha"}'::jsonb);

INSERT INTO public.teams (id, name, plan, created_by)
VALUES ('a0000000-0000-0000-0000-000000000002', 'Kestrel QA Alpha', 'starter', 'a0000000-0000-0000-0000-000000000001');

INSERT INTO public.members (team_id, user_id, role, full_name, email)
VALUES ('a0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'owner', 'Alpha Owner', 'alpha-owner@kestrel-test.local');

INSERT INTO public.leads (id, team_id, dedupe_key, name, category, location, email, status, data, created_by)
VALUES 
  ('a0000000-0000-0000-0000-000000000011', 'a0000000-0000-0000-0000-000000000002', 'alpha1.example.com', 'ALPHA_PRIVATE_LEAD_001', 'SaaS', 'London', 'lead1@alpha.example.com', 'new', '{"custom_field": "ALPHA_PRIVATE_FIELD_001"}'::jsonb, 'a0000000-0000-0000-0000-000000000001'),
  ('a0000000-0000-0000-0000-000000000012', 'a0000000-0000-0000-0000-000000000002', 'alpha2.example.com', 'ALPHA_PRIVATE_LEAD_002', 'Agency', 'Manchester', 'lead2@alpha.example.com', 'removed', '{"custom_field": "ALPHA_PRIVATE_FIELD_002"}'::jsonb, 'a0000000-0000-0000-0000-000000000001');

INSERT INTO public.sequences (id, team_id, name, steps)
VALUES ('a0000000-0000-0000-0000-000000000031', 'a0000000-0000-0000-0000-000000000002', 'ALPHA_PRIVATE_SEQUENCE_001', '[{"day": 0, "subject": "Alpha Subject", "body": "Alpha Body"}]'::jsonb);

INSERT INTO public.campaigns (id, team_id, name, sequence_id, status)
VALUES ('a0000000-0000-0000-0000-000000000021', 'a0000000-0000-0000-0000-000000000002', 'ALPHA_PRIVATE_CAMPAIGN_001', 'a0000000-0000-0000-0000-000000000031', 'draft');

INSERT INTO public.team_webhooks (id, team_id, url, events, secret_id, active, created_by)
VALUES ('a0000000-0000-0000-0000-000000000051', 'a0000000-0000-0000-0000-000000000002', 'https://alpha.example.com/webhook', ARRAY['reply.received'], gen_random_uuid(), true, 'a0000000-0000-0000-0000-000000000001');

INSERT INTO public.team_rules (team_id, weights, tiers, rules)
VALUES ('a0000000-0000-0000-0000-000000000002', '{"score": 90}'::jsonb, '{"tier": "AlphaTier"}'::jsonb, '[{"rule": "AlphaRule"}]'::jsonb)
ON CONFLICT (team_id) DO UPDATE SET weights = excluded.weights;

INSERT INTO public.mailboxes (id, team_id, email, from_name, provider, smtp_host, smtp_port, username, secret_id, daily_limit, signature, status, created_by)
VALUES ('a0000000-0000-0000-0000-000000000071', 'a0000000-0000-0000-0000-000000000002', 'alpha-box@alpha.example.com', 'Alpha Mailbox', 'smtp', 'smtp.alpha.example.com', 587, 'alpha-user', gen_random_uuid(), 50, '-- Alpha Team', 'ok', 'a0000000-0000-0000-0000-000000000001');

INSERT INTO public.mail_replies (id, team_id, mailbox_id, kind, from_email, lead_email, subject, snippet, handled, ai_label)
VALUES ('a0000000-0000-0000-0000-000000000061', 'a0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000071', 'reply', 'prospect1@london.example.com', 'lead1@alpha.example.com', 'Re: Alpha Subject', 'Yes I am interested in Alpha proposal', false, 'interested');

INSERT INTO public.lists (id, team_id, name, created_by)
VALUES ('a0000000-0000-0000-0000-000000000081', 'a0000000-0000-0000-0000-000000000002', 'ALPHA_VIP_LIST', 'a0000000-0000-0000-0000-000000000001');

INSERT INTO public.list_leads (list_id, lead_id, team_id)
VALUES ('a0000000-0000-0000-0000-000000000081', 'a0000000-0000-0000-0000-000000000011', 'a0000000-0000-0000-0000-000000000002');

INSERT INTO public.offer_profiles (id, team_id, name, offer, customer, good, bad, criteria, strictness, one_line, updated_by)
VALUES ('a0000000-0000-0000-0000-000000000091', 'a0000000-0000-0000-0000-000000000002', 'Alpha Cold Outreach Offer', 'Outreach system for SaaS', 'B2B SaaS companies', 'Funded startups', 'Consumer apps', 'At least 10 employees', 'strict', 'We scale B2B SaaS pipeline', 'a0000000-0000-0000-0000-000000000001');

INSERT INTO public.team_about (team_id, mode, website, about, proof, tone, avoid, updated_by)
VALUES ('a0000000-0000-0000-0000-000000000002', 'agency', 'https://alpha.example.com', 'Alpha Growth Agency', '[]'::jsonb, 'friendly', 'cheap, guarantee', 'a0000000-0000-0000-0000-000000000001')
ON CONFLICT (team_id) DO UPDATE SET about = excluded.about;

INSERT INTO public.team_ai (team_id, provider, model, sender_name, business, address, signature, booking_link)
VALUES ('a0000000-0000-0000-0000-000000000002', 'anthropic', 'claude-3-5-sonnet', 'Alpha Team', 'Alpha SaaS Agency', '123 London St', 'Best,\nAlpha Team', 'https://cal.com/alpha')
ON CONFLICT (team_id) DO UPDATE SET business = excluded.business;

INSERT INTO public.domain_monitor (team_id, domain, checked_at, listed, results)
VALUES ('a0000000-0000-0000-0000-000000000002', 'alpha.example.com', '2026-11-22T00:00:00Z', false, '{"clean": true}'::jsonb)
ON CONFLICT (team_id, domain) DO NOTHING;

-- 4. Seed Tenant B (Beta)
INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES ('b0000000-0000-0000-0000-000000000001', 'beta-owner@kestrel-test.local', '{"full_name": "Beta Owner", "company": "Kestrel QA Beta"}'::jsonb);

INSERT INTO public.teams (id, name, plan, created_by)
VALUES ('b0000000-0000-0000-0000-000000000002', 'Kestrel QA Beta', 'starter', 'b0000000-0000-0000-0000-000000000001');

INSERT INTO public.members (team_id, user_id, role, full_name, email)
VALUES ('b0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', 'owner', 'Beta Owner', 'beta-owner@kestrel-test.local');

INSERT INTO public.leads (id, team_id, dedupe_key, name, category, location, email, status, data, created_by)
VALUES 
  ('b0000000-0000-0000-0000-000000000011', 'b0000000-0000-0000-0000-000000000002', 'beta1.example.com', 'BETA_PRIVATE_LEAD_001', 'Design', 'Berlin', 'lead1@beta.example.com', 'new', '{"custom_field": "BETA_PRIVATE_FIELD_001"}'::jsonb, 'b0000000-0000-0000-0000-000000000001'),
  ('b0000000-0000-0000-0000-000000000012', 'b0000000-0000-0000-0000-000000000002', 'beta2.example.com', 'BETA_PRIVATE_LEAD_002', 'Marketing', 'Munich', 'lead2@beta.example.com', 'removed', '{"custom_field": "BETA_PRIVATE_FIELD_002"}'::jsonb, 'b0000000-0000-0000-0000-000000000001');

INSERT INTO public.sequences (id, team_id, name, steps)
VALUES ('b0000000-0000-0000-0000-000000000031', 'b0000000-0000-0000-0000-000000000002', 'BETA_PRIVATE_SEQUENCE_001', '[{"day": 0, "subject": "Beta Subject", "body": "Beta Body"}]'::jsonb);

INSERT INTO public.campaigns (id, team_id, name, sequence_id, status)
VALUES ('b0000000-0000-0000-0000-000000000021', 'b0000000-0000-0000-0000-000000000002', 'BETA_PRIVATE_CAMPAIGN_001', 'b0000000-0000-0000-0000-000000000031', 'draft');

INSERT INTO public.team_webhooks (id, team_id, url, events, secret_id, active, created_by)
VALUES ('b0000000-0000-0000-0000-000000000051', 'b0000000-0000-0000-0000-000000000002', 'https://beta.example.com/webhook', ARRAY['reply.received'], gen_random_uuid(), true, 'b0000000-0000-0000-0000-000000000001');

INSERT INTO public.team_rules (team_id, weights, tiers, rules)
VALUES ('b0000000-0000-0000-0000-000000000002', '{"score": 75}'::jsonb, '{"tier": "BetaTier"}'::jsonb, '[{"rule": "BetaRule"}]'::jsonb)
ON CONFLICT (team_id) DO UPDATE SET weights = excluded.weights;

INSERT INTO public.mailboxes (id, team_id, email, from_name, provider, smtp_host, smtp_port, username, secret_id, daily_limit, signature, status, created_by)
VALUES ('b0000000-0000-0000-0000-000000000071', 'b0000000-0000-0000-0000-000000000002', 'beta-box@beta.example.com', 'Beta Mailbox', 'smtp', 'smtp.beta.example.com', 587, 'beta-user', gen_random_uuid(), 50, '-- Beta Team', 'ok', 'b0000000-0000-0000-0000-000000000001');

INSERT INTO public.mail_replies (id, team_id, mailbox_id, kind, from_email, lead_email, subject, snippet, handled, ai_label)
VALUES ('b0000000-0000-0000-0000-000000000061', 'b0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000071', 'reply', 'prospect1@berlin.example.com', 'lead1@beta.example.com', 'Re: Beta Subject', 'Yes I am interested in Beta proposal', false, 'interested');

INSERT INTO public.lists (id, team_id, name, created_by)
VALUES ('b0000000-0000-0000-0000-000000000081', 'b0000000-0000-0000-0000-000000000002', 'BETA_VIP_LIST', 'b0000000-0000-0000-0000-000000000001');

INSERT INTO public.list_leads (list_id, lead_id, team_id)
VALUES ('b0000000-0000-0000-0000-000000000081', 'b0000000-0000-0000-0000-000000000011', 'b0000000-0000-0000-0000-000000000002');

INSERT INTO public.offer_profiles (id, team_id, name, offer, customer, good, bad, criteria, strictness, one_line, updated_by)
VALUES ('b0000000-0000-0000-0000-000000000091', 'b0000000-0000-0000-0000-000000000002', 'Beta Cold Outreach Offer', 'Outreach system for Design Agencies', 'Design studios', 'Agencies with 5+ staff', 'Solo graphic designers', 'Active website', 'balanced', 'We scale Design Agency pipeline', 'b0000000-0000-0000-0000-000000000001');

INSERT INTO public.team_about (team_id, mode, website, about, proof, tone, avoid, updated_by)
VALUES ('b0000000-0000-0000-0000-000000000002', 'agency', 'https://beta.example.com', 'Beta Design Growth', '[]'::jsonb, 'professional', 'discount, cheap', 'b0000000-0000-0000-0000-000000000001')
ON CONFLICT (team_id) DO UPDATE SET about = excluded.about;

INSERT INTO public.team_ai (team_id, provider, model, sender_name, business, address, signature, booking_link)
VALUES ('b0000000-0000-0000-0000-000000000002', 'anthropic', 'claude-3-5-sonnet', 'Beta Team', 'Beta Design Growth', '456 Berlin Ave', 'Best,\nBeta Team', 'https://cal.com/beta')
ON CONFLICT (team_id) DO UPDATE SET business = excluded.business;

INSERT INTO public.domain_monitor (team_id, domain, checked_at, listed, results)
VALUES ('b0000000-0000-0000-0000-000000000002', 'beta.example.com', '2026-11-22T00:00:00Z', false, '{"clean": true}'::jsonb)
ON CONFLICT (team_id, domain) DO NOTHING;

-- 5. Re-enable trigger
ALTER TABLE auth.users ENABLE TRIGGER on_auth_user_created;
`;

export function seedMultiTenant() {
  console.log(`Seeding multi-tenant test fixtures into "${DB}"...`);
  try {
    execSync(`psql -U "${USER}" -d "${DB}" -v ON_ERROR_STOP=1`, { input: SEED_SQL, encoding: "utf8" });
    console.log("✓ Tenant A (Kestrel QA Alpha) seeded with deterministic records.");
    console.log("✓ Tenant B (Kestrel QA Beta) seeded with deterministic records.");
    return true;
  } catch (err) {
    console.error("✗ Failed to seed multi-tenant test fixtures:", err.message);
    throw err;
  }
}

if (process.argv[1]?.endsWith("seed-multitenant-test.mjs")) {
  seedMultiTenant();
}
