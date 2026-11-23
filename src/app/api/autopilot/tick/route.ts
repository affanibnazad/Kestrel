import { timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_KEY, SUPABASE_URL } from "@/lib/supabase/config";
import { dncBlocks, dncIndex } from "@/lib/dnc";
import { aiOne, aiPlan, findOne, writeChecked, type FinderKeys, type FindLead, type QcEvent } from "@/lib/lead-steps";
import type { Offer } from "@/lib/ai";
import { aboutForAi, cleanAbout } from "@/lib/about";

// Autopilot's daily run (database 042). The database calls this every 10 minutes with the server secret while any team has
// Autopilot on. For each team with work left today it takes a few new leads and, in order: finds an email (Hunter → Apollo →
// Findymail), scores the lead with AI, and writes the first email and follow-ups (Good fit only, unless the team chose otherwise).
// Same code as the App's own buttons (lib/lead-steps.ts). Nothing is sent: ready leads wait for the team's OK in the App.
// Nobody signed in calls this: every database function it uses checks the server secret itself.
export const maxDuration = 60;
const PER_TEAM = 6, AT_ONCE = 3;
// Vercel stops this at 60 s. No new batch after 30 s, and no new step (a step can take up to ~45 s) once 12 s are left.
const NEW_BATCH_UNTIL = 30_000, STEP_UNTIL = 48_000, RETRY_MS = 6 * 3600_000;

const same = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
type Goal = { per_day: number; only_good: boolean; find_emails: boolean; sequence: string; offer_id: string | null };
type Ctx = { goal: Goal; offer: Offer | null; settings: Record<string, unknown> | null; sequence: unknown; rules: unknown;
  keys: Record<string, string>; provider: string; dnc: string[]; dnc_too_long?: boolean; leads: (FindLead & { verdict: string | null })[] };

export async function POST(request: Request) {
  const secret = process.env.MAIL_SERVER_SECRET || "";
  const given = request.headers.get("x-kestrel-secret") || "";
  if (secret.length < 32 || !same(given, secret)) return new Response("not allowed", { status: 401 });
  const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const started = Date.now();
  const { data: due, error } = await sb.rpc("ap_due", { server_secret: secret });
  if (error) return new Response(/ap_due|schema cache/.test(error.message) ? "autopilot not set up (database 042)" : "not ready", { status: 200 });
  const teams = (due ?? []) as { team_id: string; left_today: number }[];
  const report: string[] = [];

  for (const t of teams) {
    if (Date.now() - started > NEW_BATCH_UNTIL) break;
    const { data: c } = await sb.rpc("ap_context", { server_secret: secret, team: t.team_id, max_leads: Math.min(PER_TEAM, t.left_today) });
    const ctx = c as Ctx | null;
    if (!ctx) continue;
    // The team's About page (database 059) goes into the AI's instructions, like Score and write (none before 059 is run).
    const { data: ab } = await sb.rpc("team_about_for_server", { server_secret: secret, team: t.team_id });
    if (ctx.settings) ctx.settings = { ...ctx.settings, about: aboutForAi(ab ? cleanAbout(ab) : null) };
    if (ctx.dnc_too_long) { await sb.rpc("ap_finish", { server_secret: secret, team: t.team_id, worked: 0, emails: 0, scored: 0, good: 0, written: 0, note: "Your Do-not-contact list is too long for Autopilot to check (over 50,000). Write to us and we will raise the limit." }); continue; }
    const g = ctx.goal, dnc = dncIndex((ctx.dnc ?? []).map((entry) => ({ entry })));
    const notes = new Set<string>();
    let worked = 0, emails = 0, scored = 0, good = 0, written = 0;
    // What the Bot room hears about this run (Phase 4A): who found, judged and wrote what.
    const room = { looked: 0, found: [] as { id: string; name: string }[], scored: [] as { id: string; name: string; verdict: string }[], written: [] as { id: string; name: string; qc?: string; events?: QcEvent[] }[],
      researched: [] as { id: string; name: string; problem: string; sure: string }[] };
    const nameOf = (l: { name?: string | null }) => String(l.name ?? "a lead").replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 60);
    if (!ctx.leads.length) { await sb.rpc("ap_finish", { server_secret: secret, team: t.team_id, worked: 0, emails: 0, scored: 0, good: 0, written: 0, note: null }); continue; }

    const keys: FinderKeys = { hunter: ctx.keys.hunter, apollo: ctx.keys.apollo, findymail: ctx.keys.findymail };
    const stopped: Record<string, string> = {};
    const allowed = async (found: string[]) => found.filter((e) => !dncBlocks({ email: e }, dnc));
    const aiKey = ctx.keys[ctx.provider] ?? "";
    const seq = g.sequence === "none" ? null : g.sequence === "default" || !ctx.sequence ? "default" : { steps: ctx.sequence };
    const scoreP = aiPlan("score", ctx.offer, ctx.settings, aiKey, null), writeP = aiPlan("emails", ctx.offer, ctx.settings, aiKey, seq);
    const score = "error" in scoreP ? null : scoreP, write = "error" in writeP ? null : writeP;
    const researchP = aiPlan("research", ctx.offer, ctx.settings, aiKey, null), research = "error" in researchP ? null : researchP;
    const qcP = aiPlan("qc", ctx.offer, ctx.settings, aiKey, null), qc = "error" in qcP ? null : qcP;   // Phase 4C: the QC bot
    if ("error" in scoreP) notes.add(`Score: ${scoreP.error}`);
    if ("error" in writeP) notes.add(`Write: ${writeP.error}`);
    if (g.find_emails && !keys.hunter && !keys.apollo && !keys.findymail) notes.add("Find emails: add Hunter (or Apollo or Findymail) in Connections.");
    let aiStopped = "";

    const timeLeft = () => Date.now() - started < STEP_UNTIL;
    const one = async (lead: Ctx["leads"][number]) => {
      if (!timeLeft()) return;
      let row = { ...lead, data: { ...(lead.data ?? {}) } as Record<string, unknown> };
      const steps: Record<string, string> = {};
      const patch: Record<string, unknown> = {};
      // 1. email
      const noFinder = !keys.hunter && !keys.apollo && !keys.findymail;
      if (!row.email && g.find_emails && noFinder) steps.email = "stopped";   // no finder key yet: try again later
      else if (!row.email && g.find_emails && timeLeft()) {
        room.looked++;
        const f = await findOne(row as FindLead, keys, stopped, dnc, allowed, ctx.rules as never);
        if (f.ok) { Object.assign(patch, f.patch); row = { ...row, email: f.patch.email, website: f.patch.website, data: f.patch.data }; steps.email = f.patch.email ? "found" : "none"; if (f.patch.email) { emails++; room.found.push({ id: row.id, name: nameOf(row) }); } }
        else steps.email = f.why;
      }
      // 2. score (when not judged yet)
      if (!row.verdict && (!score || aiStopped)) steps.score = "stopped";   // no offer / key yet, or AI out: later
      else if (!row.verdict && score && timeLeft()) {
        const r = await aiOne(score, { id: row.id, email: row.email, data: row.data as never }, dnc);
        if (r.ok) { Object.assign(patch, r.patch); row = { ...row, verdict: String(r.patch.verdict ?? ""), data: r.patch.data as Record<string, unknown> }; scored++; steps.score = row.verdict || "done"; room.scored.push({ id: row.id, name: nameOf(row), verdict: row.verdict ?? "" }); if (row.verdict === "Good") good++; }
        else { if (r.fatal) aiStopped = r.fatal; steps.score = r.fatal ? "stopped" : r.why; }
      }
      // 3. research (Phase 4B): the Research bot reads the website of a lead that will be written, once, so the Writer
      // can open with a detail only they have and ask about a real problem. A site that cannot be read is skipped.
      const fits = !g.only_good || row.verdict === "Good";
      const needsResearch = Boolean(row.email) && fits && row.verdict !== "No" && Boolean(row.website || (row.data as { website?: string }).website)
        && !(row.data as { research?: unknown; outreach?: unknown }).research && !(row.data as { outreach?: unknown }).outreach && !(row.data as { research_tried?: unknown }).research_tried;
      if (needsResearch && research && !aiStopped && timeLeft()) {
        const r = await aiOne(research, { id: row.id, email: row.email, data: { ...row.data, website: (row.data as { website?: string }).website || row.website } as never }, dnc);
        if (r.ok) {
          const rs = (r.patch.data as { research: { problem: string; sure: string } }).research;
          row = { ...row, data: { ...row.data, research: rs } }; patch.data = row.data; steps.research = "done";
          room.researched.push({ id: row.id, name: nameOf(row), problem: rs.problem, sure: rs.sure });
        } else if (r.fatal) aiStopped = r.fatal;
        else { row = { ...row, data: { ...row.data, research_tried: Date.now() } }; patch.data = row.data; steps.research = r.why; }
      }
      // 4. write (Good fit only by default; needs an email and no emails written yet)
      const needsWrite = Boolean(row.email) && fits && !(row.data as { outreach?: unknown }).outreach;
      if (needsWrite && (!write || aiStopped)) steps.write = "stopped";
      else if (needsWrite && write && timeLeft()) {
        // Phase 4C: the Writer writes, the QC bot checks, the Writer fixes (2 rounds at most); an email QC cannot pass is held.
        const r = await writeChecked(write, qc, { id: row.id, email: row.email, data: row.data as never }, dnc, 2, () => Date.now() - started < STEP_UNTIL);
        if (r.ok) { Object.assign(patch, r.patch); row = { ...row, data: r.patch.data as Record<string, unknown> }; written++; steps.write = "done";
          room.written.push({ id: row.id, name: nameOf(row), qc: ((r.patch.data as { outreach?: { qc?: { status?: string } } }).outreach?.qc?.status), events: r.events }); }
        else { if (r.fatal) aiStopped = r.fatal; steps.write = r.fatal ? "stopped" : r.why; }
      }
      // Out of time before a step could run: leave the lead as it is (only what was done is saved) for the next run.
      const unfinished = (!row.email && g.find_emails && !steps.email) || (!row.verdict && !steps.score)
        || (Boolean(row.email) && fits && !(row.data as { outreach?: unknown }).outreach && !steps.write);
      // A lead is worked once. If a missing setting, key or credit problem stopped a step, it is tried again in 6 hours
      // (other leads go first meanwhile, so one problem never blocks the queue).
      const blocked = Object.values(steps).includes("stopped");
      if (unfinished && !blocked && !Object.keys(patch).length) return;
      const ap = blocked ? { retryAt: Date.now() + RETRY_MS, ...steps } : unfinished ? undefined : { at: Date.now(), ...steps };
      const data = ap ? { ...row.data, ap } : row.data;
      const { error: saveError } = await sb.rpc("ap_save_lead", { server_secret: secret, team: t.team_id, lead: row.id, patch: { ...patch, data } });
      if (!saveError && !blocked && !unfinished) worked++;
    };
    try {
      for (let i = 0; i < ctx.leads.length && Date.now() - started < NEW_BATCH_UNTIL; i += AT_ONCE) await Promise.all(ctx.leads.slice(i, i + AT_ONCE).map(one));
    } finally {
      // Always record the run (also after an error), so today's count and the team's place in line stay right.
      if (aiStopped) notes.add(`AI: ${aiStopped}`);
      Object.values(stopped).forEach((x) => notes.add(x));
      const note = notes.size ? [...notes].join(" ").slice(0, 500) : null;
      await sb.rpc("ap_finish", { server_secret: secret, team: t.team_id, worked, emails, scored, good, written, note });
      // Funnel daily report (once per 20h in try/catch, no bot_post, no Bot room)
      try {
        await sb.rpc("funnel_post_daily_report", { server_secret: secret, team: t.team_id });
      } catch {
        // quiet: does not block autopilot tick
      }
    }
    report.push(`${t.team_id.slice(0, 8)}: ${worked} worked, ${emails} emails, ${scored} scored, ${written} written`);
  }
  return new Response(report.join("\n") || "nothing due", { status: 200 });
}
