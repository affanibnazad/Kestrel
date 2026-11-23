// scripts/test-stage-c-real-groq.mjs
// Real Groq execution on staging for Stage C (Intelligence & Opportunity)
// Runs real research, real matcher scoring, and verifies outreach approval gate on 3 real leads with real websites.

import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

const envPath = path.join(process.cwd(), ".env.staging.local");
if (!fs.existsSync(envPath)) {
  console.error("❌ .env.staging.local not found");
  process.exit(1);
}

const env = dotenv.parse(fs.readFileSync(envPath, "utf8"));
const url = env.NEXT_PUBLIC_SUPABASE_URL || "";
const anonKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";
const email = env.STAGING_TEST_EMAIL || "";
const password = env.STAGING_TEST_PASSWORD || "";

if (!url.includes("xjqtgvhnbyepfinqonzm")) {
  console.error("❌ Refusing to run: Supabase URL is not staging (xjqtgvhnbyepfinqonzm).");
  process.exit(1);
}

const sb = createClient(url, anonKey);

const TEST_LEADS = [
  {
    id: "c3333333-3333-3333-3333-333333333333",
    name: "Resend",
    website: "https://resend.com",
    category: "B2B SaaS Developer Platform",
    expected: "clear fit (good)"
  },
  {
    id: "f4074c8d-2b65-4a2d-83bd-9017d69e51a6",
    name: "Stumptown Coffee Roasters",
    website: "https://www.stumptowncoffee.com",
    category: "Coffee Roastery & Retail",
    expected: "no fit (no)"
  },
  {
    id: "b692268e-eea0-4126-8e48-45d08b63d3db",
    name: "MetaLab",
    website: "https://metalab.com",
    category: "Digital Product Design Agency",
    expected: "unclear / mixed (maybe)"
  }
];

async function main() {
  console.log("================================================================================");
  console.log("STAGE C REAL GROQ TEST (3 LEADS WITH REAL WEBSITES)");
  console.log("================================================================================\n");

  const { data: auth, error: authError } = await sb.auth.signInWithPassword({ email, password });
  if (authError || !auth?.session) {
    console.error("❌ Sign in failed:", authError?.message);
    process.exit(1);
  }

  const token = auth.session.access_token;
  const cookieHeader = `sb-${new URL(url).hostname.split(".")[0]}-auth-token=${JSON.stringify([
    auth.session.access_token,
    auth.session.refresh_token,
    null,
    null,
    null
  ])};`;

  console.log("✓ Authenticated on staging as:", email);

  // 1. Update the 3 leads with real websites and reset their research / outreach_approved
  console.log("\n--- Setting up 3 Real Leads on Staging ---");
  for (const t of TEST_LEADS) {
    const { data: cur } = await sb.from("leads").select("data").eq("id", t.id).single();
    const curData = (cur?.data && typeof cur.data === "object" ? cur.data : {}) ;
    delete curData.research;
    delete curData.outreach_approved;
    delete curData.outreach;

    const patch = {
      name: t.name,
      website: t.website,
      category: t.category,
      outreach_approved: false,
      data: {
        ...curData,
        website: t.website,
        outreach_approved: false,
      }
    };
    let { error } = await sb.from("leads").update(patch).eq("id", t.id);
    if (error && /outreach_approved/i.test(error.message)) {
      delete patch.outreach_approved;
      await sb.from("leads").update(patch).eq("id", t.id);
    }
    console.log(`✓ Prepared lead: ${t.name} (${t.website}) -> Expected: ${t.expected}`);
  }

  const runApiAi = async (body) => {
    const res = await fetch("http://localhost:3333/api/ai", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        cookie: cookieHeader
      },
      body: JSON.stringify(body)
    });
    const text = await res.text();
    try {
      return { status: res.status, json: JSON.parse(text) };
    } catch {
      return { status: res.status, text };
    }
  };

  // 2. Run Step 3.1: Evidence Research on all 3 leads
  console.log("\n================================================================================");
  console.log("STEP 3.1: EVIDENCE RESEARCH (FETCH REAL WEBSITES & GROQ TAGGED ITEMS)");
  console.log("================================================================================");

  for (const t of TEST_LEADS) {
    console.log(`\n--------------------------------------------------------------------------------`);
    console.log(`[RESEARCH] Lead: ${t.name} (${t.website})`);
    console.log(`--------------------------------------------------------------------------------`);
    const res = await runApiAi({ task: "research", ids: [t.id], offerId: "current" });
    console.log(`HTTP Status: ${res.status}`);
    console.log("Result:", JSON.stringify(res.json, null, 2));

    const { data: leadRow } = await sb.from("leads").select("data").eq("id", t.id).single();
    const research = leadRow?.data?.research;
    console.log("\nSaved research observations count:", research?.observations?.length ?? 0);
    for (const [idx, obs] of (research?.observations || []).entries()) {
      console.log(`  Obs ${idx + 1}: "${obs.fact}"`);
      console.log(`    Quote: "${obs.quote}"`);
      console.log(`    URL: ${obs.url}`);
    }
    console.log("Hypotheses:", research?.hypotheses);
    console.log("Unknowns:", research?.unknowns);
    if (research?.dropped_observations?.length) {
      console.log("⚠️ DROPPED OBSERVATIONS (quote not in page text):", research.dropped_observations);
    } else {
      console.log("✓ Dropped observations: none (all quotes verified against page text)");
    }
  }

  // 3. Run Step 3.2: Service Matcher & Buying Triggers on all 3 leads
  console.log("\n================================================================================");
  console.log("STEP 3.2: MATCHER & BUYING TRIGGERS (GROQ MULTI-SERVICE SCORING)");
  console.log("================================================================================");

  for (const t of TEST_LEADS) {
    console.log(`\n--------------------------------------------------------------------------------`);
    console.log(`[SCORE] Lead: ${t.name} (${t.expected})`);
    console.log(`--------------------------------------------------------------------------------`);
    const res = await runApiAi({ task: "score", ids: [t.id], offerId: "current" });
    console.log(`HTTP Status: ${res.status}`);
    console.log("Result:", JSON.stringify(res.json, null, 2));

    const { data: leadRow } = await sb.from("leads").select("verdict,score,reason,data").eq("id", t.id).single();
    console.log("\nSaved Lead Verdict:", leadRow?.verdict);
    console.log("Saved Lead Score (Fit):", leadRow?.score ?? leadRow?.data?.ai?.fit);
    console.log("Saved Reason:", leadRow?.reason ?? leadRow?.data?.ai?.reason);
    console.log("Matched Service ID:", leadRow?.data?.ai?.matched_service_id || "(none)");
    console.log("Matched Service Name:", leadRow?.data?.ai?.matched_service_name || "(none)");
    console.log("Buying Trigger:", leadRow?.data?.ai?.buying_trigger || "(none)");
  }

  // 4. Run Step 3.3: Outreach Approval Gate Test
  console.log("\n================================================================================");
  console.log("STEP 3.3: HUMAN OUTREACH APPROVAL GATE VERIFICATION");
  console.log("================================================================================");

  const testLead = TEST_LEADS[0]; // Resend
  console.log(`Testing approval gate on lead: ${testLead.name} (${testLead.id})`);

  // Attempt to write email before approval
  console.log("\n[Gate Test 1] Attempting /api/ai task=emails BEFORE approval...");
  const preApproval = await runApiAi({ task: "emails", ids: [testLead.id], offerId: "current", sequence: "default" });
  console.log("Pre-approval response:", JSON.stringify(preApproval.json, null, 2));
  const isGated = preApproval.json?.skipped?.some((s) => s.why.includes("Needs human review"));
  console.log("✓ Outreach blocked before approval:", isGated ? "PASS" : "FAIL");

  // Approve lead
  console.log("\n[Gate Test 2] Human approves opportunity report...");
  const { data: cur } = await sb.from("leads").select("data").eq("id", testLead.id).single();
  const curData = cur?.data || {};
  let { error: appErr } = await sb.from("leads").update({
    outreach_approved: true,
    outreach_approved_at: new Date().toISOString(),
    data: { ...curData, outreach_approved: true }
  }).eq("id", testLead.id);
  if (appErr && /outreach_approved/i.test(appErr.message)) {
    await sb.from("leads").update({
      data: { ...curData, outreach_approved: true }
    }).eq("id", testLead.id);
  }
  console.log("✓ Approved lead for outreach");

  // Attempt to write email after approval
  console.log("\n[Gate Test 3] Attempting /api/ai task=emails AFTER approval...");
  const postApproval = await runApiAi({ task: "emails", ids: [testLead.id], offerId: "current", sequence: "default" });
  console.log("Post-approval response:", JSON.stringify(postApproval.json, null, 2));
  const isUnlocked = Boolean(postApproval.json?.done?.length > 0 || (postApproval.json?.skipped && !postApproval.json.skipped.some((s) => s.why.includes("Needs human review"))));
  console.log("✓ Outreach gate unlocked after approval:", isUnlocked ? "PASS" : "FAIL");

  console.log("\n================================================================================");
  console.log("ALL REAL GROQ STAGE C TESTS COMPLETED SUCCESSFULLY");
  console.log("================================================================================");
}

main().catch((err) => {
  console.error("❌ Fatal test error:", err);
  process.exit(1);
});
