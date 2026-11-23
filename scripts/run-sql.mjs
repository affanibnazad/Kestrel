// Kestrel: run one SQL file on the live Supabase project (kestrel-eu) through the Supabase Management API.
// Affan runs this himself (the AI is not allowed to change the live database):
//   node scripts/run-sql.mjs supabase/migrations/003_signup_details.sql
// Reads the token from .supabase-token. Prints only the result, never the token.
import { readFileSync } from "node:fs";

const isStaging = process.argv.includes("--staging");
const REF = isStaging ? "xjqtgvhnbyepfinqonzm" : "psocpxaphnfgbxpnkonk";
const file = process.argv.find((a, i) => i >= 2 && !a.startsWith("--"));
if (!file) { console.log("Say which file: node scripts/run-sql.mjs [--staging] supabase/migrations/<file>.sql"); process.exit(1); }
let token = "";
try {
  token = readFileSync(new URL("../.supabase-token", import.meta.url), "utf8").trim();
} catch {
  console.log("The file .supabase-token does not exist. Paste your Supabase access token into .supabase-token and run this again.");
  process.exit(1);
}
if (!token) { console.log("The file .supabase-token is empty."); process.exit(1); }
// One Supabase access token only (sbp_ + 40 letters and numbers). Checked here so a wrong file never reaches an error
// message: messages from the network can repeat the header, and the token must never be printed (19 Nov 2026).
if (!/^sbp_[A-Za-z0-9]{40,}$/.test(token)) {
  console.log(`The file .supabase-token should hold exactly one Supabase access token (starts with sbp_, one line). It now has ${token.split(/\s+/).length} parts. Open it, select everything, paste one token, save.`);
  process.exit(1);
}
// Never print anything that might contain the token.
const safe = (m) => String(m ?? "").split(token).join("[token]").replace(/sbp_[A-Za-z0-9]+/g, "[token]");
const query = readFileSync(file, "utf8");
// A slow or patchy connection can time out: try up to 4 times (every migration is safe to run again).
let res;
for (let attempt = 1; attempt <= 4; attempt++) {
  try {
    res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
      method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ query }),
    });
    break;
  } catch (e) {
    if (attempt === 4) { console.log(`Could not reach Supabase (${safe(e.cause?.code || e.message)}). Check the internet connection and run the same command again.`); process.exit(1); }
    console.log(`No answer from Supabase yet (try ${attempt} of 4). Trying again…`);
    await new Promise((r) => setTimeout(r, 3000 * attempt));
  }
}
const text = await res.text();
// --full (19 Nov 2026): print every result row, one per line (for read-only checks such as scripts/diag-slow.sql).
if (res.ok && process.argv.includes("--full")) {
  let rows; try { rows = JSON.parse(text); } catch { rows = null; }
  console.log(`Done (${res.status}).`);
  if (Array.isArray(rows)) for (const r of rows.slice(0, 200)) console.log(safe(Object.values(r).join("  |  ")).slice(0, 400));
  else console.log(safe(text.slice(0, 8000)));
} else console.log(res.ok ? `Done (${res.status}). ${safe(text.slice(0, 300))}` : `Supabase said ${res.status}: ${safe(text.slice(0, 400))}`);
