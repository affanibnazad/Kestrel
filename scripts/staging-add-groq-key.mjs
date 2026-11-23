import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

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
const groqKey = env.STAGING_GROQ_KEY || "";

// Refuse to run unless Supabase URL contains staging project ref xjqtgvhnbyepfinqonzm
if (!url.includes("xjqtgvhnbyepfinqonzm")) {
  console.error("❌ Refusing to run: Supabase URL is not staging (xjqtgvhnbyepfinqonzm).");
  process.exit(1);
}

if (!groqKey) {
  console.error("❌ STAGING_GROQ_KEY not found in .env.staging.local.");
  process.exit(1);
}

const sb = createClient(url, anonKey);

async function main() {
  const { error: authError } = await sb.auth.signInWithPassword({ email, password });
  if (authError) {
    console.error("❌ Sign in failed:", authError.message);
    process.exit(1);
  }

  // Save the key using the SAME RPC the Integrations "Add key" button uses: public.set_team_key
  const { error: rpcError } = await sb.rpc("set_team_key", { service: "groq", value: groqKey });
  if (rpcError) {
    console.error("❌ set_team_key failed:", rpcError.message);
    process.exit(1);
  }

  const last4 = groqKey.slice(-4);
  console.log(`Groq key saved: last4 ****${last4}`);

  const { data: keys, error: listError } = await sb.rpc("list_team_keys");
  if (listError) {
    console.error("❌ list_team_keys failed:", listError.message);
    process.exit(1);
  }

  const providerNames = Array.isArray(keys) ? keys.map((k) => k.service).join(", ") : "";
  console.log(`list_team_keys provider names: ${providerNames || "(none)"}`);
}

main().catch((err) => {
  console.error("❌ Fatal error:", err?.message || err);
  process.exit(1);
});
