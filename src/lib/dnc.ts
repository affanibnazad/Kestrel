// Do-not-contact: emails and whole domains. Same rules as the extension (core/lib.js normalizeDnc / dncBlocks / parseDncCsv),
// so a lead blocked in the extension is blocked here too.

export type DncRow = { entry: string; reason: string | null; created_at: string };
export type DncIndex = { emails: Set<string>; domains: Set<string> };

const hostOf = (u: string) => { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; } };

// "Name@Company.com" → "name@company.com"; "https://www.company.com/about" → "company.com"; anything else → "".
export function normalizeDnc(entry: unknown) {
  const e = String(entry ?? "").trim().toLowerCase().replace(/^mailto:/, "");
  if (!e) return "";
  if (e.includes("@") && !e.startsWith("@")) return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) ? e : "";
  const host = hostOf(/^https?:\/\//.test(e) ? e : `https://${e.replace(/^@/, "")}`);
  return host && host.includes(".") ? host : "";
}

export function dncIndex(rows: { entry: string }[]): DncIndex {
  const emails = new Set<string>(), domains = new Set<string>();
  for (const r of rows) { const e = normalizeDnc(r.entry); if (e) (e.includes("@") ? emails : domains).add(e); }
  return { emails, domains };
}

// True when the lead's email, its email's domain or its website (or a parent domain of them) is on the list.
export function dncBlocks(lead: { email?: string | null; emails?: string[] | null; website?: string | null }, index: DncIndex) {
  if (!index.emails.size && !index.domains.size) return false;
  const mails = [...new Set([lead.email, ...(lead.emails ?? [])].filter(Boolean).map((e) => String(e).toLowerCase().trim()))];
  if (mails.some((e) => index.emails.has(e))) return true;
  const site = lead.website ? hostOf(/^https?:/i.test(lead.website) ? lead.website : `https://${lead.website}`) : "";
  const doms = new Set([site, ...mails.map((e) => e.split("@")[1])].filter(Boolean));
  for (const d of doms) { const parts = d.split("."); for (let i = 0; i < parts.length - 1; i++) if (index.domains.has(parts.slice(i).join("."))) return true; }
  return false;
}

// A pasted list or a CSV file: one email or domain per line, or a column named email / domain / entry (plus an optional reason).
export function parseDncList(text: string): { entry: string; reason: string }[] {
  const lines = String(text || "").replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const split = (l: string) => l.split(/[,;\t]/).map((c) => c.trim().replace(/^"|"$/g, ""));
  const head = split(lines[0]).map((h) => h.toLowerCase());
  const col = head.findIndex((h) => /email|domain|entry/.test(h));
  const why = head.findIndex((h) => /reason/.test(h));
  const body = col >= 0 ? lines.slice(1) : lines;
  const seen = new Set<string>(), out: { entry: string; reason: string }[] = [];
  for (const l of body) {
    const c = split(l), entry = normalizeDnc(c[col >= 0 ? col : 0]);
    if (!entry || seen.has(entry)) continue;
    seen.add(entry); out.push({ entry, reason: (col >= 0 ? (why >= 0 ? c[why] : "") : c[1] ?? "").slice(0, 200) });
  }
  return out;
}

// How many leads each list entry blocks (for the Do-not-contact table). A domain also counts its subdomains.
export function dncMatchCounts(rows: { entry: string }[], leads: { email?: string | null; website?: string | null }[]) {
  const index = dncIndex(rows), counts = new Map<string, number>();
  for (const l of leads) {
    const mail = l.email ? String(l.email).toLowerCase().trim() : "";
    const site = l.website ? hostOf(/^https?:/i.test(l.website) ? l.website : `https://${l.website}`) : "";
    const hit = new Set<string>();
    if (mail && index.emails.has(mail)) hit.add(mail);
    for (const d of new Set([site, mail.split("@")[1]].filter(Boolean))) {
      const parts = d.split(".");
      for (let i = 0; i < parts.length - 1; i++) { const p = parts.slice(i).join("."); if (index.domains.has(p)) hit.add(p); }
    }
    hit.forEach((e) => counts.set(e, (counts.get(e) ?? 0) + 1));
  }
  return counts;
}

// Every Do-not-contact entry that could block these leads: their emails, and each email domain and website host with its
// parent domains. The server looks up only these (`.in("entry", …)`) instead of loading the whole list, which the API
// would cut at 1000 rows. dncBlocks on the result gives the same answer as on the full list.
export function dncCandidates(leads: { email?: string | null; emails?: string[] | null; website?: string | null }[]) {
  const out = new Set<string>();
  for (const l of leads) {
    const mails = [l.email, ...(l.emails ?? [])].filter(Boolean).map((e) => String(e).toLowerCase().trim());
    const site = l.website ? hostOf(/^https?:/i.test(l.website) ? l.website : `https://${l.website}`) : "";
    for (const m of mails) out.add(m);
    for (const d of [site, ...mails.map((e) => e.split("@")[1])]) {
      if (!d) continue;
      const parts = d.split(".");
      for (let i = 0; i < parts.length - 1; i++) out.add(parts.slice(i).join("."));
    }
  }
  return [...out].filter((e) => e.length >= 3 && e.length <= 254);
}
