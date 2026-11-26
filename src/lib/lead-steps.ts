import "server-only";
import { dncBlocks, type DncIndex } from "./dnc";
import { modelForTask } from "./ai-models";
import { DEFAULT_STEPS, checkSequence, cleanSteps, emailStepsProblem, followUpCount, type Step } from "./sequence";
import { readSite } from "./site-read";
import { trustedFirstName } from "./email-check";
import {
  EMPTY_SENDER, FIT_SCHEMA, PROVIDERS, QC_SCHEMA, RESEARCH_SCHEMA, VERDICT_COLUMN, cleanFit, cleanQc, cleanResearch, qcPayload, qcSystem, researchSystem, type Draft, type Qc, cleanFollowUps, cleanParts, emailMissing, emailPayload, emailSystem, fitSystem, leadPayload,
  makeDraft, offerReady, profileHash, readJson, sequenceSchema, type LeadData, type Offer, type Provider, type Sender
} from "./ai";
import type { About, VoiceNotes } from "./about";
import { pickAngle } from "./angles";
import { hostOf, hunterPick, hunterUrl, mergeContacts, setEmails, type Contact } from "./hunter";
import { applyRules, cleanRules, type ScoreLead } from "./scoring";
import { apolloFind, findymailFind } from "./finders";
import { runAiTask, type AiTaskName } from "./ai-router";
import type { supabaseServer } from "./supabase/server";

type Sb = Awaited<ReturnType<typeof supabaseServer>>;

// One lead through one step, without touching the database: the App's buttons (/api/ai, /api/emails) and Autopilot's
// daily run (/api/autopilot/tick) all use these, so a lead is treated the same way whoever starts the work.

// A money amount anywhere in an email ($49, £20, 30 EUR): the class rule is no prices in cold email.
const MONEY = /[$€£¥]\s?\d|\b\d+(?:[.,]\d+)?\s?(?:usd|eur|gbp|dollars?|euros?|pounds?)\b/i;

// ---------- AI: score or write
export type AiPlan = {
  task: "score" | "emails" | "research" | "qc"; provider: Provider; key: string; model: string; effort?: "low" | "medium" | "high";
  offer: Offer; sender: Sender; hash: string; system: string; schema: object; followUps: number;
  seq: { steps: Step[]; id?: string } | null;
  activeServices?: Offer[];
  voiceNotes?: VoiceNotes;
  about?: About | null;
  by?: string;   // who wrote it, when not the team's AI company (Kestrel MCP: "claude-code / codex")
  sb?: Sb;
  teamId?: string;
  userId?: string | null;
  deadlineMs?: number;
  providerFn?: typeof import("./ai-router/providers").callProvider;
};
// Checks the offer, sender, model and sequence, and builds what every lead in the batch shares. Returns an error in plain words.
export function aiPlan(task: "score" | "emails" | "research" | "qc", offer: Offer | null, settings: Record<string, unknown> | null, key: string,
  sequence: { steps: unknown; id?: string } | "default" | null, activeServices?: Offer[], voiceNotes?: VoiceNotes, about?: About | null): AiPlan | { error: string } {
  if (!offer) return { error: "Choose an offer profile first." };
  const s: Sender = { ...EMPTY_SENDER, ...(settings ?? {}) } as Sender;
  // "auto" (the default for Claude): Haiku 5.5 judges leads, Sonnet 5.5 writes emails. A model the team chose is used as it is.
  // When the team has no key (key === ""), Kestrel's included AI (Swift slot) is used instead.
  const provider = ((settings?.provider as Provider) || "anthropic"), pick = modelForTask(provider, String(settings?.model ?? ""), task === "emails" ? "emails" : "score");   // research uses the quick model
  if (key && !pick.model) return { error: `Choose a ${PROVIDERS[provider]?.label ?? "AI"} model first: Integrations → Services → click Test on the key to load its models, then pick one under “AI for Score and write” and Save. Names have no spaces (e.g. gemini-2.5-flash).` };
  if (!offerReady(offer)) return { error: "Add what you sell and your ideal customer to this offer first." };
  if (task === "emails") { const miss = emailMissing(offer, s); if (miss.length) return { error: `Add ${miss.join(", ")} first.` }; }
  let seq: AiPlan["seq"] = null;
  if (task === "emails" && sequence === "default") seq = { steps: DEFAULT_STEPS };
  else if (task === "emails" && sequence && sequence !== "default") {
    seq = { steps: cleanSteps(sequence.steps), id: sequence.id };
    if (checkSequence(seq.steps).blocked) return { error: "That sequence has red items in its spam check (prices, payment words or unknown fields). Fix it in Sequences first." };
  }
  const followUps = seq ? followUpCount(seq.steps) : 0;
  return {
    task, provider, key, model: pick.model, effort: key && provider === "anthropic" ? pick.effort : undefined, offer, sender: s, hash: profileHash(offer),
    by: key ? undefined : "kestrel",
    system: task === "score" ? fitSystem(offer, s.about ?? "", activeServices) : task === "research" ? researchSystem() : task === "qc" ? qcSystem(offer, voiceNotes) : emailSystem(offer, s, seq?.steps, voiceNotes),
    schema: task === "score" ? FIT_SCHEMA : task === "research" ? RESEARCH_SCHEMA : task === "qc" ? QC_SCHEMA : sequenceSchema(followUps), followUps, seq, activeServices,
    voiceNotes, about
  };
}

export type LeadIn = { id: string; email: string | null; data: LeadData | null };
export type AiResult =
  | { ok: true; patch: Record<string, unknown>; result: Record<string, unknown>; cost: number | null }
  | { ok: false; why: string; cost: number | null; fatal?: string };

// One lead: asks the AI and returns the database change to save (or why it was skipped). A key or quota problem is "fatal".
export async function aiOne(p: AiPlan, l: LeadIn, dnc: DncIndex, fix: string[] = []): Promise<AiResult> {
  const data = l.data ?? {};
  if (p.task === "emails" && !l.email) return { ok: false, why: "no email", cost: 0 };
  // Stage C (Opportunity Intelligence): human must approve before lead can be used for outreach
  if (p.task === "emails") {
    const isApproved = (l as { outreach_approved?: boolean }).outreach_approved === true ||
      Boolean((data as Record<string, unknown>).outreach_approved);
    if (!isApproved) return { ok: false, why: "Needs human review: approve opportunity report first", cost: 0 };
  }
  if (p.task !== "score" && dncBlocks({ email: l.email, emails: (data as { emails?: string[] }).emails, website: (data as { website?: string }).website }, dnc)) return { ok: false, why: "do not contact", cost: 0 };
  // Research (Phase 4B): read the lead's own website first; no website or an unreadable one means nothing to research.
  let site: { text: string; host: string } | null = null;
  if (p.task === "research") {
    const r = await readSite(String((data as { website?: string }).website ?? ""));
    if ("error" in r) return { ok: false, why: r.error, cost: 0 };
    site = r;
  }
  try {
    const chosenAngle = p.task === "emails"
      ? pickAngle(data, p.offer, p.about ?? null, (data as Record<string, unknown>).buying_trigger as string | null)
      : null;
    const sys = p.task === "emails" && chosenAngle
      ? emailSystem(p.offer, p.sender, p.seq?.steps, p.voiceNotes, chosenAngle)
      : p.system;
    const user = p.task === "research"
      ? `<website host="${site!.host}">\n${site!.text.replace(/<\/?website/gi, "")}\n</website>`
      : `<lead>${JSON.stringify(p.task === "score" ? leadPayload(data) : emailPayload({ ...data, email: l.email ?? (data as { email?: string }).email }))}</lead>`
      // Phase 4C: the QC bot's notes on the last draft, for the rewrite.
      + (fix.length ? `\n<qc_notes>\nA checker found these problems in your last version. Write it again and fix every one:\n${fix.map((x) => `- ${x}`).join("\n")}\n</qc_notes>` : "");
    const routerTask: AiTaskName = p.task === "emails" ? "write" : p.task === "score" ? "score" : "research";
    if (p.sb && p.teamId) {
      const res = await runAiTask({
        sb: p.sb,
        teamId: p.teamId,
        userId: p.userId,
        task: routerTask,
        system: sys,
        user,
        schema: p.schema,
        maxTokens: p.task === "emails" ? 2500 : p.task === "research" ? 800 : 1500,
        effort: p.effort,
        deadlineMs: p.deadlineMs,
        providerFn: p.providerFn,
      });
      if (!res.ok) {
        const mapped = aiLeadError(res);
        return { ok: false, why: mapped.why, cost: res.cost_usd ?? 0, fatal: mapped.fatal };
      }
      const json = readJson(res.text);
      if (!json) {
        return { ok: false, why: "AI answer was broken. Try again.", cost: res.cost_usd ?? 0 };
      }
      return aiAnswer(p, l, json, res.cost_usd, site?.host, site?.text);
    }
    return { ok: false, why: "error", cost: 0, fatal: "Database connection not provided." };
  } catch (e) {
    return { ok: false, why: "error", cost: 0, fatal: e instanceof Error ? e.message : "Error" };
  }
}

// Plain, honest error classification for AI lead processing
export function aiLeadError(res: {
  error?: string;
  status?: string;
  lastError?: string;
  statusCode?: number;
}): { why: string; fatal?: string } {
  const err = String(res.error || "");
  const raw = String(res.lastError || "");
  const statusCode = res.statusCode;
  const combined = `${err} ${raw}`;

  // 0. Monthly Kestrel AI allowance exhausted
  if (raw === "monthly_allowance_reached" || (res.status === "skipped" && /used up/i.test(err))) {
    return { why: err, fatal: err };
  }

  // 1. Real 429 / rate_limited
  if (
    statusCode === 429 ||
    /\b429\b|rate_limited/i.test(combined) ||
    (err.includes("busy") && !err.includes("can't answer"))
  ) {
    return { why: "Not done — AI busy, try again" };
  }

  // 2. Bad or missing key (401, 403, key rejected, unauthorized)
  if (
    statusCode === 401 ||
    statusCode === 403 ||
    /\b401\b|\b403\b|rejected|invalid.*key|unauthorized|permission|no.*key.*configured|no.*ai key/i.test(combined)
  ) {
    return { why: "Your AI key was rejected. Check Settings → AI.", fatal: res.error };
  }

  // 3. 413 too large
  if (
    statusCode === 413 ||
    /\b413\b|too large|context length|page is too long/i.test(combined)
  ) {
    return { why: "This lead's page is too long for AI. Skipped." };
  }

  // 4. Timeout
  if (res.status === "timeout" || /\btimeout\b|took too long|deadline|no time left/i.test(combined)) {
    return { why: "AI took too long. Try again." };
  }

  // 5. Bad JSON from provider error
  if (/failed to.*json|broken.*json|invalid json/i.test(combined)) {
    return { why: "AI answer was broken. Try again." };
  }

  // 6. 500 Server error
  if ((statusCode && statusCode >= 500 && statusCode < 600) || /\b5\d{2}\b|server error/i.test(combined)) {
    return { why: "AI server error. Try again in a minute.", fatal: res.error };
  }

  return { why: err || "error", fatal: res.error };
}

// An AI answer (already parsed JSON) → the database change, with every check of the App's own AI: a readable fit, a full
// email and follow-ups, no [FIELD] left, no price or payment words. Used for the team's AI and for Kestrel MCP (the person's
// own Claude Code or Codex plan). Do-not-contact is checked by the caller before (aiOne, /api/mcp/ai-save).
export function aiAnswer(p: AiPlan, l: LeadIn, raw: unknown, cost: number | null = 0, host = "", siteText = ""): AiResult {
  const data = l.data ?? {};
  const answer = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
  const by = p.by ?? p.provider;
  if (p.task === "research") {
    const r = cleanResearch(answer, siteText, host);
    if (!r) return { ok: false, why: "AI answer was broken. Try again.", cost };
    const research = { ...r, host: host.slice(0, 120), by, at: Date.now() };
    return { ok: true, patch: { data: { ...data, research } }, result: { id: l.id, research, dropped_observations: r.dropped_observations }, cost };
  }
  if (p.task === "score") {
    const f = cleanFit(answer);
    if (!f) return { ok: false, why: "AI answer was broken. Try again.", cost };

    // Validate matched_service_id: keep it only if it equals the id of one of the team's ACTIVE services;
    // otherwise drop it and set matched_service_name from the real service, never from the AI text.
    let matchedId: string | undefined = undefined;
    let matchedName: string | undefined = undefined;
    let matchedTrigger: string | undefined = undefined;
    if (f.verdict !== "no" && f.matched_service_id && p.activeServices && p.activeServices.length > 0) {
      const activeMatch = p.activeServices.find((s) => s.id === f.matched_service_id && s.active !== false);
      if (activeMatch) {
        matchedId = activeMatch.id;
        matchedName = activeMatch.name;
        if (f.buying_trigger && activeMatch.buying_triggers) {
          matchedTrigger = f.buying_trigger;
        }
      }
    }

    const cleanF = {
      ...f,
      ...(matchedId ? { matched_service_id: matchedId, matched_service_name: matchedName } : {}),
      ...(matchedTrigger ? { buying_trigger: matchedTrigger } : {}),
    };
    if (!matchedId || cleanF.verdict === "no") {
      delete cleanF.matched_service_id;
      delete cleanF.matched_service_name;
      delete cleanF.buying_trigger;
    }

    const ai = { ...cleanF, profile: p.hash, by, at: Date.now() };
    const patch: Record<string, unknown> = {
      verdict: VERDICT_COLUMN[f.verdict],
      reason: f.reason,
      score: f.fit,
      outreach_approved: false,
      data: { ...data, ai, outreach_approved: false },
      ...(matchedId ? { matched_service_id: matchedId } : { matched_service_id: null }),
      ...(matchedTrigger ? { buying_trigger: matchedTrigger } : { buying_trigger: null }),
    };
    const resObj: Record<string, unknown> = {
      id: l.id,
      verdict: VERDICT_COLUMN[f.verdict],
      reason: f.reason,
      fit: f.fit,
    };
    if (matchedId) {
      resObj.matched_service_id = matchedId;
    }
    if (matchedName) {
      resObj.matched_service_name = matchedName;
    }
    if (matchedTrigger) {
      resObj.buying_trigger = matchedTrigger;
    }
    return { ok: true, patch, result: resObj, cost };
  }
  const parts = cleanParts(answer), fu = cleanFollowUps(answer, p.followUps);
  if (!parts) return { ok: false, why: "AI answer was broken. Try again.", cost };
  // Only a real person's name Kestrel has for this lead, never the company name (19 Nov 2026).
  parts.first_name = trustedFirstName(parts.first_name, {
    name: (data as { name?: string }).name, email: l.email ?? (data as { email?: string }).email,
    contacts: (data as { contacts?: { name?: string }[] }).contacts
  });
  const outreach = { ...makeDraft(parts, p.offer, p.sender, p.provider, p.seq, fu, l.id, p.voiceNotes), ...(p.by ? { by: p.by } : {}) };
  // Never save a draft that would send a visible [FIELD] (e.g. no booking link set) or price / trial / money words.
  const emails = (outreach.steps ?? [{ body: outreach.body, subject: outreach.subject }]).filter((x) => !("kind" in x) || !x.kind || x.kind === "email");
  const unfilled = emails.map((x) => `${x.subject} ${x.body}`.match(/\[([A-Z][A-Z_]{2,})\]/)?.[1]).find(Boolean);
  if (unfilled) return { ok: false, why: `${unfilled.replace(/_/g, " ").toLowerCase()} is not set`, cost };
  if (outreach.flags?.length || emails.some((x) => MONEY.test(`${x.subject} ${x.body}`))) return { ok: false, why: "price or payment words", cost };
  // The database's own check (email_steps_problem), so a draft that Start would skip is caught now, with the reason.
  const problem = emailStepsProblem(emails as { subject?: string; body?: string; kind?: string }[]);
  if (problem) return { ok: false, why: `${problem}: rewrite it`, cost };

  const chosenAngle = pickAngle(data, p.offer, p.about ?? null, (data as Record<string, unknown>).buying_trigger as string | null);
  const patch: Record<string, unknown> = {
    data: {
      ...data,
      outreach,
      angle: chosenAngle.angle,
      angle_reason: chosenAngle.why,
      angle_principles: chosenAngle.principles,
    },
    angle: chosenAngle.angle,
    angle_reason: chosenAngle.why,
  };
  return {
    ok: true,
    patch,
    result: {
      id: l.id,
      draft: outreach,
      angle: chosenAngle.angle,
      angle_reason: chosenAngle.why,
      angle_principles: chosenAngle.principles,
    },
    cost
  };
}

// ---------- QC (Phase 4C): the QC bot checks a written email; the Writer fixes it with QC's notes.
export type QcEvent = { who: "qc" | "writer"; kind: "issue" | "fix" | "pass" | "hold"; text: string };
export async function qcOne(p: AiPlan, data: LeadData, draft: Draft): Promise<{ ok: true; pass: boolean; issues: string[]; cost: number | null } | { ok: false; fatal?: string; cost: number | null }> {
  try {
    const fullDraftText = `${draft.subject || ""}\n\n${draft.body || ""}\n\n${(draft.steps || []).map((s) => s.body).join("\n\n")}`;
    if (p.sb && p.teamId) {
      const res = await runAiTask({
        sb: p.sb,
        teamId: p.teamId,
        userId: p.userId,
        task: "qc",
        system: p.system,
        user: `<check>${JSON.stringify(qcPayload(data, draft))}</check>`,
        schema: p.schema,
        maxTokens: 700,
        effort: p.effort,
        deadlineMs: p.deadlineMs,
        onCodeChecksOnly: () => {
          const codeQc = cleanQc({ pass: true, issues: [] }, fullDraftText, p.voiceNotes);
          return (codeQc ?? { pass: true, issues: [] }) as Record<string, unknown>;
        },
      });
      if (!res.ok) {
        return { ok: false, cost: res.cost_usd ?? null, fatal: res.error };
      }
      const q = cleanQc(readJson(res.text), fullDraftText, p.voiceNotes);
      return q ? { ok: true, ...q, cost: res.cost_usd } : { ok: false, cost: res.cost_usd };
    }
    return { ok: false, cost: 0, fatal: "Database connection not provided." };
  } catch (e) {
    return { ok: false, cost: 0, fatal: e instanceof Error ? e.message : undefined };
  }
}
// Write, check, and fix up to `rounds` times (Stage D: default 2 fix rounds, then hold).
export async function writeChecked(w: AiPlan, qc: AiPlan | null, l: LeadIn, dnc: DncIndex, rounds = 2, more: () => boolean = () => true):
  Promise<AiResult & { events?: QcEvent[] }> {
  let r = await aiOne(w, l, dnc);
  if (!r.ok || !qc) return r;
  const events: QcEvent[] = [];
  let cost = r.cost, round = 0, fixed: string[] = [];
  const add = (c: number | null) => { cost = cost === null || c === null ? null : cost + c; };
  const draftOf = (x: AiResult) => ((x as unknown as { patch: { data: { outreach: Draft } } }).patch.data.outreach);
  const leadData = { ...(l.data ?? {}), email: l.email ?? (l.data as { email?: string } | null)?.email } as LeadData;
  let qcState: Qc = { status: "unchecked", issues: [], rounds: 0, at: Date.now() };
  while (true) {
    const q = await qcOne(qc, leadData, draftOf(r));
    add(q.cost);
    if (!q.ok) {
      if (q.fatal) return { ok: false, why: "error", cost, fatal: q.fatal };
      const curDraft = draftOf(r);
      const codeQc = cleanQc({ pass: true, issues: [] }, `${curDraft.subject || ""} ${curDraft.body || ""}`, w.voiceNotes);
      if (codeQc && !codeQc.pass) {
        qcState = { status: "hold", issues: codeQc.issues, rounds: round, at: Date.now() };
        events.push({ who: "qc", kind: "hold", text: codeQc.issues.join(" ") });
      } else {
        qcState = { status: "passed", issues: [], rounds: round, at: Date.now() };
        events.push({ who: "qc", kind: "pass", text: "Passed code-level QC check." });
      }
      break;
    }
    if (q.pass) { qcState = { status: "passed", issues: [], rounds: round, at: Date.now(), ...(fixed.length ? { fixed } : {}) }; events.push({ who: "qc", kind: "pass", text: round ? `Passed after ${round} fix${round === 1 ? "" : "es"}.` : "Passed." }); break; }
    if (round >= rounds || !more()) { qcState = { status: "hold", issues: q.issues, rounds: round, at: Date.now(), ...(fixed.length ? { fixed } : {}) }; events.push({ who: "qc", kind: "hold", text: q.issues.join(" ") }); break; }
    events.push({ who: "qc", kind: "issue", text: q.issues.join(" ") });
    const again = await aiOne(w, l, dnc, q.issues);
    add(again.cost);
    if (!again.ok) { if (again.fatal) return { ok: false, why: "error", cost, fatal: again.fatal }; qcState = { status: "hold", issues: q.issues, rounds: round, at: Date.now() }; events.push({ who: "qc", kind: "hold", text: q.issues.join(" ") }); break; }
    r = again; round++; fixed = [...fixed, ...q.issues].slice(0, 8);
    events.push({ who: "writer", kind: "fix", text: "Rewrote it with QC's notes." });
  }
  const d = draftOf(r);
  const outreach = { ...d, qc: qcState };
  const done = r as Extract<AiResult, { ok: true }>;
  const patch = { ...done.patch, data: { ...(done.patch.data as Record<string, unknown>), outreach } };
  return { ok: true, patch, result: { ...done.result, draft: outreach, qc: qcState }, cost, events };
}

// ---------- Find emails: Hunter, then Apollo / Findymail for a named person
export type FinderKeys = { hunter?: string; apollo?: string; findymail?: string };
export type FindLead = {
  id: string; name: string | null; website: string | null; email: string | null;
  data: (ScoreLead & { emails?: string[]; contacts?: Contact[]; hunterAt?: number }) | null
};
export type FindResult =
  | { ok: true; patch: { email: string | null; website: string | null; named: boolean; data: Record<string, unknown> } }
  | { ok: false; why: string };
const hasTarget = (l: FindLead, data: { website?: unknown; name?: unknown }) => Boolean(l.website || data.website || l.name || data.name);

// `stopped` is shared by the whole batch: a finder that failed (bad key, no credits) is not asked again in this run.
// `allowed` returns the found addresses that are not on Do-not-contact (fail closed: [] when the check cannot run).
export async function findOne(l: FindLead, keys: FinderKeys, stopped: Record<string, string>, dnc: DncIndex,
  allowed: (found: string[]) => Promise<string[]>, rules: Parameters<typeof cleanRules>[0]): Promise<FindResult> {
  const data = { ...(l.data ?? {}) } as NonNullable<FindLead["data"]>;
  if (l.email) return { ok: false, why: "has email" };
  if (dncBlocks({ email: l.email, emails: data.emails, website: l.website }, dnc)) return { ok: false, why: "do not contact" };
  if (!(["hunter", "apollo", "findymail"] as const).some((id) => keys[id] && !stopped[id])) return { ok: false, why: "stopped" };
  let asked = false;
  if (keys.hunter && !stopped.hunter) {
    const url = hunterUrl({ website: l.website || data.website, name: l.name || data.name }, keys.hunter);
    const res = url ? await fetch(url, { signal: AbortSignal.timeout(20000) }).catch(() => null) : null;
    if (url && !res) stopped.hunter = "Hunter did not answer. Try again in a minute.";
    else if (res?.status === 401) stopped.hunter = "Hunter did not accept your team's key. Replace it in Integrations → Services.";
    else if (res?.status === 429) stopped.hunter = "Hunter: no credits left this month, or too many lookups at once.";
    else if (res) asked = true;
    if (res?.ok) {
      const pick = hunterPick(await res.json());
      if (!l.website && !data.website && pick.domain) data.website = `https://${pick.domain}/`;
      const emails = await allowed(pick.emails);
      if (emails.length) setEmails(data, [...(data.emails ?? []), ...emails]);
      if (pick.contacts.length) data.contacts = mergeContacts(pick.contacts, data.contacts);
    }
  }
  // Nothing from Hunter: ask the next finders for the named person's work email (Apollo, then Findymail).
  const domain = hostOf(l.website || (data.website as string | undefined) || "");
  const person = (data.contacts ?? []).find((c) => c?.name && c.name.trim().split(/\s+/).length >= 2)?.name ?? "";
  if (!data.email && domain && person) {
    for (const [id, run] of [["apollo", apolloFind], ["findymail", findymailFind]] as const) {
      const k = keys[id];
      if (!k || stopped[id] || data.email) continue;
      const f = await run(k, person, domain).catch(() => ({} as { email?: string; stop?: string }));
      if (f.stop) stopped[id] = f.stop; else asked = true;
      if (f.email && (await allowed([f.email])).length) {
        setEmails(data, [...(data.emails ?? []), f.email]);
        data.contacts = mergeContacts([{ name: person, position: (data.contacts ?? []).find((c) => c.name === person)?.position ?? "", email: f.email }], data.contacts);
        (data as Record<string, unknown>).foundBy = id;
      }
    }
  }
  if (!asked) return { ok: false, why: hasTarget(l, data) ? "stopped" : "no website or name" };
  data.hunterAt = Date.now();
  const cfg = cleanRules(rules);
  applyRules(data, cfg.rules);   // keeps data quality and rule flags up to date (no points since 18 Nov 2026)
  const website = l.website || (data.website as string | undefined) || null;
  return { ok: true, patch: { email: (data.email as string | undefined) || null, website, named: Boolean(data.contacts?.length), data: data as Record<string, unknown> } };
}
