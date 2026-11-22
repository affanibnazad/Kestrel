// Kestrel: make someone an admin (can make access codes and take access back in the App → Access).
// Affan runs this himself, once, with his own login email:
//   node scripts/make-admin.mjs you@yourdomain.com
//   node scripts/make-admin.mjs you@yourdomain.com --remove
import { readFileSync } from "node:fs";

const REF = "psocpxaphnfgbxpnkonk";
const email = String(process.argv[2] || "").trim().toLowerCase(), remove = process.argv.includes("--remove");
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { console.log("Say which account: node scripts/make-admin.mjs you@yourdomain.com"); process.exit(1); }
const token = readFileSync(new URL("../.supabase-token", import.meta.url), "utf8").trim();
const e = email.replace(/'/g, "''");
const query = remove
  ? `delete from public.admins where user_id in (select id from auth.users where lower(email) = '${e}') returning user_id;`
  : `insert into public.admins (user_id) select id from auth.users where lower(email) = '${e}' on conflict do nothing returning user_id;`;
const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ query }) });
if (!res.ok) { console.log(`Supabase said ${res.status}: ${(await res.text()).slice(0, 300)}`); process.exit(1); }
const rows = await res.json();
console.log(rows.length ? (remove ? "Removed as admin." : "Admin added. Open the App: Access is in the left bar.") : (remove ? "That email was not an admin." : "No account with that email (or it is already an admin)."));
