// Kestrel plans for the website and App. Prices set by Affan (12 Nov 2026), US dollars a month: change them here only.
// Limits match the extension's core/plans.js. Safety limits (Google pace, pauses, robots.txt,
// do-not-contact) are the same on every plan; a higher plan never searches Google faster.
export const TRIAL_DAYS = 7;

// Offers. LAUNCH: for everyone on the pricing page — none (Affan, 14 Nov 2026: "remove the launch offer").
// CREATOR_OFFER: only teams that came through a creator's link or code (their code is the Lemon Squeezy discount).
export const LAUNCH = { percent: 0, months: 0 };
export const CREATOR_OFFER = { percent: 50, months: 3 };
export const INTRO = CREATOR_OFFER;   // used by the creator pages
export const introPrice = (price: number, offer: { percent: number } = CREATOR_OFFER) => Math.round(price * (100 - offer.percent)) / 100;
export const money = (n: number) => (Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`);

export type PlanId = "starter" | "pro" | "agency";
export const PLANS: { id: PlanId; name: string; price: number; tagline: string; seats: string; points: string[] }[] = [
  { id: "starter", name: "Starter", price: 9, tagline: "For freelancers finding their first clients.", seats: "1 person",
    points: ["1,000 new leads a day, 10,000 stored", "Google Maps, OpenStreetMap, job boards, any web page and website lists", "AI lead scoring and email drafts with your own AI key", "1 workspace, CSV export"] },
  { id: "pro", name: "Pro", price: 19, tagline: "For small agencies that prospect every week.", seats: "Up to 3 people",
    points: ["5,000 new leads a day, 50,000 stored", "All nine sources, including Google Search, YouTube, Companies House and podcasts", "AI lead scoring and email drafts with your own AI key", "3 workspaces, CSV, JSON and text export"] },
  { id: "agency", name: "Agency", price: 49, tagline: "For teams running outreach for many clients.", seats: "Up to 10 people",
    points: ["No daily or stored lead limit", "All nine sources", "Unlimited workspaces, lists, rules and saved views", "Full activity history for the whole team"] },
];
export const planName = (id: string | null | undefined) => (id === "trial" ? "Free trial" : PLANS.find((p) => p.id === id)?.name ?? "Free trial");

// Kestrel MCP and Kestrel Connect: a paid plan, or a valid free access (Owner → Access codes) on a team that is not locked.
// The same rule is in mcp/src/index.ts (the program on the person's computer).
export function mcpAllowed(a: { plan?: string | null; active?: boolean | null; access_until?: string | null } | null, now = Date.now()) {
  if (!a || a.active === false) return false;
  return ["starter", "pro", "agency"].includes(a.plan ?? "") || Boolean(a.access_until && Date.parse(a.access_until) > now);
}
