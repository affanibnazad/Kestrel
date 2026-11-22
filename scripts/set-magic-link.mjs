// Kestrel: put the Magic Link email (supabase/emails/magic-link.html) into the live Supabase project (kestrel-eu),
// the same as pasting it in Supabase → Authentication → Emails → Magic Link → Save. Only the email's content changes
// (its subject stays). Affan runs this himself:
//   node scripts/set-magic-link.mjs
// Reads the token from .supabase-token. Prints only whether it worked, never the token or any other setting.
import { readFileSync } from "node:fs";
const REF = "psocpxaphnfgbxpnkonk";
const token = readFileSync(new URL("../.supabase-token", import.meta.url), "utf8").trim();
if (!token) { console.log("The file .supabase-token is empty."); process.exit(1); }
const html = readFileSync(new URL("../supabase/emails/magic-link.html", import.meta.url), "utf8");
if (!html.includes("{{ .TokenHash }}") || !html.includes("{{ .RedirectTo }}")) { console.log("supabase/emails/magic-link.html does not look right (TokenHash / RedirectTo missing). Nothing was changed."); process.exit(1); }
const api = `https://api.supabase.com/v1/projects/${REF}/config/auth`;
const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

const res = await fetch(api, { method: "PATCH", headers, body: JSON.stringify({ mailer_templates_magic_link_content: html }) }).catch((e) => ({ ok: false, status: 0, text: async () => e.message }));
if (!res.ok) {
  const t = (await res.text()).slice(0, 300);
  console.log(`Supabase said ${res.status}: ${t}`);
  if (/smtp/i.test(t)) console.log("Supabase only allows changing emails when the project sends with its own email service (custom SMTP).");
  process.exit(1);
}
// Read it back and check (only this one field is looked at).
const check = await fetch(api, { headers }).then((r) => r.json()).catch(() => ({}));
const live = String(check.mailer_templates_magic_link_content ?? "");
console.log(live.includes("{{ .RedirectTo }}") && live.trim() === html.trim()
  ? "Done. The Magic Link email now sends people back to the app that asked (Kestrel Connect or the website)."
  : "Saved, but reading it back did not match. Open Supabase → Authentication → Emails → Magic Link to check.");
