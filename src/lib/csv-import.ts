// Import leads from any CSV file (Apollo, Google Sheets, Excel, another tool's export). Pure, so it can be tested.
// 1. parseCsv reads the file (commas, semicolons or tabs; quoted cells; a byte-order mark).
// 2. guessMapping matches the file's columns to Kestrel fields by their names.
// 3. csvLeads turns rows into Kestrel leads (source "import"), skipping rows with nothing to contact.

export type Field = "name" | "website" | "email" | "phone" | "first_name" | "last_name" | "contact" | "title" | "category" | "location" | "linkedin" | "notes";
export const FIELDS: { id: Field; label: string; words: RegExp }[] = [
  { id: "name", label: "Business name", words: /^(company|company name|business|business name|organisation|organization|account name|brand|name)$/ },
  { id: "website", label: "Website", words: /^(website|web site|website url|site|url|domain|company website|company domain|company url|homepage)$/ },
  { id: "email", label: "Email", words: /^(email|e mail|email address|e mail address|work email|business email|mail)$/ },
  { id: "phone", label: "Phone", words: /^(phone|telephone|tel|mobile|phone number|company phone|work phone|corporate phone|direct phone|first phone|mobile phone|work direct phone|business phone)$/ },
  { id: "first_name", label: "First name", words: /^(first name|firstname|first|given name)$/ },
  { id: "last_name", label: "Last name", words: /^(last name|lastname|last|surname|family name)$/ },
  { id: "contact", label: "Contact name", words: /^(contact|contact name|full name|person|owner|decision maker)$/ },
  { id: "title", label: "Job title", words: /^(title|job title|position|role|job)$/ },
  { id: "category", label: "Industry", words: /^(industry|category|niche|sector|type|business type)$/ },
  { id: "location", label: "Location", words: /^(location|city|address|town|country|region|state|area)$/ },
  { id: "linkedin", label: "LinkedIn", words: /^(linkedin|linkedin url|person linkedin url|linkedin profile|company linkedin url)$/ },
  { id: "notes", label: "Notes", words: /^(notes|note|comments|description|about)$/ },
];
export const MAX_ROWS = 20000;

export function parseCsv(text: string): string[][] {
  let src = String(text || "").replace(/^﻿/, "");
  // Excel's "sep=;" first line names the separator: use it and drop the line.
  const hint = /^sep=(.)\r?\n/i.exec(src);
  if (hint) src = src.slice(hint[0].length);
  const first = src.split(/\r?\n/, 1)[0] ?? "";
  const counts = { ",": 0, ";": 0, "\t": 0 } as Record<string, number>;
  let q = false;
  for (const ch of first) { if (ch === '"') q = !q; else if (!q && ch in counts) counts[ch]++; }
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  const sep = hint ? hint[1] : best[1] ? best[0] : ",";
  const rows: string[][] = [];
  let row: string[] = [], cell = "", inQ = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQ) {
      if (c === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else inQ = false; }
      else cell += c;
    } else if (c === '"' && cell.trim() === "") { cell = ""; inQ = true; }   // also `a, "b, c"` (a space before the quote)
    else if (c === sep) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
      if (rows.length > MAX_ROWS + 1) break;
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows.map((r) => r.map((x) => x.trim()));
}

const norm = (h: string) => h.toLowerCase().replace(/[_\-.]+/g, " ").replace(/\s+/g, " ").trim();
// Kestrel field → column index (or -1). Each column is used once, first match wins.
export function guessMapping(header: string[]): Record<Field, number> {
  const out = Object.fromEntries(FIELDS.map((f) => [f.id, -1])) as Record<Field, number>;
  const used = new Set<number>();
  // A bare "Name" column is the business only when there is no company column; otherwise it is the person.
  const company = header.findIndex((h) => FIELDS[0].words.test(norm(h)) && norm(h) !== "name");
  for (const f of FIELDS) {
    const i = f.id === "name" && company >= 0 ? company : header.findIndex((h, k) => !used.has(k) && f.words.test(norm(h)));
    if (i >= 0) { out[f.id] = i; used.add(i); }
  }
  const bare = header.findIndex((h, k) => !used.has(k) && norm(h) === "name");
  if (out.contact < 0 && bare >= 0) { out.contact = bare; used.add(bare); }
  return out;
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const siteOf = (v: string) => {
  const t = v.trim();
  if (!t) return "";
  try { const u = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`); return u.hostname.includes(".") ? `https://${u.hostname.replace(/^www\./, "")}` : ""; } catch { return ""; }
};

export type ImportResult = { leads: Record<string, unknown>[]; skipped: number; badEmail: number };
export function csvLeads(rows: string[][], map: Record<Field, number>): ImportResult {
  const get = (r: string[], f: Field) => (map[f] >= 0 ? String(r[map[f]] ?? "").trim() : "");
  const leads: Record<string, unknown>[] = [];
  let skipped = 0, badEmail = 0;
  for (const r of rows.slice(0, MAX_ROWS)) {
    let email = get(r, "email").toLowerCase().replace(/^mailto:/, "");
    if (email && !EMAIL.test(email)) { email = ""; badEmail++; }
    const website = siteOf(get(r, "website")) || (email && !/@(gmail|yahoo|hotmail|outlook|icloud|aol|proton(mail)?|gmx|live|msn)\./.test(email) ? `https://${email.split("@")[1]}` : "");
    const person = get(r, "contact") || [get(r, "first_name"), get(r, "last_name")].filter(Boolean).join(" ");
    const name = get(r, "name") || (website ? website.replace(/^https:\/\//, "") : "") || person;
    if (!name || (!email && !website && !get(r, "phone"))) { skipped++; continue; }
    const linkedin = get(r, "linkedin");
    leads.push({
      name: name.slice(0, 200), website: website || undefined, email: email || undefined, phone: get(r, "phone").slice(0, 40) || undefined,
      category: get(r, "category").slice(0, 120) || undefined, location: get(r, "location").slice(0, 200) || undefined, source: "import",
      contacts: person ? [{ name: person.slice(0, 120), first_name: get(r, "first_name") || person.split(" ")[0], position: get(r, "title").slice(0, 120) || undefined, email: email || undefined }] : undefined,
      socials: /^https?:\/\/([a-z]+\.)?linkedin\.com\//i.test(linkedin) ? { linkedin } : undefined,
      notes: get(r, "notes").slice(0, 2000) || undefined,
    });
  }
  return { leads, skipped, badEmail };
}

// Kestrel AI (Phase 3D): a CSV dropped into the chat. Same steps as the Import page with the columns guessed from the
// header: rows with nothing to contact and Do-not-contact leads are left out. Nothing is saved here.
export function quickCsv(text: string, blocked: (lead: { email?: string; website?: string }) => boolean) {
  const rows = parseCsv(text);
  if (rows.length < 2) return { error: "That file has no rows to import." } as const;
  const map = guessMapping(rows[0]);
  if (![map.name, map.email, map.website, map.phone].some((i) => i >= 0)) return { error: "I couldn't find a business name, email, website or phone column. Use Import and examples to match the columns by hand." } as const;
  const r = csvLeads(rows.slice(1, MAX_ROWS + 1), map);
  const keep = r.leads.filter((l) => !blocked(l as { email?: string; website?: string }));
  return { leads: keep, total: rows.length - 1, skipped: r.skipped, dnc: r.leads.length - keep.length, columns: FIELDS.filter((f) => map[f.id] >= 0).map((f) => f.label) } as const;
}
