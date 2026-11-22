// scripts/cleanup-multitenant-test.mjs
// Safely cleans up the deterministic test fixtures created by seed-multitenant-test.mjs.
// Strictly deletes only test fixtures matching specific test IDs and emails.
// NEVER uses broad or ambiguous filters. Never touches production data.

import { execSync } from "node:child_process";

const DB = process.env.STAGING_DB || process.env.PGDATABASE || "kestrel_staging_test";
const USER = process.env.PGUSER || "aryanrawat";

const CLEANUP_SQL = `
-- Safely clean only test fixtures matching exact deterministic test IDs and test emails
DELETE FROM public.teams WHERE id IN ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000002');
DELETE FROM public.teams WHERE name IN ('Kestrel QA Alpha', 'Kestrel QA Beta');
DELETE FROM auth.users WHERE id IN ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001');
DELETE FROM auth.users WHERE email IN ('alpha-owner@kestrel-test.local', 'beta-owner@kestrel-test.local');
`;

export function cleanupMultiTenant() {
  console.log(`Cleaning up multi-tenant test fixtures from "${DB}"...`);
  try {
    execSync(`psql -U "${USER}" -d "${DB}" -v ON_ERROR_STOP=1`, { input: CLEANUP_SQL, encoding: "utf8" });
    console.log("✓ Tenant A and Tenant B test fixtures removed safely.");
    return true;
  } catch (err) {
    console.error("✗ Failed to clean up multi-tenant test fixtures:", err.message);
    throw err;
  }
}

if (process.argv[1]?.endsWith("cleanup-multitenant-test.mjs")) {
  cleanupMultiTenant();
}
