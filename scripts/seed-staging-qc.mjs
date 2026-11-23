// scripts/seed-staging-qc.mjs
// Seeds QC review sample data for the STAGING test user's team ONLY.
// Enforces strict check: REFUSES to run if Supabase project ref is not xjqtgvhnbyepfinqonzm.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createBrowserClient } from "@supabase/ssr";

// 1. Load staging environment
const envPath = path.join(process.cwd(), ".env.staging.local");
if (fs.existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";
const STAGING_EMAIL = process.env.STAGING_TEST_EMAIL || "";
const STAGING_PASSWORD = process.env.STAGING_TEST_PASSWORD || "";

// Mandatory security assertion: refuse to run if ref is not xjqtgvhnbyepfinqonzm
const REQUIRED_REF = "xjqtgvhnbyepfinqonzm";
if (!SUPABASE_URL.includes(REQUIRED_REF)) {
  console.error(`❌ CRITICAL SECURITY ERROR: Target Supabase URL "${SUPABASE_URL}" is NOT staging (${REQUIRED_REF}).`);
  console.error("Execution refused. This script is strictly permitted on staging only.");
  process.exit(1);
}

const SEED_SQL = `
-- scripts/seed-staging-qc.sql
-- Seed sample data for STAGING test user: staging-test@kestrelleads.com (team 36d85765-d04c-487a-a515-dc062bd3123a)

-- 1. Free Access Grant (30 days of free Pro access)
INSERT INTO public.access_grants (id, team_id, code, plan, starts_at, ends_at, claimed_by)
VALUES (
  'c0000000-0000-0000-0000-000000000001',
  '36d85765-d04c-487a-a515-dc062bd3123a',
  'QC-FREE-ACCESS-2026',
  'pro',
  now(),
  now() + interval '30 days',
  '6e25520a-5a9a-4b30-8f80-bc0b149f22ad'
) ON CONFLICT (id) DO UPDATE SET ends_at = now() + interval '30 days', revoked_at = null;

-- 2. 2 Reply Threads with real conversation history
INSERT INTO public.campaign_leads (id, campaign_id, team_id, to_email, lead_name, status, first_sent_at, steps)
VALUES 
  ('e0000000-0000-0000-0000-000000000001', 'df0facc8-0394-470b-998d-a812eb927ef0', '36d85765-d04c-487a-a515-dc062bd3123a', 'sarah.connor@cyberdyne.test', 'Sarah Connor', 'replied', now() - interval '2 days', '[{"day": 0, "subject": "Video production for Cyberdyne", "body": "Hi Sarah, quick question regarding video production."}]'::jsonb),
  ('e0000000-0000-0000-0000-000000000002', '78fac201-1d39-4411-851f-c0aa8acce1fb', '36d85765-d04c-487a-a515-dc062bd3123a', 'marcus.wright@resistance.test', 'Marcus Wright', 'replied', now() - interval '1 day', '[{"day": 0, "subject": "Content strategy for Q4", "body": "Hey Marcus, loved your recent release."}]'::jsonb)
ON CONFLICT (id) DO UPDATE SET first_sent_at = excluded.first_sent_at;

-- Mail replies (real text)
INSERT INTO public.mail_replies (id, team_id, mailbox_id, campaign_id, campaign_lead_id, kind, from_email, lead_email, subject, snippet, body, received_at, handled, ai_label)
VALUES 
  ('f0000000-0000-0000-0000-000000000001', '36d85765-d04c-487a-a515-dc062bd3123a', '11fd90e3-31e1-4115-a522-46b8a46f306d', 'df0facc8-0394-470b-998d-a812eb927ef0', 'e0000000-0000-0000-0000-000000000001', 'reply', 'sarah.connor@cyberdyne.test', 'sarah.connor@cyberdyne.test', 'Re: Video production for Cyberdyne', 'Yes, we are currently reviewing video production proposals for next month. Can you send over a deck and pricing?', 'Yes, we are currently reviewing video production proposals for next month. Can you send over a deck and pricing?\n\nBest,\nSarah Connor\nCyberdyne Systems', now() - interval '1 day', false, 'interested'),
  ('f0000000-0000-0000-0000-000000000002', '36d85765-d04c-487a-a515-dc062bd3123a', '11fd90e3-31e1-4115-a522-46b8a46f306d', '78fac201-1d39-4411-851f-c0aa8acce1fb', 'e0000000-0000-0000-0000-000000000002', 'reply', 'marcus.wright@resistance.test', 'marcus.wright@resistance.test', 'Re: Content strategy for Q4', 'Thanks for reaching out. Let us set up a call next Tuesday at 2pm GMT.', 'Thanks for reaching out. Let us set up a call next Tuesday at 2pm GMT.\n\nCheers,\nMarcus', now() - interval '4 hours', false, 'meeting')
ON CONFLICT (id) DO UPDATE SET snippet = excluded.snippet, body = excluded.body;
`;

async function main() {
  console.log("================================================================================");
  console.log(`SEEDING STAGING TEST USER (REF: ${REQUIRED_REF})`);
  console.log("================================================================================\n");

  const cookieJar = {};
  const sb = createBrowserClient(SUPABASE_URL, SUPABASE_KEY, {
    cookies: {
      getAll: () => Object.entries(cookieJar).map(([name, value]) => ({ name, value })),
      setAll: (cs) => cs.forEach(({ name, value }) => { cookieJar[name] = value; }),
    },
  });

  console.log(`[Auth] Signing in as ${STAGING_EMAIL}...`);
  const { data: auth, error: authErr } = await sb.auth.signInWithPassword({
    email: STAGING_EMAIL,
    password: STAGING_PASSWORD,
  });

  if (authErr || !auth?.session) {
    console.error("❌ Authentication failed:", authErr?.message);
    process.exit(1);
  }
  console.log("✓ Signed in successfully. User ID:", auth.user.id);

  const { data: acc } = await sb.rpc("my_account");
  const teamId = acc.team_id;
  console.log("✓ Active team ID:", teamId);

  // 1. Mailbox
  console.log("\n[1/4] Ensuring sender mailbox...");
  let boxId = null;
  const { data: boxes } = await sb.from("mailboxes").select("id, email").limit(1);
  if (boxes && boxes.length > 0) {
    boxId = boxes[0].id;
    console.log(`  Existing mailbox found: ${boxes[0].email} (${boxId})`);
  } else {
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
    if (boxErr) console.error("  Error creating mailbox:", boxErr);
    else {
      boxId = newBoxId;
      console.log(`  Created mailbox: outreach@kestrelleads.com (${boxId})`);
    }
  }

  // 2. 3 Campaigns
  console.log("\n[2/4] Ensuring 3 campaigns (including long name)...");
  const campaigns = [
    { id: "df0facc8-0394-470b-998d-a812eb927ef0", name: "Batch 003 – Default offer Good leads for agencies in NY" },
    { id: "78fac201-1d39-4411-851f-c0aa8acce1fb", name: "London Video Production Studios Q4" },
    { id: "9e561faf-0bff-4a81-a0c5-486bcbcf6b50", name: "SaaS Founders & Marketing Directors" },
  ];

  for (const c of campaigns) {
    const { data: existing } = await sb.from("campaigns").select("id, name").eq("name", c.name).maybeSingle();
    if (!existing) {
      const { data: created, error: cErr } = await sb.from("campaigns").insert({
        team_id: teamId,
        name: c.name,
        mailbox_ids: boxId ? [boxId] : [],
        time_zone: "Europe/London",
        window_start: 9,
        window_end: 17,
        weekdays_only: true,
      }).select("id, name").single();
      if (cErr) console.error(`  Error creating "${c.name}":`, cErr.message);
      else console.log(`  Created campaign: "${created.name}" (${created.id})`);
    } else {
      if (boxId) {
        await sb.from("campaigns").update({ mailbox_ids: [boxId] }).eq("id", existing.id);
      }
      console.log(`  Campaign ready: "${existing.name}" (${existing.id})`);
    }
  }

  // 3. 4 Extension Keys (1 active today, 3 old)
  console.log("\n[3/4] Ensuring 4 extension keys (1 active, 3 old)...");
  const { data: existingKeys } = await sb.from("extension_keys").select("id, label, last_used_at").order("created_at", { ascending: false });
  if (!existingKeys || existingKeys.length < 4) {
    // Key 1: Active
    const { data: token } = await sb.rpc("create_extension_key", { label: "Chrome MacBook Air (Active)" });
    if (token) {
      await sb.rpc("ext_whoami", { k: token });
      console.log("  Created & activated key: Chrome MacBook Air (Active)");
    }
    // Keys 2-4: Older
    await sb.rpc("create_extension_key", { label: "Brave Desktop London (Old 1)" });
    await sb.rpc("create_extension_key", { label: "Edge Workstation (Old 2)" });
    await sb.rpc("create_extension_key", { label: "Chrome Studio Mac (Old 3)" });
    console.log("  Created 3 older keys: Brave Desktop London, Edge Workstation, Chrome Studio Mac");
  } else {
    console.log(`  Already have ${existingKeys.length} extension keys in database.`);
  }

  // 4. Access Grants & Reply Threads (Writes SQL for dashboard execution)
  console.log("\n[4/4] Writing access grant + reply threads SQL...");
  const sqlFile = path.join(process.cwd(), "scripts", "seed-staging-qc.sql");
  fs.writeFileSync(sqlFile, SEED_SQL.trim() + "\n", "utf8");
  console.log(`  Saved SQL statements to ${sqlFile}`);
  console.log("  Run scripts/seed-staging-qc.sql in the Supabase Dashboard SQL Editor.");

  console.log("\n================================================================================");
  console.log("SEEDING COMPLETE");
  console.log("================================================================================");
}

main().catch((err) => {
  console.error("Execution error:", err);
  process.exit(1);
});
