import "server-only";
import { createHmac } from "node:crypto";
import { safePost } from "./net";

// Delivers one item from the integration outbox (database 037): a signed webhook, or a HubSpot / Pipedrive sync when a lead
// becomes Interested, Meeting booked or Won. Each returns ok + HTTP status + a short reason; the database retries failures.
export type OutboxItem = { id: number; target: "webhook" | "hubspot" | "pipedrive"; event: string; payload: Payload; tries: number; url: string | null; secret: string | null };
type Lead = { email?: string; name?: string | null; website?: string | null; phone?: string | null; location?: string | null; contact?: string | null; campaign?: { name?: string } | null };
type Payload = { event: string; stage?: string; lead?: Lead } & Record<string, unknown>;
export type Delivery = { ok: boolean; status: number; error: string };

const short = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").slice(0, 280);
const done = (status: number, text = ""): Delivery => ({ ok: status >= 200 && status < 300, status, error: status >= 200 && status < 300 ? "" : short(`HTTP ${status} ${text}`) });

// ---------- webhooks: JSON body, signed like Stripe: X-Kestrel-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "t.body">
export function signature(secret: string, body: string, t = Math.floor(Date.now() / 1000)) {
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
}
export async function deliverWebhook(item: OutboxItem): Promise<Delivery> {
  if (!item.url || !item.secret) return { ok: false, status: 0, error: "This webhook was removed." };
  const body = JSON.stringify({ id: `evt_${item.id}`, ...item.payload });
  try {
    const r = await safePost(item.url, body, { "content-type": "application/json", "user-agent": "Kestrel-Webhooks/1.0 (+https://kestrelleads.com)",
      "x-kestrel-event": item.event, "x-kestrel-signature": signature(item.secret, body), "x-kestrel-delivery": String(item.id) });
    return done(r.status, r.text.slice(0, 120));
  } catch (e) { return { ok: false, status: 0, error: short((e as Error).message) }; }
}

// ---------- CRM helpers
const splitName = (full?: string | null) => {
  const p = String(full ?? "").trim().split(/\s+/).filter(Boolean);
  return { first: p[0] ?? "", last: p.slice(1).join(" ") };
};
const dealName = (l: Lead) => `Kestrel: ${String(l.name || l.email || "lead").slice(0, 120)}`;
async function call(url: string, init: RequestInit & { json?: unknown }) {
  const res = await fetch(url, { ...init, body: init.json === undefined ? undefined : JSON.stringify(init.json), redirect: "error", signal: AbortSignal.timeout(8_000),
    headers: { "content-type": "application/json", accept: "application/json", ...(init.headers ?? {}) } });
  const body = await res.json().catch(() => ({})) as Record<string, unknown>;
  return { status: res.status, ok: res.ok, body };
}
const fail = (where: string, r: { status: number; body: Record<string, unknown> }): Delivery =>
  ({ ok: false, status: r.status, error: short(`${where}: HTTP ${r.status} ${String((r.body as { message?: string; error?: string }).message ?? (r.body as { error?: string }).error ?? "")}`) });

// ---------- HubSpot (private app token, Bearer). Upsert the contact by email, then one deal per lead named "Kestrel: …",
// moved along the account's own default deal pipeline (stage ids differ per account, so they are read from the pipeline).
type Stage = { id: string; label: string; displayOrder: number; metadata?: { isClosed?: string; probability?: string } };
export async function syncHubspot(key: string, p: Payload): Promise<Delivery> {
  const l = p.lead ?? {};
  if (!l.email) return { ok: true, status: 204, error: "" };   // nothing to match on
  const H = { authorization: `Bearer ${key}` };
  const { first, last } = splitName(l.contact);
  const props: Record<string, string> = { email: l.email, ...(first ? { firstname: first } : {}), ...(last ? { lastname: last } : {}),
    ...(l.name ? { company: l.name } : {}), ...(l.website ? { website: l.website } : {}), ...(l.phone ? { phone: l.phone } : {}), ...(l.location ? { city: l.location } : {}) };
  const up = await call("https://api.hubapi.com/crm/v3/objects/contacts/batch/upsert", { method: "POST", headers: H, json: { inputs: [{ id: l.email, idProperty: "email", properties: props }] } });
  if (!up.ok) return fail("HubSpot contact", up);
  let contactId = String(((up.body.results as { id?: string }[] | undefined) ?? [])[0]?.id ?? "");
  if (!contactId) {   // the upsert answer did not include it: read the contact by email
    const g = await call(`https://api.hubapi.com/crm/v3/objects/contacts/${encodeURIComponent(l.email)}?idProperty=email`, { method: "GET", headers: H });
    contactId = String((g.body as { id?: string }).id ?? "");
  }
  const pipes = await call("https://api.hubapi.com/crm/v3/pipelines/deals", { method: "GET", headers: H });
  if (!pipes.ok) return fail("HubSpot pipeline", pipes);
  const pipe = ((pipes.body.results as { id: string; stages: Stage[] }[] | undefined) ?? []).find((x) => x.id === "default") ?? (pipes.body.results as { id: string; stages: Stage[] }[] | undefined)?.[0];
  if (!pipe?.stages?.length) return { ok: false, status: 0, error: "HubSpot: no deal pipeline found." };
  const open = pipe.stages.filter((s) => s.metadata?.isClosed !== "true").sort((a, b) => a.displayOrder - b.displayOrder);
  const won = pipe.stages.find((s) => s.metadata?.isClosed === "true" && Number(s.metadata?.probability) >= 1) ?? pipe.stages.find((s) => s.id === "closedwon");
  const meeting = open.find((s) => /appointment|meeting|call|demo/i.test(`${s.id} ${s.label}`)) ?? open[1] ?? open[0];
  // Interested must land on a different stage than Meeting booked (HubSpot's default pipeline starts with "Appointment scheduled").
  const interested = open.find((s) => s.id !== meeting?.id) ?? open[0];
  const stage = (p.stage === "won" ? won : p.stage === "meeting" ? meeting : interested)?.id;
  if (!stage) return { ok: false, status: 0, error: "HubSpot: the deal stage was not found." };

  const name = dealName(l);
  const found = await call("https://api.hubapi.com/crm/v3/objects/deals/search", { method: "POST", headers: H,
    json: { filterGroups: [{ filters: [{ propertyName: "dealname", operator: "EQ", value: name }] }], properties: ["dealname", "dealstage"], limit: 1 } });
  const existing = ((found.body.results as { id: string }[] | undefined) ?? [])[0]?.id;
  const r = existing
    ? await call(`https://api.hubapi.com/crm/v3/objects/deals/${existing}`, { method: "PATCH", headers: H, json: { properties: { dealstage: stage } } })
    : await call("https://api.hubapi.com/crm/v3/objects/deals", { method: "POST", headers: H, json: { properties: { dealname: name, pipeline: pipe.id, dealstage: stage },
        ...(contactId ? { associations: [{ to: { id: contactId }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 3 }] }] } : {}) } });
  return r.ok ? { ok: true, status: r.status, error: "" } : fail("HubSpot deal", r);
}

// ---------- Pipedrive (API token in the x-api-token header; API v2 for people, organisations and deals).
const firstId = (b: Record<string, unknown>) => {
  const d = b.data as { items?: { item?: { id?: number } }[]; id?: number } | undefined;
  return d?.items?.[0]?.item?.id ?? d?.id ?? null;
};
export async function syncPipedrive(key: string, p: Payload): Promise<Delivery> {
  const l = p.lead ?? {};
  if (!l.email) return { ok: true, status: 204, error: "" };
  const H = { "x-api-token": key };
  const me = await call("https://api.pipedrive.com/api/v1/users/me", { method: "GET", headers: H });
  if (!me.ok) return fail("Pipedrive sign-in", me);
  const domain = String((me.body.data as { company_domain?: string } | undefined)?.company_domain ?? "");
  const base = /^[a-z0-9-]+$/i.test(domain) ? `https://${domain}.pipedrive.com/api/v2` : "https://api.pipedrive.com/api/v2";
  const q = (path: string, term: string, field: string) => call(`${base}/${path}/search?term=${encodeURIComponent(term)}&fields=${field}&exact_match=true`, { method: "GET", headers: H });

  let orgId: number | null = null;
  if (l.name) {
    orgId = firstId((await q("organizations", l.name, "name")).body);
    if (!orgId) { const o = await call(`${base}/organizations`, { method: "POST", headers: H, json: { name: l.name.slice(0, 200) } }); if (!o.ok) return fail("Pipedrive organisation", o); orgId = firstId(o.body); }
  }
  let personId = firstId((await q("persons", l.email, "email")).body);
  if (!personId) {
    const pr = await call(`${base}/persons`, { method: "POST", headers: H, json: { name: (l.contact || l.name || l.email).slice(0, 200), ...(orgId ? { org_id: orgId } : {}),
      emails: [{ value: l.email, primary: true, label: "work" }], ...(l.phone ? { phones: [{ value: l.phone, primary: true, label: "work" }] } : {}) } });
    if (!pr.ok) return fail("Pipedrive person", pr);
    personId = firstId(pr.body);
  }
  const title = dealName(l);
  let dealId = firstId((await q("deals", title, "title")).body);
  if (!dealId) {
    const d = await call(`${base}/deals`, { method: "POST", headers: H, json: { title, ...(personId ? { person_id: personId } : {}), ...(orgId ? { org_id: orgId } : {}) } });
    if (!d.ok) return fail("Pipedrive deal", d);
    dealId = firstId(d.body);
  }
  if (p.stage === "won" && dealId) {
    const w = await call(`${base}/deals/${dealId}`, { method: "PATCH", headers: H, json: { status: "won" } });
    if (!w.ok) return fail("Pipedrive won", w);
  }
  return { ok: true, status: 200, error: "" };
}

export async function deliver(item: OutboxItem): Promise<Delivery> {
  try {
    if (item.target === "webhook") return await deliverWebhook(item);
    if (!item.secret) return { ok: false, status: 0, error: "The CRM key was removed." };
    return item.target === "hubspot" ? await syncHubspot(item.secret, item.payload) : await syncPipedrive(item.secret, item.payload);
  } catch (e) { return { ok: false, status: 0, error: short((e as Error).message) }; }
}
