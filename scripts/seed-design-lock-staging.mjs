// scripts/seed-design-lock-staging.mjs
// Seeds a FIXED staging dataset for the staging design-lock test user ONLY.
// Enforces strict safety boundary: REFUSES to run if not targeting staging ref xjqtgvhnbyepfinqonzm.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createBrowserClient } from "@supabase/ssr";

const envPath = path.join(process.cwd(), ".env.staging.local");
if (fs.existsSync(envPath)) process.loadEnvFile(envPath);

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";
const STAGING_EMAIL = process.env.STAGING_TEST_EMAIL || "";
const STAGING_PASSWORD = process.env.STAGING_TEST_PASSWORD || "";

const REQUIRED_REF = "xjqtgvhnbyepfinqonzm";
if (!SUPABASE_URL.includes(REQUIRED_REF)) {
  console.error(`❌ REFUSED: URL "${SUPABASE_URL}" does not contain staging ref ${REQUIRED_REF}`);
  process.exit(1);
}

const cookieJar = {};
const sb = createBrowserClient(SUPABASE_URL, SUPABASE_KEY, {
  cookies: {
    getAll: () => Object.entries(cookieJar).map(([name, value]) => ({ name, value })),
    setAll: (cs) => cs.forEach(({ name, value }) => { cookieJar[name] = value; }),
  },
});

console.log(`[Seed Design Lock] Signing in as ${STAGING_EMAIL}...`);
const { data: auth, error: authErr } = await sb.auth.signInWithPassword({
  email: STAGING_EMAIL,
  password: STAGING_PASSWORD,
});
if (authErr) throw authErr;
const userId = auth.user.id;

const { data: acc } = await sb.rpc("my_account");
const teamId = acc.team_id;
console.log(`[Seed Design Lock] Team ID: ${teamId}, User ID: ${userId}`);

// Fixed timestamp for all seeded records
const FIXED_ISO = "2026-11-23T12:00:00.000Z";

// 1. Fixed Mailbox
console.log("[Seed Design Lock] Ensuring fixed mailbox...");
const { data: boxes } = await sb.from("mailboxes").select("id, email").limit(1);
let boxId = boxes?.[0]?.id || null;
if (!boxId) {
  const { data: newBoxId, error: boxErr } = await sb.rpc("save_mailbox", {
    box_id: null,
    email: "outreach@kestrelleads.com",
    from_name: "Staging Outreach",
    provider: "smtp",
    smtp_host: "smtp.example.com",
    smtp_port: 587,
    imap_host: "imap.example.com",
    imap_port: 993,
    username: "outreach@kestrelleads.com",
    password: crypto.randomBytes(18).toString("base64url"),
    daily_limit: 25,
    signature: "-- Staging Outreach Team"
  });
  if (boxErr) throw boxErr;
  boxId = newBoxId;
}

// 2. Fixed Campaigns
console.log("[Seed Design Lock] Resetting and seeding fixed campaigns...");
// Ensure target campaign exists with fixed data
const fixedCampaigns = [
  { id: "df0facc8-0394-470b-998d-a812eb927ef0", name: "Batch 003 – Default offer Good leads for agencies in NY" },
  { id: "78fac201-1d39-4411-851f-c0aa8acce1fb", name: "London Video Production Studios Q4" },
  { id: "9e561faf-0bff-4a81-a0c5-486bcbcf6b50", name: "SaaS Founders & Marketing Directors" },
];

for (const c of fixedCampaigns) {
  const { data: existing } = await sb.from("campaigns").select("id").eq("id", c.id).maybeSingle();
  if (!existing) {
    await sb.from("campaigns").insert({
      id: c.id,
      team_id: teamId,
      name: c.name,
      mailbox_ids: boxId ? [boxId] : [],
      time_zone: "Europe/London",
      window_start: 9,
      window_end: 17,
      weekdays_only: true,
      created_at: FIXED_ISO,
    });
  } else {
    await sb.from("campaigns").update({
      name: c.name,
      mailbox_ids: boxId ? [boxId] : [],
      created_at: FIXED_ISO,
    }).eq("id", c.id);
  }
}

// 3. Fixed Leads (4 clean deterministic leads with fixed dates and values)
console.log("[Seed Design Lock] Resetting and seeding fixed leads...");
const fixedLeads = [
  {
    id: "11111111-1111-1111-1111-111111111111",
    name: "Resend",
    category: "B2B SaaS Developer Platform",
    website: "https://resend.com",
    email: "team@resend.com",
    verdict: "Good",
    score: 80,
    outreach_approved: true,
    outreach_approved_at: FIXED_ISO,
    outreach_approved_by: userId,
    buying_trigger: "High volume transactional email growth",
    created_at: FIXED_ISO,
    dedupe_key: "fixed-resend-designlock",
  },
  {
    id: "22222222-2222-2222-2222-222222222222",
    name: "Stumptown Coffee Roasters",
    category: "Coffee Roastery & Retail",
    website: "https://www.stumptowncoffee.com",
    email: "hello@stumptowncoffee.com",
    verdict: "No",
    score: 10,
    outreach_approved: false,
    outreach_approved_at: null,
    outreach_approved_by: null,
    buying_trigger: null,
    created_at: FIXED_ISO,
    dedupe_key: "fixed-stumptown-designlock",
  },
  {
    id: "33333333-3333-3333-3333-333333333333",
    name: "MetaLab",
    category: "Digital Product Design Agency",
    website: "https://metalab.com",
    email: "contact@metalab.com",
    verdict: "No",
    score: 0,
    outreach_approved: false,
    outreach_approved_at: null,
    outreach_approved_by: null,
    buying_trigger: null,
    created_at: FIXED_ISO,
    dedupe_key: "fixed-metalab-designlock",
  },
  {
    id: "44444444-4444-4444-4444-444444444444",
    name: "Acme Analytics",
    category: "Analytics Platform",
    website: "https://acme.test",
    email: "founders@acme.test",
    verdict: "Maybe",
    score: 45,
    outreach_approved: false,
    outreach_approved_at: null,
    outreach_approved_by: null,
    buying_trigger: "Expanding sales pipeline",
    created_at: FIXED_ISO,
    dedupe_key: "fixed-acme-designlock",
  },
];

// Delete any leads not in our fixed set
await sb.from("leads").delete().eq("team_id", teamId).not("id", "in", `(${fixedLeads.map(l => l.id).join(",")})`);

for (const lead of fixedLeads) {
  const { data: existing } = await sb.from("leads").select("id").eq("id", lead.id).maybeSingle();
  if (!existing) {
    const { error: insErr } = await sb.from("leads").insert({
      ...lead,
      team_id: teamId,
    });
    if (insErr) console.error("Error inserting fixed lead:", lead.name, insErr.message);
  } else {
    const { error: updErr } = await sb.from("leads").update({
      ...lead,
      team_id: teamId,
    }).eq("id", lead.id);
    if (updErr) console.error("Error updating fixed lead:", lead.name, updErr.message);
  }
}

console.log("✓ Fixed dataset successfully seeded for design-lock verification.");
