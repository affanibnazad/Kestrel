import fs from "node:fs";
import path from "node:path";
import { createBrowserClient } from "@supabase/ssr";

const envPath = path.join(process.cwd(), ".env.staging.local");
if (fs.existsSync(envPath)) process.loadEnvFile(envPath);

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";
const STAGING_EMAIL = process.env.STAGING_TEST_EMAIL || "";
const STAGING_PASSWORD = process.env.STAGING_TEST_PASSWORD || "";

if (!SUPABASE_URL.includes("xjqtgvhnbyepfinqonzm")) {
  console.error("Refusing to run: not staging ref xjqtgvhnbyepfinqonzm");
  process.exit(1);
}

const cookieJar = {};
const sb = createBrowserClient(SUPABASE_URL, SUPABASE_KEY, {
  cookies: {
    getAll: () => Object.entries(cookieJar).map(([name, value]) => ({ name, value })),
    setAll: (cs) => cs.forEach(({ name, value }) => { cookieJar[name] = value; }),
  },
});

const { data: auth, error: authErr } = await sb.auth.signInWithPassword({
  email: STAGING_EMAIL,
  password: STAGING_PASSWORD,
});
if (authErr) throw authErr;
const userId = auth.user.id;

// Pick 3 existing leads on staging
const { data: leads, error: leadErr } = await sb.from("leads").select("id, name, outreach_approved").limit(3);
if (leadErr) throw leadErr;
const ids = leads.map(l => l.id);

console.log(`[Bulk Approve Test] Testing bulk update on ${ids.length} leads:`, ids);

// Reset them first
await sb.from("leads").update({
  outreach_approved: false,
  outreach_approved_at: null,
  outreach_approved_by: null,
}).in("id", ids);

// Perform bulk approval with user + timestamp
const approvedAt = new Date().toISOString();
const { error: updateErr } = await sb.from("leads").update({
  outreach_approved: true,
  outreach_approved_at: approvedAt,
  outreach_approved_by: userId,
}).in("id", ids);

if (updateErr) throw updateErr;

// Verify values from database
const { data: updated, error: verifyErr } = await sb.from("leads").select("id, name, outreach_approved, outreach_approved_at, outreach_approved_by").in("id", ids);
if (verifyErr) throw verifyErr;

let allMatch = true;
for (const row of updated) {
  const tsMatch = row.outreach_approved_at && Math.abs(new Date(row.outreach_approved_at).getTime() - new Date(approvedAt).getTime()) < 2000;
  const userMatch = row.outreach_approved_by === userId;
  const flagMatch = row.outreach_approved === true;
  console.log(`Lead ${row.name} (${row.id}):`, {
    outreach_approved: row.outreach_approved,
    outreach_approved_at: row.outreach_approved_at,
    outreach_approved_by: row.outreach_approved_by,
    verified: flagMatch && tsMatch && userMatch
  });
  if (!flagMatch || !tsMatch || !userMatch) allMatch = false;
}

if (!allMatch) {
  console.error("FAIL: Verification failed for one or more leads.");
  process.exit(1);
}
console.log("PASS: Bulk approval correctly set outreach_approved, outreach_approved_at, and outreach_approved_by.");
