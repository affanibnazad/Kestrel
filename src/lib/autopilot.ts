// Autopilot: one click takes the team's leads through Find emails → Score with AI → Write emails, and then waits
// for the person's OK before anything is sent (Approve → the leads join a campaign). Pure planning code: which leads
// each step works on. The steps themselves use the same server routes as the App's own buttons.

export type ApLead = { id: string; name: string | null; email: string | null; website: string | null; verdict: string | null; tier: string | null;
  status?: string; created_at: string; drafted: boolean; blocked: boolean; contacted?: boolean };
export type ApScope = "new" | "all" | "tierAB" | `list:${string}`;
export type ApSettings = {
  scope: ApScope; limit: number;
  findEmails: boolean; score: boolean; write: boolean; onlyGood: boolean;
  offerId: string; sequence: string;      // "default" = first email + 3 follow-ups, or a sequence id
  campaignId: string;
};
export const AP_DEFAULTS: ApSettings = { scope: "new", limit: 50, findEmails: true, score: true, write: true, onlyGood: true, offerId: "", sequence: "default", campaignId: "" };
export const AP_LIMITS = [10, 25, 50, 100, 200];

// The leads this run looks at: never removed, Do-not-contact, or already in any campaign (so nobody is emailed twice);
// newest first; at most `limit`.
export function pool(leads: ApLead[], s: ApSettings, lastRun: string | null, inList: Record<string, string[]> = {}): ApLead[] {
  const listIds = s.scope.startsWith("list:") ? new Set(inList[s.scope.slice(5)] ?? []) : null;
  return leads
    .filter((l) => l.status !== "removed" && !l.blocked && !l.contacted)
    .filter((l) => s.scope === "all" ? true
      : s.scope === "tierAB" ? l.verdict === "Good"   // old "Tier A and B" setting: points were removed (18 Nov 2026), so Good leads
      : s.scope === "new" ? !lastRun || l.created_at > lastRun || !l.drafted
      : listIds ? listIds.has(l.id) : true)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .slice(0, Math.max(1, Math.min(200, s.limit)));
}

// What each step would do for this pool, before running (the numbers shown on the page).
export function plan(p: ApLead[], s: ApSettings) {
  const needEmail = s.findEmails ? p.filter((l) => !l.email && (l.website || l.name)) : [];
  const needScore = s.score ? p.filter((l) => !l.verdict) : [];
  // Writing happens after the steps above, so count leads that will probably qualify: they have (or may get) an email,
  // are Good (or not judged yet, when scoring runs first), and have no written emails yet.
  const writable = (l: ApLead) => !l.drafted && (l.email || s.findEmails) && (!s.onlyGood || l.verdict === "Good" || (!l.verdict && s.score));
  const needWrite = s.write ? p.filter(writable) : [];
  const ready = p.filter((l) => l.email && l.drafted && (!s.onlyGood || l.verdict === "Good"));
  return { needEmail, needScore, needWrite, ready };
}

// Leads that are ready to send now (after a run): an email, written emails, Good when asked.
export const readyNow = (p: ApLead[], s: ApSettings) => p.filter((l) => l.email && l.drafted && (!s.onlyGood || l.verdict === "Good"));

// ---------- Autopilot goal (database 042): saved per team, run every 10 minutes by the server and the extension.
export type ApGoal = {
  keywords: string[]; places: string[]; source: "maps" | "osm"; per_day: number;
  offer_id: string | null; sequence: string; campaign_id: string | null; only_good: boolean; find_emails: boolean;
};
export const GOAL_DEFAULTS: ApGoal = { keywords: [], places: [], source: "maps", per_day: 50, offer_id: null, sequence: "default", campaign_id: null, only_good: true, find_emails: true };
export const PER_DAY = [10, 25, 50, 100, 200, 300];
export const lines = (text: string, max: number, len: number) =>
  [...new Set(text.split(/\r?\n|;/).map((x) => x.trim().replace(/\s+/g, " ")).filter((x) => x.length > 1))].slice(0, max).map((x) => x.slice(0, len));
// The extension's progress key for one search (extension core/lib.js coverKey): mode|site|keyword|location, lower case.
export const coverKey = (mode: string, keyword: string, location: string) => [mode, "", keyword, location].join("|").toLowerCase();
// How many of the goal's keyword × place searches the team has not finished yet.
export function searchesLeft(goal: Pick<ApGoal, "keywords" | "places" | "source">, done: Set<string>) {
  let left = 0;
  for (const p of goal.places) for (const k of goal.keywords) if (!done.has(coverKey(goal.source, k, p))) left++;
  return { left, total: goal.places.length * goal.keywords.length };
}
