import { NextResponse } from "next/server";
import { dncIndex } from "@/lib/dnc";
import { teamDnc } from "@/lib/dnc-server";
import { currentUser, supabaseServer } from "@/lib/supabase/server";
import { aiOne, aiPlan, writeChecked } from "@/lib/lead-steps";
import type { Offer, Provider } from "@/lib/ai";
import { aboutForAi, cleanAbout } from "@/lib/about";

// AI in the App: judges leads (Good / Maybe / No) or writes the personal parts of first emails, a few leads per call.
// With a sequence (Mail phase 2) the same call writes the first email and every follow-up for the lead in one go.
// The App calls this again and again until every chosen lead is done, so each call stays short.
// Runs as the signed-in person: row-level security decides which leads and offers they can see and change.
// The team's AI key is read here, used for the AI company, and never returned. Kestrel never sends any email.
// The work on each lead is shared with Autopilot (lib/lead-steps.ts).
export const maxDuration = 60;
const MAX_PER_CALL = 8, AT_ONCE = 4;

type Body = { task?: string; ids?: unknown; offerId?: unknown; sequence?: unknown };

export async function POST(request: Request) {
  const started = Date.now();
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as Body;
  const task = body.task === "emails" ? "emails" : body.task === "score" ? "score" : body.task === "research" ? "research" : null;
  const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string" && /^[0-9a-f-]{36}$/i.test(x)).slice(0, MAX_PER_CALL) : [];
  if (!task || !ids.length || typeof body.offerId !== "string") return NextResponse.json({ error: "Nothing to do." }, { status: 400 });

  const sb = await supabaseServer();
  // "current" (the lead panel's Research button): the offer Score and write uses now, else the team's first offer.
  if (body.offerId === "current") {
    const { data: t } = await sb.from("team_ai").select("offer_id").maybeSingle();
    let id = (t as { offer_id?: string | null } | null)?.offer_id ?? "";
    if (!id) { const { data: o1 } = await sb.from("offer_profiles").select("id").order("name").limit(1).maybeSingle(); id = (o1 as { id?: string } | null)?.id ?? ""; }
    body.offerId = id;
  }
  const [{ data: offer }, { data: ai }, { data: aboutRow }, { data: allActiveOffers }] = await Promise.all([
    sb.from("offer_profiles").select("*").eq("id", body.offerId).maybeSingle(),
    sb.from("team_ai").select("*").maybeSingle(),
    sb.from("team_about").select("*").maybeSingle(),   // database 059; before it is run this is empty
    task === "score" ? sb.from("offer_profiles").select("*").order("name") : Promise.resolve({ data: [] }),
  ]);
  const settings = ai ? { ...ai, about: aboutForAi(aboutRow ? cleanAbout(aboutRow) : null) } : null;
  if (!offer) return NextResponse.json({ error: "Choose an offer profile first." }, { status: 400 });
  const activeServices = ((allActiveOffers ?? []) as (Offer & { active?: boolean })[])
    .filter((o) => o.active !== false)
    .map((o) => ({
      ...o,
      buying_triggers: o.buying_triggers || (o.name.includes("Web") ? "Hiring developers, new product launch, tech stack migration" : o.name.includes("Video") ? "Weekly webinar or podcast series, hiring video editor, regular YouTube content" : o.good || ""),
    }));
  // The sequence: "default" = Kestrel's (first email + day 5, 10, 15), a sequence id = the team's own (database 015), none = first email only.
  let sequence: { steps: unknown; id: string } | "default" | null = null;
  if (task === "emails" && body.sequence === "default") sequence = "default";
  else if (task === "emails" && typeof body.sequence === "string" && /^[0-9a-f-]{36}$/i.test(body.sequence)) {
    const { data: row } = await sb.from("sequences").select("id,steps").eq("id", body.sequence).maybeSingle();
    if (!row) return NextResponse.json({ error: "That sequence was not found. Choose it again in Sequences." }, { status: 400 });
    sequence = { steps: row.steps, id: row.id as string };
  }
  // Database 039: the key is read only with the server secret (never straight to a browser).
  const provider = ((settings?.provider as Provider) || "anthropic");
  const { data: key, error: keyError } = await sb.rpc("ai_key_for_server", { server_secret: process.env.MAIL_SERVER_SECRET || "", service: provider });
  // Check the offer, model and sender before the key, so the first missing thing is named.
  const pre = aiPlan(task, offer as Offer, settings, "-", sequence, activeServices);
  if ("error" in pre) return NextResponse.json({ error: pre.error }, { status: 400 });
  if (keyError) return NextResponse.json({ error: /can change leads/.test(keyError.message) ? "Your role can view leads but not run AI. Ask your team owner." : "AI is coming soon to your workspace." }, { status: 403 });
  const plan = aiPlan(task, offer as Offer, settings, typeof key === "string" ? key : "", sequence, activeServices);
  if ("error" in plan) return NextResponse.json({ error: plan.error }, { status: 400 });
  // Phase 4C: written emails are checked by the QC bot and fixed once; one it cannot pass is held from campaigns.
  const qcPlan = task === "emails" ? aiPlan("qc", offer as Offer, settings, typeof key === "string" ? key : "", null) : null;
  const qc = qcPlan && !("error" in qcPlan) ? qcPlan : null;

  let rowsRes = await sb.from("leads").select("id,team_id,email,website,data,outreach_approved").in("id", ids);
  if (rowsRes.error && /outreach_approved/i.test(rowsRes.error.message)) {
    rowsRes = (await sb.from("leads").select("id,team_id,email,website,data").in("id", ids)) as typeof rowsRes;
  }
  const rows = rowsRes.data;
  // The website column is the lead's main site; research reads it when the scraped details have none.
  const leads = ((rows ?? []) as { id: string; team_id: string; email: string | null; website: string | null; data: Record<string, unknown> | null; outreach_approved?: boolean }[])
    .map(({ website, ...l }) => (task === "research" && website && !(l.data as { website?: string } | null)?.website ? { ...l, data: { ...(l.data ?? {}), website } } : l));
  // One team per batch, and its own Do-not-contact list: never write to anyone on it. If the check fails, nothing is written.
  if (leads.some((l) => l.team_id !== leads[0].team_id)) return NextResponse.json({ error: "These leads belong to different teams. Run one team at a time." }, { status: 400 });
  let dnc = dncIndex([]);
  if (task !== "score" && leads.length) {
    try { dnc = await teamDnc(sb, leads[0].team_id, leads.map((l) => ({ email: l.email, emails: (l.data as { emails?: string[] } | null)?.emails, website: (l.data as { website?: string } | null)?.website }))); }
    catch { return NextResponse.json({ error: "Could not check your Do-not-contact list just now. Try again in a minute." }, { status: 503 }); }
  }
  const done: Record<string, unknown>[] = [], skipped: { id: string; why: string }[] = [];
  let cost: number | null = 0, fatal = "";
  const one = async (l: (typeof leads)[number]) => {
    if (fatal) return;
    if (task === "emails") {
      const isApproved = l.outreach_approved === true || Boolean((l.data as Record<string, unknown> | null)?.outreach_approved);
      if (!isApproved) {
        skipped.push({ id: l.id, why: "Needs human review: approve opportunity report first" });
        return;
      }
    }
    console.log(`[ai-route] start task=${task} lead=${l.id}`);
    const r = task === "emails" ? await writeChecked(plan, qc, l, dnc, 1, () => Date.now() - started < 42_000) : await aiOne(plan, l, dnc);
    cost = cost === null || r.cost === null ? null : cost + r.cost;
    if (!r.ok) {
      console.log(`[ai-route] task=${task} lead=${l.id} not ok: ${r.why || r.fatal}`);
      if (r.fatal) fatal = r.fatal; else skipped.push({ id: l.id, why: r.why });
      return;
    }
    let { error } = await sb.from("leads").update(r.patch).eq("id", l.id);
    if (error && /column.*does not exist|schema cache/i.test(error.message)) {
      const safePatch = { ...r.patch };
      delete safePatch.matched_service_id;
      delete safePatch.buying_trigger;
      delete safePatch.outreach_approved;
      delete safePatch.outreach_approved_at;
      delete safePatch.outreach_approved_by;
      const res2 = await sb.from("leads").update(safePatch).eq("id", l.id);
      error = res2.error;
    }
    if (error) {
      console.log(`[ai-route] error saving lead=${l.id}: ${error.message}`);
      skipped.push({ id: l.id, why: "could not save" });
    } else {
      console.log(`[ai-route] saved lead=${l.id} patch=`, JSON.stringify(r.patch));
      done.push(r.result);
    }
  };
  for (let i = 0; i < leads.length; i += AT_ONCE) await Promise.all(leads.slice(i, i + AT_ONCE).map(one));
  return NextResponse.json({ done, skipped, cost, error: fatal || undefined });
}
