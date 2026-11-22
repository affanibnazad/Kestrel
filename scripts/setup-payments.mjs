// Kestrel: connect Lemon Squeezy payments. Affan runs this himself (the AI is not allowed to change live systems):
//   node scripts/setup-payments.mjs
//
// Before running: in Lemon Squeezy make 3 subscription products named Starter, Pro and Agency (monthly, $9 / $19 / $49),
// a discount code LAUNCH50 (50% off, repeating for 3 months), and an API key pasted into the file .lemon-key.
//
// What it does (prints no secrets):
//   1. Finds your store, the three products and their checkout links, and the discount code.
//   2. Makes (or updates) the webhook https://kestrelleads.com/api/billing/webhook with a new random signing secret.
//   3. Saves the plans in Supabase (billing_plans) and the signing secret in Supabase Vault.
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

const REF = "psocpxaphnfgbxpnkonk";
const HOOK = "https://kestrelleads.com/api/billing/webhook";
const EVENTS = ["subscription_created", "subscription_updated", "subscription_cancelled", "subscription_resumed", "subscription_expired", "subscription_paused", "subscription_unpaused"];
const read = (f) => { try { return readFileSync(new URL(`../${f}`, import.meta.url), "utf8").trim(); } catch { return ""; } };
const lsKey = read(".lemon-key"), sbToken = read(".supabase-token");
if (!lsKey) { console.log("The file .lemon-key is empty. Paste your Lemon Squeezy API key into it, save, and run this again."); process.exit(1); }
if (!sbToken) { console.log("The file .supabase-token is empty."); process.exit(1); }

async function ls(path, method = "GET", body) {
  const res = await fetch(`https://api.lemonsqueezy.com/v1/${path}`, { method, headers: { accept: "application/vnd.api+json", "content-type": "application/vnd.api+json", authorization: `Bearer ${lsKey}` }, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) { console.log(`Lemon Squeezy said ${res.status} for ${path}: ${JSON.stringify(json.errors ?? json).slice(0, 300)}`); process.exit(1); }
  return json;
}
async function sql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, { method: "POST", headers: { authorization: `Bearer ${sbToken}`, "content-type": "application/json" }, body: JSON.stringify({ query }) });
  if (!res.ok) { console.log(`Supabase said ${res.status}: ${(await res.text()).slice(0, 300)}`); process.exit(1); }
}
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

console.log("1/3  Reading your Lemon Squeezy store...");
const stores = (await ls("stores")).data ?? [];
if (!stores.length) { console.log("No store found for this API key."); process.exit(1); }
const store = stores[0];
console.log(`     Store: ${store.attributes.name}${store.attributes.test_mode === false ? "" : " (test mode keys work too)"}`);
const products = (await ls(`products?filter[store_id]=${store.id}&page[size]=100`)).data ?? [];
const plans = [];
for (const plan of ["starter", "pro", "agency"]) {
  const p = products.find((x) => String(x.attributes.name).trim().toLowerCase().startsWith(plan) || String(x.attributes.name).toLowerCase().includes(`kestrel ${plan}`));
  if (!p) { console.log(`     No product named "${plan[0].toUpperCase() + plan.slice(1)}" found. Make it in Lemon Squeezy and run this again.`); process.exit(1); }
  // A product with one price has one variant marked "pending" (that is its default price); with several, use a published one.
  const variants = (await ls(`variants?filter[product_id]=${p.id}`)).data ?? [];
  const v = variants.find((x) => x.attributes.status === "published") ?? variants.find((x) => x.attributes.status === "pending");
  if (!v) { console.log(`     The product ${p.attributes.name} has no published price.`); process.exit(1); }
  if (!v.attributes.is_subscription) console.log(`     Note: ${p.attributes.name} is not a subscription. Set it to "Subscription, monthly" in Lemon Squeezy.`);
  plans.push({ plan, variant: String(v.id), url: p.attributes.buy_now_url, price: (v.attributes.price ?? 0) / 100 });
  console.log(`     ${plan}: ${p.attributes.name}, $${(v.attributes.price ?? 0) / 100}`);
}
const discounts = (await ls(`discounts?filter[store_id]=${store.id}`)).data ?? [];
const launch = discounts.find((d) => String(d.attributes.code).toUpperCase() === "LAUNCH50" && d.attributes.status === "published");
console.log(launch ? "     Discount LAUNCH50 found: it is added to every checkout." : "     No published discount LAUNCH50 found: checkouts will be full price.");

console.log("2/3  Making the payment webhook...");
const secret = randomBytes(20).toString("hex"); // 40 characters: the most Lemon Squeezy accepts
const hooks = (await ls(`webhooks?filter[store_id]=${store.id}`)).data ?? [];
const old = hooks.find((h) => h.attributes.url === HOOK);
if (old) await ls(`webhooks/${old.id}`, "PATCH", { data: { type: "webhooks", id: String(old.id), attributes: { url: HOOK, events: EVENTS, secret } } });
else await ls("webhooks", "POST", { data: { type: "webhooks", attributes: { url: HOOK, events: EVENTS, secret }, relationships: { store: { data: { type: "stores", id: String(store.id) } } } } });
console.log("     Webhook ready (secret not shown).");

console.log("3/3  Saving plans and the secret in Supabase...");
await sql(`
  insert into public.billing_plans (plan, variant_id, checkout_url, discount) values
  ${plans.map((p) => `(${q(p.plan)}, ${q(p.variant)}, ${q(p.url)}, ${launch ? q("LAUNCH50") : "null"})`).join(",\n  ")}
  on conflict (plan) do update set variant_id = excluded.variant_id, checkout_url = excluded.checkout_url, discount = excluded.discount;
  do $$ declare s uuid; begin
    select id into s from vault.secrets where name = 'kestrel:lemonsqueezy-webhook';
    if s is null then perform vault.create_secret(${q(secret)}, 'kestrel:lemonsqueezy-webhook', 'Lemon Squeezy webhook signing secret');
    else perform vault.update_secret(s, ${q(secret)}); end if;
  end $$;`);
console.log("Done. Plan buttons in the App now open Lemon Squeezy checkout, and payments unlock teams by themselves.");
