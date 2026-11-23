// Turning Kestrel extension leads into database rows, and the example leads used for testing.
import { csvCell } from "./csv-cell";

export const LEADS_DRAG = "application/x-kestrel-leads";

export type LeadRow = {
  id: string; name: string | null; category: string | null; location: string | null; source: string | null;
  email: string | null; phone: string | null; website: string | null; verdict: "Good" | "Maybe" | "No" | null;
  reason: string | null; score: number | null; tier: string | null; hiring: boolean; named: boolean; sample: boolean; created_at: string; status?: "new" | "kept" | "removed";
  socials?: Record<string, string> | null;
  // The business's own city, read from its website by the extension (data.city). `location` is the place that was searched.
  city?: string | null;
  // The search keyword the extension used (data.keyword); with `location` it names the search that found the lead.
  keyword?: string | null;
  // Email verifier (database 044): Valid / Invalid / Risky, and why.
  email_status?: "valid" | "invalid" | "risky" | null; email_check?: { reason?: string; by?: string; role?: boolean; free?: boolean; suggest?: string } | null;
  // Pipeline (lib/pipeline.ts): Meeting / Won / Lost saved on the lead (data.result, database 058), and whether a written
  // email exists (the first subject of the new or the old draft format).
  result?: unknown; w1?: string | null; w0?: string | null;
  // Stage C (Opportunity intelligence & approval)
  outreach_approved?: boolean;
  outreach_approved_at?: string | null;
  matched_service_id?: string | null;
  buying_trigger?: string | null;
};
export const LEAD_COLUMNS = "id,name,category,location,source,email,phone,website,verdict,reason,score,tier,hiring,named,sample,created_at,socials:data->socials,city:data->>city,keyword:data->>keyword,result:data->result,w1:data->outreach->steps->0->>subject,w0:data->outreach->>subject";
// With Keep / Remove (database 006). The App falls back to LEAD_COLUMNS until 006 has been run.
export const LEAD_COLUMNS_STATUS = `${LEAD_COLUMNS},status`;
// With the email verifier labels (database 044). The App falls back to LEAD_COLUMNS_STATUS until 044 has been run.
export const LEAD_COLUMNS_VERIFY = `${LEAD_COLUMNS_STATUS},email_status,email_check`;
// With Opportunity Intelligence & Approval (Stage C, 20261123g).
export const LEAD_COLUMNS_STAGE_C = `${LEAD_COLUMNS_VERIFY},outreach_approved,buying_trigger,matched_service_id`;

export const SOURCE_NAMES: Record<string, string> = {
  maps: "Google Maps", search: "Google Search", youtube: "YouTube", osm: "OpenStreetMap", jobs: "Job boards",
  companies: "Companies House", podcasts: "Listen Notes", page: "Any web page", site: "Website lists", sites: "Website lists", import: "Imported",
};

type ExtLead = Record<string, unknown> & {
  name?: string; category?: string; location?: string; address?: string; source?: string; email?: string; phone?: string; website?: string;
  score?: number; tier?: string; ai?: { verdict?: string; fit?: string; reason?: string }; hiring?: { jobs?: unknown[] }; contacts?: unknown[];
};

const domain = (url?: string) => {
  if (!url) return "";
  try { return new URL(/^https?:/i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; }
};
// One lead per business: website domain, else email, else phone digits, else name + place.
export function dedupeKey(l: ExtLead) {
  const d = domain(l.website); if (d) return `site:${d}`;
  if (l.email) return `email:${String(l.email).toLowerCase().trim()}`;
  const digits = String(l.phone || "").replace(/\D/g, ""); if (digits.length >= 7) return `phone:${digits}`;
  return `name:${String(l.name || "").toLowerCase().trim()}|${String(l.location || l.address || "").toLowerCase().trim()}`;
}
const verdictOf = (l: ExtLead): LeadRow["verdict"] => {
  const v = String(l.ai?.verdict || l.ai?.fit || "").toLowerCase();
  return v.startsWith("good") ? "Good" : v.startsWith("maybe") ? "Maybe" : v.startsWith("no") ? "No" : null;
};

export function toRow(l: ExtLead, teamId: string, sample = false) {
  return {
    team_id: teamId, dedupe_key: dedupeKey(l), name: l.name ?? null, category: l.category ?? null,
    location: (l.location as string) ?? (l.address as string) ?? null, source: l.source ?? null,
    email: l.email || null, phone: l.phone || null, website: l.website || null,
    verdict: verdictOf(l), reason: l.ai?.reason ?? null, score: typeof l.score === "number" ? l.score : null, tier: l.tier ?? null,
    hiring: Boolean(l.hiring?.jobs?.length), named: Boolean(l.contacts?.length), sample, data: l,
    socials: (l.socials as Record<string, string>) || null,
  };
}

// Leads inside a Kestrel backup file ({"type":"quarry-backup","parts":{"leads":[...]}}).
export function leadsFromBackup(json: unknown): ExtLead[] {
  const j = json as { type?: string; parts?: { leads?: ExtLead[] }; leads?: ExtLead[] };
  if (j && j.type === "quarry-backup" && Array.isArray(j.parts?.leads)) return j.parts!.leads!;
  if (j && Array.isArray(j.leads)) return j.leads;
  if (Array.isArray(json)) return json as ExtLead[];
  return [];
}

// Made-up businesses for testing (marked as examples, easy to remove). Not real companies.
export const EXAMPLE_LEADS: ExtLead[] = [
  ["Northlight Studio (example)", "Video production", "London", "maps", "Good", "Makes brand films for retail clients", "northlight-example.test"],
  ["Harbour Social (example)", "Social media agency", "Bristol", "youtube", "Good", "Posts weekly short-form video, hiring an editor", "harbour-example.test"],
  ["Copperleaf Design (example)", "Design studio", "Leeds", "search", "Maybe", "Strong design work, no video yet", "copperleaf-example.test"],
  ["Mason & Vale (example)", "Marketing agency", "Manchester", "companies", "Maybe", "New agency, two directors", "masonvale-example.test"],
  ["Fieldhouse Media (example)", "Content agency", "Glasgow", "jobs", "Good", "Hiring a motion designer this month", "fieldhouse-example.test"],
  ["Quickprint Ltd (example)", "Print shop", "Leeds", "osm", "No", "Print shop, does not buy this service", "quickprint-example.test"],
  ["Brightside Podcasts (example)", "Podcast network", "Brighton", "podcasts", "Good", "Weekly shows, clips needed for social", "brightside-example.test"],
  ["Oakline Events (example)", "Event agency", "Birmingham", "page", "Maybe", "Films some events, outsources editing", "oakline-example.test"],
].map(([name, category, location, source, verdict, reason, site], i) => ({
  name, category, location, source, website: `https://${site}`, email: `hello@${site}`,
  phone: ["+44 20 7946 0912", "+44 117 496 0123", "+44 113 496 0456", "+44 161 496 0789", "+44 141 496 0321", "+44 113 496 0987", "+44 1273 496 011", "+44 121 496 0222"][i],
  socials: [
    { linkedin: "https://linkedin.com/company/northlight-example", instagram: "https://instagram.com/northlight.example", youtube: "https://youtube.com/@northlight-example" },
    { linkedin: "https://linkedin.com/company/harbour-example", instagram: "https://instagram.com/harbour.example", tiktok: "https://tiktok.com/@harbour.example" },
    { linkedin: "https://linkedin.com/company/copperleaf-example", instagram: "https://instagram.com/copperleaf.example" },
    { linkedin: "https://linkedin.com/company/masonvale-example", facebook: "https://facebook.com/masonvale.example" },
    { linkedin: "https://linkedin.com/company/fieldhouse-example", instagram: "https://instagram.com/fieldhouse.example", x: "https://x.com/fieldhouse_example" },
    { linkedin: "https://linkedin.com/company/quickprint-example", facebook: "https://facebook.com/quickprint-example" },
    { linkedin: "https://linkedin.com/company/brightside-podcasts", youtube: "https://youtube.com/@brightside-podcasts" },
    { linkedin: "https://linkedin.com/company/oakline-events", instagram: "https://instagram.com/oakline-events" },
  ][i],
  keyword: ["video production", "social media agency", "design studio", "marketing agency", "video production", "", "podcast", "event agency"][i],
  score: [92, 88, 64, 58, 85, 12, 81, 55][i], tier: ["A", "A", "B", "B", "A", "C", "A", "B"][i],
  ai: { verdict, reason }, hiring: source === "jobs" || i === 1 ? { jobs: [{ title: "Video editor" }] } : undefined,
  contacts: i % 3 === 0 ? [{ name: "Example Person", position: "Founder" }] : undefined,
}));

// Where the business really is: the city from its own website when the extension found one, else the searched place
// (UX audit row 10: "Top City Creative (Pittsburgh)" was shown under Topeka).
export const placeOf = (l: { city?: string | null; location?: string | null }) => l.city || l.location || "";
// "Found in a search for Topeka" when the website's city is not the searched one.
export function searchNote(l: { city?: string | null; location?: string | null }) {
  const city = String(l.city || "").split(",")[0].trim().toLowerCase(), searched = String(l.location || "").split(",")[0].trim();
  return city && searched && !String(l.location).toLowerCase().includes(city) ? `From its website. Found in a search for ${searched}.` : "";
}

// One search = the keyword + the place it was run in (Affan, 18 Nov 2026: "when I search new leads, keep them
// separate"). Leads with neither (imports, pasted pages) are one group, key "-".
export function searchKey(l: { keyword?: string | null; location?: string | null }) {
  const k = String(l.keyword || "").trim().toLowerCase(), p = String(l.location || "").split(",")[0].trim().toLowerCase();
  return k || p ? `${k}|${p}` : "-";
}
export type SearchGroup = { key: string; label: string; count: number; newest: string };
export function searchGroups(rows: { keyword?: string | null; location?: string | null; created_at: string; status?: string }[]): SearchGroup[] {
  const map = new Map<string, SearchGroup>();
  for (const l of rows) {
    if (l.status === "removed") continue;
    const key = searchKey(l);
    const g = map.get(key);
    if (g) { g.count++; if (l.created_at > g.newest) g.newest = l.created_at; continue; }
    const k = String(l.keyword || "").trim(), p = String(l.location || "").split(",")[0].trim();
    map.set(key, { key, count: 1, newest: l.created_at, label: key === "-" ? "Imported or no search" : [k, p].filter(Boolean).join(" · ") });
  }
  return [...map.values()].sort((a, b) => (a.key === "-" ? 1 : b.key === "-" ? -1 : b.newest.localeCompare(a.newest)));
}

// CSV export, the same columns people use most from the extension. Removed leads are never exported.
const cell = csvCell;
export function leadsCsv(rows: LeadRow[]) {
  const head = ["Business", "Category", "Location", "Email", "Phone", "Website", "Fit", "Reason", "Score", "Tier", "Source", "Hiring", "Named contact"];
  const body = rows.filter((l) => l.status !== "removed").map((l) => [l.name, l.category, placeOf(l), l.email, l.phone, l.website, l.verdict, l.reason, l.score, l.tier, SOURCE_NAMES[l.source ?? ""] ?? l.source, l.hiring ? "Yes" : "", l.named ? "Yes" : ""]);
  return [head, ...body].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}
