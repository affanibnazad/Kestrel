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
export type AnyPlanId = "trial" | PlanId;

// Monthly Kestrel-paid AI actions per plan (score, research, explain, voice, write, qc, reply_suggest, reply_label, spam_fix).
// Chat has its own daily limit and does not count here. Teams using their own key do not count here.
export const AI_ALLOWANCE: Record<AnyPlanId, number> = {
  trial: 100,
  starter: 1000,
  pro: 5000,
  agency: 20000,
};

export function effectivePlan(
  a: {
    plan?: string | null;
    active?: boolean | null;
    paid_until?: string | null;
    access_until?: string | null;
    access_plan?: string | null;
  } | null,
  now = Date.now()
): AnyPlanId {
  if (!a) return "trial";
  if (a.plan && a.plan !== "trial" && a.active !== false && (!a.paid_until || Date.parse(a.paid_until) > now)) {
    if (a.plan === "starter" || a.plan === "pro" || a.plan === "agency") return a.plan;
  }
  if (a.access_until && Date.parse(a.access_until) > now) {
    const ap = a.access_plan ?? "pro";
    if (ap === "starter" || ap === "pro" || ap === "agency") return ap;
    return "pro";
  }
  return "trial";
}

export function aiAllowance(a: Parameters<typeof effectivePlan>[0], now = Date.now()): number {
  return AI_ALLOWANCE[effectivePlan(a, now)];
}

export function nextMonthResetLabel(now = new Date()): string {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return next.toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
}

export function allowanceExhaustedMessage(now = new Date()): string {
  return `This month's Kestrel AI is used up. It resets on ${nextMonthResetLabel(now)}.`;
}

export const PLANS: { id: PlanId; name: string; price: number; tagline: string; seats: string; points: string[] }[] = [
  { id: "starter", name: "Starter", price: 9, tagline: "For freelancers finding their first clients.", seats: "1 person",
    points: ["1,000 new leads a day, 10,000 stored", "Google Maps, OpenStreetMap, job boards, any web page and website lists", `Kestrel AI included: ${AI_ALLOWANCE.starter.toLocaleString()} AI actions a month`, "1 workspace, CSV export"] },
  { id: "pro", name: "Pro", price: 19, tagline: "For small agencies that prospect every week.", seats: "Up to 3 people",
    points: ["5,000 new leads a day, 50,000 stored", "All nine sources, including Google Search, YouTube, Companies House and podcasts", `Kestrel AI included: ${AI_ALLOWANCE.pro.toLocaleString()} AI actions a month`, "3 workspaces, CSV, JSON and text export"] },
  { id: "agency", name: "Agency", price: 49, tagline: "For teams running outreach for many clients.", seats: "Up to 10 people",
    points: ["No daily or stored lead limit", "All nine sources", `Kestrel AI included: ${AI_ALLOWANCE.agency.toLocaleString()} AI actions a month`, "Unlimited workspaces, lists, rules and saved views", "Full activity history for the whole team"] },
];
export const planName = (id: string | null | undefined) => (id === "trial" ? "Free trial" : PLANS.find((p) => p.id === id)?.name ?? "Free trial");

// Kestrel MCP and Kestrel Connect: a paid plan, or a valid free access (Owner → Access codes) on a team that is not locked.
// The same rule is in mcp/src/index.ts (the program on the person's computer).
export function mcpAllowed(a: { plan?: string | null; active?: boolean | null; access_until?: string | null } | null, now = Date.now()) {
  if (!a || a.active === false) return false;
  return ["starter", "pro", "agency"].includes(a.plan ?? "") || Boolean(a.access_until && Date.parse(a.access_until) > now);
}
