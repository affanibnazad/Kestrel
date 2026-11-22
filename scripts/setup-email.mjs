// Kestrel: connect Resend as Supabase's email sender, set the branded email templates and the email limit.
// Reads two private files that Affan fills in (never printed): .supabase-token and .resend-key.
// Run: node scripts/setup-email.mjs
import { readFileSync } from "node:fs";
const read = (f) => { try { return readFileSync(f, "utf8").trim(); } catch { return ""; } };
const REF = "psocpxaphnfgbxpnkonk";
const DOMAIN = "kestrelleads.com";
const SENDER = `hello@${DOMAIN}`;
const sbToken = read(".supabase-token");
const resendKey = read(".resend-key");
if (!sbToken) { console.log("The file .supabase-token is empty."); process.exit(1); }
if (!resendKey) { console.log("The file .resend-key is empty."); process.exit(1); }

// 1. Resend: is the domain added and verified? Add it if missing and print the DNS records (not secret).
const rs = (path, opts = {}) => fetch(`https://api.resend.com${path}`, { ...opts, headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" } });
let r = await rs("/domains");
if (r.status === 401 || r.status === 403) {
  console.log("Resend did not accept the key. If it is a 'Sending access' key that is fine for email, but this check needs a 'Full access' key. Continuing without the domain check.");
} else {
  const list = (await r.json()).data || [];
  let d = list.find((x) => x.name === DOMAIN);
  if (!d) { const c = await rs("/domains", { method: "POST", body: JSON.stringify({ name: DOMAIN }) }); d = await c.json(); console.log(`Added ${DOMAIN} to Resend.`); }
  const full = await (await rs(`/domains/${d.id}`)).json();
  console.log(`Resend domain ${DOMAIN}: ${full.status}`);
  if (full.status !== "verified") {
    await rs(`/domains/${d.id}/verify`, { method: "POST" });
    console.log("Add these records at Hostinger → kestrelleads.com → DNS (then Resend checks again):");
    for (const x of full.records || []) console.log(`  ${x.type.padEnd(5)} name: ${x.name.padEnd(28)} value: ${x.value}${x.priority ? `  priority: ${x.priority}` : ""}   [${x.status}]`);
  }
}

// 2. Supabase: email sender, limit and branded templates.
const tpl = (f) => readFileSync(`supabase/emails/${f}`, "utf8");
const body = {
  external_email_enabled: true,
  site_url: `https://${DOMAIN}`,
  uri_allow_list: [`https://${DOMAIN}/**`, `https://www.${DOMAIN}/**`, "http://localhost:3100/**"].join(","),
  smtp_admin_email: SENDER, smtp_sender_name: "Kestrel",
  smtp_host: "smtp.resend.com", smtp_port: "465", smtp_user: "resend", smtp_pass: resendKey,
  rate_limit_email_sent: 30,
  mailer_subjects_confirmation: "Confirm your Kestrel account", mailer_templates_confirmation_content: tpl("confirm-signup.html"),
  mailer_subjects_magic_link: "Your Kestrel sign-in link", mailer_templates_magic_link_content: tpl("magic-link.html"),
  mailer_subjects_invite: "You're invited to Kestrel", mailer_templates_invite_content: tpl("invite-user.html"),
};
r = await fetch(`https://api.supabase.com/v1/projects/${REF}/config/auth`, { method: "PATCH", headers: { Authorization: `Bearer ${sbToken}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
if (!r.ok) { console.log(`Supabase refused (${r.status}): ${(await r.text()).slice(0, 300)}`); process.exit(1); }
const cfg = await r.json();
console.log("Supabase updated:");
console.log(`  Email sender: ${cfg.smtp_host ? `${cfg.smtp_host} as ${cfg.smtp_admin_email}` : "NOT SET"}`);
console.log(`  Email limit per hour: ${cfg.rate_limit_email_sent}`);
console.log(`  Templates: confirm ${/auth\/confirm/.test(cfg.mailer_templates_confirmation_content || "") ? "ok" : "not set"}, sign-in ${/auth\/confirm/.test(cfg.mailer_templates_magic_link_content || "") ? "ok" : "not set"}, invite ${/auth\/confirm/.test(cfg.mailer_templates_invite_content || "") ? "ok" : "not set"}`);
