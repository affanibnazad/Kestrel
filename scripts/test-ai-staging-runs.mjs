// scripts/test-ai-staging-runs.mjs
// Real staging calls for research, explain, reply_suggest, and reply_label
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

async function main() {
  console.log("1. Signing in as staging test user...");
  const { data: authData, error: authError } = await sb.auth.signInWithPassword({ email, password });
  if (authError || !authData.session) {
    console.error("❌ Sign in failed:", authError?.message);
    process.exit(1);
  }

  const token = authData.session.access_token;
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };

  // Ensure test lead has website https://example.com for research
  const testLeadId = "ffac0087-5e8e-45ab-bf86-b0e95397e3b1";
  await sb.from("leads").update({ website: "https://example.com" }).eq("id", testLeadId);

  // 1. Research
  console.log("\n2. Calling /api/ai for task: research...");
  const researchRes = await fetch("http://localhost:3333/api/ai", {
    method: "POST",
    headers,
    body: JSON.stringify({
      task: "research",
      offerId: "current",
      ids: [testLeadId],
    }),
  });
  const researchData = await researchRes.json();
  console.log("Research response:", researchRes.status, JSON.stringify(researchData));

  // 2. Explain
  console.log("\n3. Calling /api/ai for task: explain...");
  const explainRes = await fetch("http://localhost:3333/api/ai", {
    method: "POST",
    headers,
    body: JSON.stringify({
      task: "explain",
      text: "Explain why cold email campaigns should use custom tracking domains.",
    }),
  });
  const explainData = await explainRes.json();
  console.log("Explain response:", explainRes.status, JSON.stringify(explainData));

  // 3. Reply Suggest
  console.log("\n4. Calling /api/ai for task: reply_suggest...");
  const replySuggestRes = await fetch("http://localhost:3333/api/ai", {
    method: "POST",
    headers,
    body: JSON.stringify({
      task: "reply_suggest",
      text: "We might be open to talking next month. Could you share some recent case studies?",
    }),
  });
  const replySuggestData = await replySuggestRes.json();
  console.log("Reply suggest response:", replySuggestRes.status, JSON.stringify(replySuggestData));

  // 4. Reply Label
  console.log("\n5. Calling /api/ai for task: reply_label...");
  const replyLabelRes = await fetch("http://localhost:3333/api/ai", {
    method: "POST",
    headers,
    body: JSON.stringify({
      task: "reply_label",
      text: "Sounds great, let's jump on a quick 15-minute call tomorrow at 10am.",
    }),
  });
  const replyLabelData = await replyLabelRes.json();
  console.log("Reply label response:", replyLabelRes.status, JSON.stringify(replyLabelData));

  // 5. Query ai_runs log
  console.log("\n6. Querying staging ai_runs table...");
  const { data: runs, error: runsError } = await sb
    .from("ai_runs")
    .select("id, task, provider, model, source, attempt, ms, tokens_in, tokens_out, cost_usd, status, error, created_at")
    .order("id", { ascending: false })
    .limit(20);

  if (runsError) {
    console.error("❌ Failed to query ai_runs:", runsError.message);
  } else {
    console.log("\n--- Latest ai_runs entries ---");
    console.table(runs);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
