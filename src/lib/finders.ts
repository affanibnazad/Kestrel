import "server-only";

// Email finders tried after Hunter (Find emails): Apollo, then Findymail. Both need a person's name and the company's
// domain (from Hunter's contacts, a CSV import or Companies House directors), so they find the decision maker's work email.
// Each returns { email } when found, { stop } when that finder must not be asked again in this run (key, credits, limits).
export type Found = { email?: string; stop?: string };
const clean = (e: unknown) => {
  const s = String(e ?? "").trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s) && !/email_not_unlocked|domain\.com$/.test(s) ? s : "";
};
const split = (name: string) => { const p = name.trim().split(/\s+/); return { first: p[0] ?? "", last: p.slice(1).join(" ") }; };

export async function apolloFind(key: string, name: string, domain: string): Promise<Found> {
  const { first, last } = split(name);
  if (!first || !last || !domain) return {};
  const qs = new URLSearchParams({ first_name: first, last_name: last, domain, reveal_personal_emails: "false" });
  const res = await fetch(`https://api.apollo.io/api/v1/people/match?${qs}`, { method: "POST", headers: { "x-api-key": key, "content-type": "application/json", accept: "application/json" },
    signal: AbortSignal.timeout(15_000), redirect: "error" }).catch(() => null);
  if (!res) return {};
  if (res.status === 401 || res.status === 403) return { stop: "Apollo did not accept your team's key (or it lacks People Enrichment). Check it in Connections." };
  if (res.status === 402 || res.status === 422 && /credit/i.test(await res.clone().text().catch(() => ""))) return { stop: "Apollo: no credits left." };
  if (res.status === 429) return { stop: "Apollo: too many lookups at once. Stopped for now." };
  if (!res.ok) return {};
  const j = await res.json().catch(() => ({})) as { person?: { email?: string; email_status?: string } };
  const status = String(j.person?.email_status ?? "");
  return status && !/^(verified|likely to engage|guessed)$/i.test(status.trim()) ? {} : { email: clean(j.person?.email) || undefined };
}

export async function findymailFind(key: string, name: string, domain: string): Promise<Found> {
  if (!name.trim() || !domain) return {};
  const res = await fetch("https://app.findymail.com/api/search/name", { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ name: name.trim().slice(0, 120), domain }), signal: AbortSignal.timeout(25_000), redirect: "error" }).catch(() => null);
  if (!res) return {};
  if (res.status === 401) return { stop: "Findymail did not accept your team's key. Check it in Connections." };
  if (res.status === 402) return { stop: "Findymail: no credits left." };
  if (res.status === 423) return { stop: "Findymail: your account is paused." };
  if (res.status === 429) return { stop: "Findymail: too many lookups at once. Stopped for now." };
  if (!res.ok) return {};
  const j = await res.json().catch(() => ({})) as { contact?: { email?: string } };
  return { email: clean(j.contact?.email) || undefined };
}
