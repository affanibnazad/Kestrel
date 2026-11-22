// Kestrel Mail: makes the server secret that lets only the App's server read mailbox passwords.
// Affan runs it once (after database 014): node scripts/setup-mail.mjs   Then publish: bash scripts/deploy-vercel.sh
// It saves the secret in .mail-secret (private, never committed) and in Supabase Vault. Nothing secret is printed.
import { existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { randomBytes } from "node:crypto";

const REF = "psocpxaphnfgbxpnkonk";
const file = new URL("../.mail-secret", import.meta.url);
let secret = existsSync(file) ? readFileSync(file, "utf8").trim() : "";
if (secret.length < 32) { secret = randomBytes(32).toString("hex"); writeFileSync(file, secret + "\n", { mode: 0o600 }); chmodSync(file, 0o600); console.log("Made a new server secret in .mail-secret"); }
else console.log("Using the server secret already in .mail-secret");
const token = readFileSync(new URL("../.supabase-token", import.meta.url), "utf8").trim();
if (!token) { console.log("The file .supabase-token is empty."); process.exit(1); }
if (!/^[0-9a-f]{64}$/.test(secret)) { console.log(".mail-secret should be 64 letters and numbers (0-9, a-f). Delete it and run again."); process.exit(1); }
const query = `
do $$ declare old uuid; begin
  select id into old from vault.secrets where name = 'kestrel:mail-server-secret';
  if old is null then perform vault.create_secret('${secret}', 'kestrel:mail-server-secret', 'Kestrel: lets the App server read mailbox passwords');
  else perform vault.update_secret(old, '${secret}'); end if;
end $$;
select public.mail_server_ok('${secret}') as ok;`;
// A slow or patchy connection can time out: try up to 4 times (every migration is safe to run again).
let res;
for (let attempt = 1; attempt <= 4; attempt++) {
  try {
    res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
      method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ query }),
    });
    break;
  } catch (e) {
    if (attempt === 4) { console.log(`Could not reach Supabase (${e.cause?.code || e.message}). Check the internet connection and run the same command again.`); process.exit(1); }
    console.log(`No answer from Supabase yet (try ${attempt} of 4). Trying again…`);
    await new Promise((r) => setTimeout(r, 3000 * attempt));
  }
}
const text = await res.text();
if (!res.ok) { console.log(`Supabase said ${res.status}: ${text.replaceAll(secret, "[secret]").slice(0, 300)}`); process.exit(1); }
console.log(/"ok":\s*true/.test(text) ? "Done: the database knows the server secret. Now publish (bash scripts/deploy-vercel.sh)." : "Saved, but the check did not pass. Was database 014 run first?");
