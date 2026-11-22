// Team rules: an exact copy of the extension's core/lib.js (applyRules, dataQuality, ruleMatches, mergeDefaults for
// rules / refine). scripts/check-scoring.mjs compares both on many leads; keep them the same.
// Points scoring (weights, tiers, scores) was removed on 18 Nov 2026 (Affan, Phase 1): a rule now rejects a lead or marks
// it Good or No. Old "Add points" / "Take points" rules stay saved but no longer do anything until changed.

export type Weights = Record<"email" | "website" | "phone" | "social" | "rating" | "reviews" | "description" | "fit" | "reach", number>;
export type Tiers = { a: number; b: number };
export type RuleAction = "reject" | "good" | "no" | "boost" | "penalty";
export type Rule = { field: string; op: string; value?: string; action: RuleAction; amount?: number };
export type Refine = {
  minRating: number; minReviews: number; maxReviews: number; needWebsite: boolean; needEmail: boolean; needPhone: boolean; needSocial: boolean;
  includeWords: string; excludeWords: string; businessEmailOnly: boolean;
  minQuality: number; minSocials: number; minChannels: number; needDescription: boolean; needAddress: boolean; emailMatchesSite: boolean;
};
// weights / tiers are still stored in team_rules (older extensions read them) but nothing uses them any more.
export type TeamRules = { weights: Weights; tiers: Tiers; rules: Rule[]; refine: Refine };
export const RULE_ACTIONS: [RuleAction, string][] = [["reject", "Reject lead"], ["good", "Mark Good"], ["no", "Mark No"]];
export const isOldPointsRule = (r: Rule) => r.action === "boost" || r.action === "penalty";

export const DEFAULT_WEIGHTS: Weights = { email: 30, website: 10, phone: 5, social: 12, rating: 8, reviews: 10, description: 5, fit: 10, reach: 10 };
export const DEFAULT_TIERS: Tiers = { a: 70, b: 45 };
export const DEFAULT_REFINE: Refine = {
  minRating: 0, minReviews: 0, maxReviews: 0, needWebsite: false, needEmail: false, needPhone: false, needSocial: false,
  includeWords: "", excludeWords: "", businessEmailOnly: false,
  minQuality: 0, minSocials: 0, minChannels: 0, needDescription: false, needAddress: false, emailMatchesSite: false,
};

const SOCIAL_LABELS: [string, string][] = [["facebook", "Facebook"], ["instagram", "Instagram"], ["linkedin", "LinkedIn"], ["x", "X"], ["youtube", "YouTube"], ["tiktok", "TikTok"], ["pinterest", "Pinterest"], ["whatsapp", "WhatsApp"], ["telegram", "Telegram"], ["threads", "Threads"], ["snapchat", "Snapchat"], ["vimeo", "Vimeo"], ["behance", "Behance"], ["dribbble", "Dribbble"], ["github", "GitHub"], ["discord", "Discord"], ["reddit", "Reddit"]];
export const RULE_FIELDS: [string, string, "text" | "number"][] = [
  ["name", "Business name", "text"], ["category", "Category", "text"], ["description", "Description", "text"], ["address", "Address", "text"],
  ["location", "Search location", "text"], ["website", "Website", "text"], ["email", "Email", "text"], ["emailKind", "Email type", "text"], ["phone", "Phone", "text"],
  ["keyword", "Search keyword", "text"], ["rating", "Rating", "number"], ["reviews", "Reviews", "number"], ["socialCount", "Social profiles", "number"],
  ["quality", "Data quality", "number"],
  ["subscribers", "YouTube subscribers", "number"], ["videos", "YouTube videos", "number"], ["country", "Channel country", "text"],
  ...SOCIAL_LABELS.map(([k, label]) => [`social:${k}`, label, "text"] as [string, string, "text"]),
];
export const RULE_OPS: [string, string][] = [["contains", "contains"], ["notContains", "doesn't contain"], ["is", "is"], ["empty", "is empty"], ["notEmpty", "has a value"], ["gt", "above"], ["lt", "below"]];
export const NO_VALUE = new Set(["empty", "notEmpty"]);

// The extension's lead object (kept in leads.data).
export type ScoreLead = Record<string, unknown> & {
  name?: string; category?: string; description?: string; keyword?: string; source?: string; email?: string; phone?: string; website?: string; address?: string;
  emailKind?: string; socials?: Record<string, string>; rating?: number | string; reviews?: number | string; subscribers?: number | string; videos?: number | string;
  country?: string; ai?: { fit?: number; verdict?: string } | null; quality?: number; ruleReject?: boolean; ruleMark?: "Good" | "No" | null;
};

export function dataQuality(lead: ScoreLead) {
  const fields = lead.source === "youtube"
    ? [lead.email, lead.website, lead.description, Object.keys(lead.socials || {}).length > 1, lead.subscribers, lead.country]
    : [lead.email, lead.phone, lead.website, lead.address, lead.description, Object.keys(lead.socials || {}).length, lead.rating];
  return Math.round((fields.filter(Boolean).length / fields.length) * 100);
}

function ruleValue(lead: ScoreLead, field: string): unknown {
  if (field === "socialCount") return Object.keys(lead.socials || {}).length;
  if (field.startsWith("social:")) return (lead.socials || {})[field.slice(7)] || "";
  return lead[field] === undefined || lead[field] === null ? "" : lead[field];
}

export function ruleMatches(rule: Rule, lead: ScoreLead) {
  const value = ruleValue(lead, rule.field);
  const text = String(value).toLowerCase();
  const wanted = String(rule.value === undefined ? "" : rule.value).trim().toLowerCase();
  const terms = wanted.split(",").map((w) => w.trim()).filter(Boolean);
  switch (rule.op) {
    case "empty": return value === "" || value === 0;
    case "notEmpty": return value !== "" && value !== 0;
    case "contains": return terms.length > 0 && terms.some((w) => text.includes(w));
    case "notContains": return terms.length > 0 && !terms.some((w) => text.includes(w));
    case "is": return terms.includes(text);
    case "gt": return wanted !== "" && value !== "" && Number(value) > Number(wanted);
    case "lt": return wanted !== "" && value !== "" && Number(value) < Number(wanted);
    default: return false;
  }
}

// Changes the lead in place, like the extension: its data quality, whether a rule rejects it, and whether a rule marks
// it Good or No (No wins over Good; Reject wins over both). Old points rules are skipped.
export function applyRules(lead: ScoreLead, rules: Rule[]) {
  lead.quality = dataQuality(lead);
  let rejected = false, good = false, no = false;
  for (const rule of rules || []) {
    if (isOldPointsRule(rule) || !ruleMatches(rule, lead)) continue;
    if (rule.action === "reject") rejected = true;
    else if (rule.action === "no") no = true;
    else if (rule.action === "good") good = true;
  }
  lead.ruleReject = rejected;
  lead.ruleMark = rejected || no ? "No" : good ? "Good" : null;
  return lead;
}

// Fills gaps with the defaults and keeps numbers in range, so a half-saved row can never break scoring.
export function cleanRules(r: Partial<{ weights: unknown; tiers: unknown; rules: unknown; refine: unknown }> | null | undefined): TeamRules {
  const num = (v: unknown, d: number, lo: number, hi: number) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n * 10) / 10)) : d; };
  const w = (r?.weights ?? {}) as Record<string, unknown>, t = (r?.tiers ?? {}) as Record<string, unknown>, f = (r?.refine ?? {}) as Record<string, unknown>;
  const weights = Object.fromEntries(Object.entries(DEFAULT_WEIGHTS).map(([k, d]) => [k, num(w[k], d, 0, 40)])) as Weights;
  const tiers = { a: num(t.a, DEFAULT_TIERS.a, 0, 100), b: num(t.b, DEFAULT_TIERS.b, 0, 100) };
  const refine = Object.fromEntries(Object.entries(DEFAULT_REFINE).map(([k, d]) => [k,
    typeof d === "boolean" ? Boolean(f[k] ?? d) : typeof d === "number" ? num(f[k], d, 0, k === "minRating" ? 5 : 1000000) : String(f[k] ?? d).slice(0, 2000)])) as Refine;
  const fields = new Set(RULE_FIELDS.map((x) => x[0])), ops = new Set(RULE_OPS.map((x) => x[0]));
  const rules = (Array.isArray(r?.rules) ? r!.rules as Rule[] : []).filter((x) => x && fields.has(x.field) && ops.has(x.op)).slice(0, 200).map((x) => ({
    field: x.field, op: x.op, value: String(x.value ?? "").slice(0, 500),
    action: (["reject", "good", "no", "boost", "penalty"].includes(x.action) ? x.action : "reject") as RuleAction, amount: num(x.amount, 20, 0, 100),
  }));
  return { weights, tiers, rules, refine };
}
