import { NextResponse } from "next/server";
import { dncIndex } from "@/lib/dnc";
import { teamDnc } from "@/lib/dnc-server";
import { currentUser, supabaseServer } from "@/lib/supabase/server";
import { aiOne, aiPlan, writeChecked } from "@/lib/lead-steps";
import { cleanVoiceNotes, readJson, voiceSystem, VOICE_SCHEMA, type Offer, type Provider } from "@/lib/ai";
import { aboutForAi, cleanAbout } from "@/lib/about";
import { AI_TASKS, checkKestrelAllowance, kestrelGateError, runAiTask } from "@/lib/ai-router";
import { LABEL_SCHEMA, LABEL_SYSTEM } from "@/lib/inbox";

// AI in the App: judges leads (Good / Maybe / No) or writes the personal parts of first emails, a few leads per call.
// With a sequence (Mail phase 2) the same call writes the first email and every follow-up for the lead in one go.
// The App calls this again and again until every chosen lead is done, so each call stays short.
// Runs as the signed-in person: row-level security decides which leads and offers they can see and change.
// The team's AI key is read here, used for the AI company, and never returned. Kestrel never sends any email.
// The work on each lead is shared with Autopilot (lib/lead-steps.ts).
export const maxDuration = 60;
const MAX_PER_CALL = 8, AT_ONCE = AI_TASKS.write.maxConcurrent ?? 3;

type Body = { task?: string; ids?: unknown; offerId?: unknown; sequence?: unknown; samples?: unknown; timeoutMs?: unknown; text?: unknown };

export async function POST(request: Request) {
  const started = Date.now();
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as Body;
  const timeoutOverride = typeof body.timeoutMs === "number" ? body.timeoutMs : undefined;

  const sb = await supabaseServer();

  // Stage D1: Voice Profile analysis from past sent emails (notes only, raw samples never stored)
  if (body.task === "voice") {
    const samples = typeof body.samples === "string" ? body.samples.trim() : "";
    if (samples.length < 50) {
      return NextResponse.json({ error: "Please paste at least 5 to 10 sample emails (minimum 50 characters)." }, { status: 400 });
    }
    const { data: member } = await sb.from("members").select("team_id").eq("user_id", user.id).maybeSingle();
    const teamId = (member as { team_id?: string } | null)?.team_id || "";
    if (!teamId) return NextResponse.json({ error: "Team not found." }, { status: 403 });

    const userPrompt = `<sample_emails>\n${samples.slice(0, 15000)}\n</sample_emails>`;
    const res = await runAiTask({
      sb,
      teamId,
      userId: user.id,
      task: "voice",
      system: voiceSystem(),
      user: userPrompt,
      schema: VOICE_SCHEMA,
      maxTokens: 800,
      timeoutMs: timeoutOverride,
    });
    if (!res.ok) {
      return NextResponse.json({ error: res.error }, { status: 500 });
    }
    const notes = cleanVoiceNotes(readJson(res.text));
    return NextResponse.json({ ok: true, notes });
  }

  // Task explain: explains email concepts in plain English
  if (body.task === "explain") {
    const text = typeof body.text === "string" ? body.text.trim() : "Explain why cold email requires SPF and DKIM.";
    const { data: member } = await sb.from("members").select("team_id").eq("user_id", user.id).maybeSingle();
    const teamId = (member as { team_id?: string } | null)?.team_id || "";
    if (!teamId) return NextResponse.json({ error: "Team not found." }, { status: 403 });

    const res = await runAiTask({
      sb,
      teamId,
      userId: user.id,
      task: "explain",
      system: "You are a concise outreach specialist explaining email concepts in plain English under 50 words.",
      user: text,
      maxTokens: 500,
      timeoutMs: timeoutOverride,
    });
    if (!res.ok) {
      return NextResponse.json({ error: res.error }, { status: 500 });
    }
    return NextResponse.json({ ok: true, text: res.text });
  }

  // Task reply_suggest: AI reply options for an incoming email
  if (body.task === "reply_suggest") {
    const replyText = typeof body.text === "string" ? body.text : "Hi Affan, sounds interesting. Can you send over a proposal and pricing?";
    const { data: member } = await sb.from("members").select("team_id").eq("user_id", user.id).maybeSingle();
    const teamId = (member as { team_id?: string } | null)?.team_id || "";
    if (!teamId) return NextResponse.json({ error: "Team not found." }, { status: 403 });

    const res = await runAiTask({
      sb,
      teamId,
      userId: user.id,
      task: "reply_suggest",
      system: "You help a small B2B business answer replies to its cold emails. Write three different short answers the sender could send back under 70 words each.",
      user: `<reply>${replyText}</reply>`,
      schema: {
        type: "object",
        properties: {
          options: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                text: { type: "string" }
              },
              required: ["title", "text"]
            }
          }
        },
        required: ["options"]
      },
      maxTokens: 900,
      timeoutMs: timeoutOverride,
    });
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: 500 });
    return NextResponse.json({ ok: true, data: res.data });
  }

  // Task chat: Kestrel Assistant chat
  if (body.task === "chat") {
    const text = typeof body.text === "string" ? body.text.trim() : "Hi! Can you give me one quick tip on writing good cold email icebreakers?";
    const { data: member } = await sb.from("members").select("team_id").eq("user_id", user.id).maybeSingle();
    const teamId = (member as { team_id?: string } | null)?.team_id || "";
    if (!teamId) return NextResponse.json({ error: "Team not found." }, { status: 403 });

    const res = await runAiTask({
      sb,
      teamId,
      userId: user.id,
      task: "chat",
      system: "You are the Kestrel Assistant, helping small businesses with cold email outreach. Answer concisely in plain English under 50 words.",
      user: text,
      maxTokens: 500,
      timeoutMs: timeoutOverride,
    });
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: 500 });
    return NextResponse.json({ ok: true, text: res.text });
  }

  // Task reply_label: AI labeling of incoming email intent
  if (body.task === "reply_label") {
    const replyText = typeof body.text === "string" ? body.text : "Thanks for reaching out! Let's schedule a call next Tuesday at 2pm.";
    const { data: member } = await sb.from("members").select("team_id").eq("user_id", user.id).maybeSingle();
    const teamId = (member as { team_id?: string } | null)?.team_id || "";
    if (!teamId) return NextResponse.json({ error: "Team not found." }, { status: 403 });

    const res = await runAiTask({
      sb,
      teamId,
      userId: user.id,
      task: "reply_label",
      system: LABEL_SYSTEM,
      user: `<reply>${replyText}</reply>`,
      schema: LABEL_SCHEMA,
      maxTokens: 300,
      timeoutMs: timeoutOverride,
    });
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: 500 });
    return NextResponse.json({ ok: true, data: res.data });
  }

  const task = body.task === "emails" ? "emails" : body.task === "score" ? "score" : body.task === "research" ? "research" : null;
  const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string" && /^[0-9a-f-]{36}$/i.test(x)).slice(0, MAX_PER_CALL) : [];
  if (!task || !ids.length || typeof body.offerId !== "string") return NextResponse.json({ error: "Nothing to do." }, { status: 400 });
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
  const cleanAb = aboutRow ? cleanAbout(aboutRow) : null;
  const settings = ai ? { ...ai, about: aboutForAi(cleanAb) } : null;
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
  // This lookup is also the plan and role gate (database 056): a Viewer, or a team whose trial or plan ended, gets an
  // error here. Stop now. Before AI-4a the missing key stopped them; now "no key" means Kestrel-paid AI, so an
  // ignored error would hand them free Kestrel AI.
  if (keyError) {
    const gate = kestrelGateError(keyError.message || "");
    return gate.code
      ? NextResponse.json({ error: gate.customer }, { status: 403 })
      : NextResponse.json({ error: "Could not check your AI access just now. Try again in a minute." }, { status: 503 });
  }
  // Check the offer, model and sender before the key, so the first missing thing is named.
  const pre = aiPlan(task, offer as Offer, settings, "-", sequence, activeServices, cleanAb?.voice_notes, cleanAb);
  if ("error" in pre) return NextResponse.json({ error: pre.error }, { status: 400 });
  const rawPlan = aiPlan(task, offer as Offer, settings, typeof key === "string" ? key : "", sequence, activeServices, cleanAb?.voice_notes, cleanAb);
  if ("error" in rawPlan) return NextResponse.json({ error: rawPlan.error }, { status: 400 });

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
  const batchTeamId = leads[0]?.team_id || (offer as { team_id?: string })?.team_id || "";
  const requestDeadline = started + 50_000;

  const plan = { ...rawPlan, sb, teamId: batchTeamId, userId: user.id, deadlineMs: requestDeadline };
  // Phase 4C: written emails are checked by the QC bot and fixed once; one it cannot pass is held from campaigns.
  const qcPlan = task === "emails" ? aiPlan("qc", offer as Offer, settings, typeof key === "string" ? key : "", null, activeServices, cleanAb?.voice_notes, cleanAb) : null;
  const qc = qcPlan && !("error" in qcPlan) ? { ...qcPlan, sb, teamId: batchTeamId, userId: user.id, deadlineMs: requestDeadline } : null;
  let dnc = dncIndex([]);
  if (task !== "score" && leads.length) {
    try { dnc = await teamDnc(sb, leads[0].team_id, leads.map((l) => ({ email: l.email, emails: (l.data as { emails?: string[] } | null)?.emails, website: (l.data as { website?: string } | null)?.website }))); }
    catch { return NextResponse.json({ error: "Could not check your Do-not-contact list just now. Try again in a minute." }, { status: 503 }); }
  }
  const done: Record<string, unknown>[] = [], skipped: { id: string; why: string }[] = [];
  if (typeof key !== "string" || !key) {
    const limit = await checkKestrelAllowance(sb, batchTeamId);
    if (!limit.allowed) {
      return NextResponse.json({
        done: [],
        skipped: leads.map((l) => ({ id: l.id, why: limit.message! })),
        cost: 0,
        error: limit.message!,
      });
    }
  }
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
    const r = task === "emails" ? await writeChecked(plan, qc, l, dnc, 2, () => Date.now() - started < 45_000) : await aiOne(plan, l, dnc);
    cost = cost === null || r.cost === null ? null : cost + r.cost;
    if (!r.ok) {
      console.log(`[ai-route] task=${task} lead=${l.id} not ok: ${r.why || r.fatal}`);
      // Stop the batch only when every other lead would fail the same way (allowance used up, trial ended, key
      // rejected). One lead's provider error or broken answer skips that lead only.
      if (r.stop) fatal = r.why || r.fatal || "Stopped.";
      if (r.why) {
        skipped.push({ id: l.id, why: r.why });
      } else if (r.fatal) {
        skipped.push({ id: l.id, why: r.fatal });
      }
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
      delete safePatch.angle;
      delete safePatch.angle_reason;
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
  let stoppedEarly = false;
  let remainingIds: string[] = [];
  for (let i = 0; i < leads.length; i += AT_ONCE) {
    if (Date.now() - started > 45_000) {
      stoppedEarly = true;
      remainingIds = leads.slice(i).map((l) => l.id);
      break;
    }
    await Promise.all(leads.slice(i, i + AT_ONCE).map(one));
    if (fatal) {
      for (const rem of leads.slice(i + AT_ONCE)) {
        if (!skipped.some((s) => s.id === rem.id)) {
          skipped.push({ id: rem.id, why: fatal });
        }
      }
      break;
    }
  }
  if (stoppedEarly && remainingIds.length) {
    for (const remId of remainingIds) {
      if (!skipped.some((s) => s.id === remId)) {
        skipped.push({ id: remId, why: "Not done — AI busy, try again" });
      }
    }
  }
  return NextResponse.json({
    done,
    skipped,
    cost,
    ...(stoppedEarly ? { continue: true, remaining: remainingIds } : {}),
    error: fatal || undefined,
  });
}
