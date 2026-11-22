// Find Emails with Hunter.io: the same choices as the extension (core/sources.js hunterUrl / hunterPick, core/lib.js setEmails / mergeContacts).

const HUNTER = "https://api.hunter.io/v2";
const FREE_MAIL = new Set(["gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "hotmail.com", "outlook.com",
  "live.com", "msn.com", "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com", "gmx.com", "mail.com", "zoho.com"]);
const ROLE_LOCAL = /^(info|hello|hi|contact|sales|admin|office|support|enquir(y|ies)|inquir(y|ies)|team|mail|help|accounts?|billing|marketing|careers|jobs|press|media|reception|bookings?|studio|general|newbusiness|news|talk|talkto|design|creative|projects|work|people|hr|recruitment|events|orders|shop|store|services?|customers?|clients?|partners?|finance|tech|web|welcome|connect|ask|letstalk)\b/i;
const DECIDER = /founder|owner|director|ceo|chief|managing|partner|head|lead|creative|producer|principal|president/i;

export const hostOf = (u?: string | null) => { try { return new URL(String(u)).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; } };
export type Contact = { name: string; position: string; email: string };

export function hunterUrl(lead: { website?: string | null; name?: string | null }, key: string) {
  const domain = hostOf(lead.website);
  const p = new URLSearchParams({ limit: "10", api_key: key.trim() });
  if (domain) p.set("domain", domain); else if (lead.name) p.set("company", lead.name); else return "";
  return `${HUNTER}/domain-search?${p}`;
}
export const hunterAccountUrl = (key: string) => `${HUNTER}/account?${new URLSearchParams({ api_key: key.trim() })}`;

type HunterEmail = { value?: string; type?: string; confidence?: number; first_name?: string; last_name?: string; position?: string; seniority?: string; decision_maker?: boolean; verification?: { status?: string } };
export function hunterPick(data: unknown) {
  const d = ((data as { data?: { domain?: string; organization?: string; emails?: HunterEmail[] } })?.data) ?? {}, list = d.emails ?? [];
  const score = (e: HunterEmail) => (e.decision_maker ? 40 : 0) + (DECIDER.test(e.position || "") ? 30 : 0) + (e.seniority === "executive" ? 20 : e.seniority === "senior" ? 10 : 0) + (e.type === "personal" ? 5 : 0) + (Number(e.confidence) || 0) / 10;
  const sorted = list.filter((e) => e && /@/.test(e.value || "") && (Number(e.confidence) || 0) >= 50 && e.verification?.status !== "invalid").sort((a, b) => score(b) - score(a));
  const contacts: Contact[] = sorted.filter((e) => e.type === "personal" && (e.first_name || e.last_name)).slice(0, 3)
    .map((e) => ({ name: [e.first_name, e.last_name].filter(Boolean).join(" "), position: e.position || "", email: e.value! }));
  return { domain: d.domain || "", organization: d.organization || "", emails: sorted.map((e) => e.value!), contacts };
}
export function hunterCredits(data: unknown) {
  const a = ((data as { data?: Record<string, unknown> })?.data) ?? {}, r = (a.requests ?? {}) as Record<string, { used?: number; available?: number }>, c = r.credits || r.searches || {};
  return { plan: String(a.plan_name || ""), used: c.used ?? null, available: c.available ?? null, reset: String(a.reset_date || "") };
}

export function emailKind(email: string, website?: string | null) {
  if (!email) return "none";
  const [local, domain] = email.split("@");
  if (FREE_MAIL.has(domain)) return "free";
  const site = hostOf(website);
  const onDomain = site && (domain === site || site.endsWith(`.${domain}`) || domain.endsWith(`.${site}`));
  if (!onDomain && site) return "other";
  return ROLE_LOCAL.test(local) ? "role" : "person";
}
const RANK: Record<string, number> = { person: 0, role: 1, other: 2, free: 3, none: 4 };
export function setEmails(lead: { emails?: string[]; email?: string; emailKind?: string; website?: string }, emails: string[]) {
  lead.emails = [...new Set(emails)].sort((a, b) => RANK[emailKind(a, lead.website)] - RANK[emailKind(b, lead.website)]);
  lead.email = lead.emails[0] || "";
  lead.emailKind = emailKind(lead.email, lead.website);
}
export function mergeContacts(...lists: ({ name?: string; position?: string; role?: string; email?: string }[] | undefined)[]) {
  const out = new Map<string, Contact>();
  for (const c of lists.flat().filter((x): x is { name: string; position?: string; role?: string; email?: string } => Boolean(x && x.name))) {
    const k = c.name.toLowerCase().replace(/\s+/g, " ").trim(), had = out.get(k);
    if (!had) { out.set(k, { name: c.name, position: c.position || c.role || "", email: c.email || "" }); continue; }
    const role = c.position || c.role || "";
    if (role && !had.position.toLowerCase().includes(role.toLowerCase())) had.position = had.position ? `${had.position}, ${role}` : role;
    if (!had.email && c.email) had.email = c.email;
  }
  return [...out.values()].slice(0, 5);
}
