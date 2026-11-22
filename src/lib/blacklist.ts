import "server-only";
import { promises as dns } from "node:dns";
import { isPublicIPv4 } from "./net";

// Kestrel Spam Guard, part B: is a sending domain (or its private sending server) on a public blacklist?
// DNS lookups only (and one RDAP lookup for the domain's age). A list that refuses to answer (Spamhaus refuses big cloud
// resolvers; URIBL and SURBL refuse heavy users) is reported as "could not check", never as clean.
export type ListStatus = "clean" | "listed" | "unknown";
export type ListResult = { name: string; kind: "domain" | "ip"; target: string; status: ListStatus; detail?: string };
export type MonitorResult = {
  domain: string; listed: boolean; lists: ListResult[];
  age_days: number | null; registered: string | null;
  server: { host: string; ip: string | null; ptr: string | null; shared: boolean } | null;
  checked_at: string;
};

// Each list's own test entry ("canary"), which is always listed. If the canary does not come back listed, the list is
// not really answering us (some resolvers return "not found" for everything), so its result cannot be trusted.
const DOMAIN_LISTS = [
  { zone: "dbl.spamhaus.org", name: "Spamhaus DBL", canary: "dbltest.com" },
  { zone: "multi.surbl.org", name: "SURBL", canary: "test.surbl.org" },
  { zone: "multi.uribl.com", name: "URIBL", canary: "test.uribl.com" },
];
const IP_LISTS = [
  { zone: "zen.spamhaus.org", name: "Spamhaus ZEN", canary: "2.0.0.127" },
  { zone: "bl.spamcop.net", name: "SpamCop", canary: "2.0.0.127" },
  { zone: "b.barracudacentral.org", name: "Barracuda", canary: "2.0.0.127" },
  { zone: "psbl.surriel.com", name: "PSBL", canary: "2.0.0.127" },
];
const NO_ANSWER = "Could not check: the list did not answer Kestrel's server";
// Ask a list about a target, trusting a "clean" answer only when the list's own test entry comes back listed.
async function askTrusted(zone: string, canary: string, target: string): Promise<{ status: ListStatus; detail?: string }> {
  const [test, real] = await Promise.all([ask(`${canary}.${zone}`), ask(`${target}.${zone}`)]);
  if (real.status === "listed") return real;
  if (test.status !== "listed") return { status: "unknown", detail: NO_ANSWER };
  return real;
}
// Big providers' shared servers: their IP reputation is the provider's job, so only the domain is checked.
const SHARED = /(^|\.)(gmail\.com|google\.com|googlemail\.com|office365\.com|outlook\.com|hotmail\.com|live\.com|zoho\.(com|eu|in)|zohomail\.|yahoo\.com|icloud\.com|me\.com|hostinger\.com|titan\.email|secureserver\.net|mail\.me\.com)$/i;

const withTimeout = <T,>(p: Promise<T>, ms = 5000) => Promise.race([p, new Promise<never>((_, no) => setTimeout(() => no(new Error("timeout")), ms))]);

// Ask one list. NXDOMAIN = clean; 127.0.0.1 or 127.255.255.x = the list refused us; any other 127.x = listed.
async function ask(query: string): Promise<{ status: ListStatus; detail?: string }> {
  try {
    const a = await withTimeout(dns.resolve4(query));
    if (!a.length) return { status: "clean" };
    if (a.some((x) => x === "127.0.0.1" || x.startsWith("127.255.255."))) return { status: "unknown", detail: NO_ANSWER };
    return a.some((x) => x.startsWith("127.")) ? { status: "listed", detail: `Answer ${a.join(", ")}` } : { status: "unknown", detail: "Unexpected answer" };
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "ENOTFOUND" || code === "ENODATA") return { status: "clean" };
    return { status: "unknown", detail: "No answer in time" };
  }
}

async function domainAge(domain: string): Promise<{ days: number | null; registered: string | null }> {
  try {
    const r = await fetch(`https://rdap.org/domain/${encodeURIComponent(domain)}`, { signal: AbortSignal.timeout(8000), headers: { accept: "application/rdap+json", "user-agent": "Kestrel/1.0 (+https://kestrelleads.com) domain age check" } });
    if (!r.ok) return { days: null, registered: null };
    const j = await r.json() as { events?: { eventAction?: string; eventDate?: string }[] };
    const reg = j.events?.find((e) => e.eventAction === "registration")?.eventDate ?? null;
    return { days: reg ? Math.floor((Date.now() - Date.parse(reg)) / 86400000) : null, registered: reg };
  } catch { return { days: null, registered: null }; }
}

export async function checkDomain(domain: string, smtpHost: string | null): Promise<MonitorResult> {
  const d = domain.toLowerCase();
  const domainChecks = DOMAIN_LISTS.map(async (l) => ({ name: l.name, kind: "domain" as const, target: d, ...(await askTrusted(l.zone, l.canary, d)) }));

  let server: MonitorResult["server"] = null;
  let ipChecks: Promise<ListResult>[] = [];
  const host = (smtpHost || "").toLowerCase().trim();
  if (host && /^[a-z0-9.-]+$/.test(host)) {
    const shared = SHARED.test(host);
    const found = shared ? null : (await withTimeout(dns.resolve4(host)).catch(() => [] as string[]))[0] ?? null;
    const ip = found && isPublicIPv4(found) ? found : null;   // never show or look up private / internal addresses
    const ptr = ip ? (await withTimeout(dns.reverse(ip)).catch(() => [] as string[]))[0] ?? null : null;
    server = { host, ip, ptr, shared };
    if (ip && /^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
      const rev = ip.split(".").reverse().join(".");
      ipChecks = IP_LISTS.map(async (l) => ({ name: l.name, kind: "ip" as const, target: ip, ...(await askTrusted(l.zone, l.canary, rev)) }));
    }
  }
  const [lists, age] = await Promise.all([Promise.all([...domainChecks, ...ipChecks]), domainAge(d)]);
  return { domain: d, listed: lists.some((l) => l.status === "listed"), lists, age_days: age.days, registered: age.registered, server, checked_at: new Date().toISOString() };
}
