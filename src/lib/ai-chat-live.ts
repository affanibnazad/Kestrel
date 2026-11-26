"use client";

// The live Kestrel AI route, called from the chat page with the person's own
// session. There is no log-in page on this route: if the browser already has a
// session, the route uses it silently. If there is no session, or the AI is not
// switched on yet, the answer falls back to the scripted one.

import { supabaseBrowser } from "@/lib/supabase/client";
import { supabaseReady } from "@/lib/supabase/config";
import { readNdjson } from "@/lib/ndjson";
import type { ProposedAction } from "@/lib/assistant";
import type { Step } from "@/lib/ai-chat-script";

// One message of the conversation, in the shape the route expects. The assistant
// messages carry the signature the server gave, so the chat can continue.
export type LiveMessage = { role: "user" | "assistant"; content: string; sig?: string };

export type LiveResult =
  | { kind: "live"; text: string; steps: Step[]; thoughts: string[]; thoughtAt: number[]; ai: string; usage: { used: number; limit: number } | null; sig?: string; actions?: ProposedAction[] }
  | { kind: "fallback" }
  // partial: the answer text that had already been written when it failed (shown above the error).
  | { kind: "error"; error: string; partial?: string; thoughts?: string[]; thoughtAt?: number[] };

// What the page hears while the answer is being worked out.
export type LiveListener = {
  // The steps so far. The newest one is still running; the ones before it are done, with how long each took.
  onSteps?: (steps: Step[]) => void;
  // The model's own thinking so far (one entry per stretch of thinking), as it streams in. thoughtAt[i] is how
  // many steps had started when thoughts[i] began, so the page can show thinking and steps in the order they happened.
  onThinking?: (thoughts: string[], thoughtAt: number[]) => void;
  // The answer written so far, as it streams in.
  onText?: (text: string) => void;
};

// The page is told at most this often while text streams in, so a fast model does not re-draw the chat on every
// token.
const PAINT_MS = 32;

// Ask the route. The listener hears each step and each piece of thinking as it arrives, so the page can show
// the work while it happens.
// (A bare function still works: it hears each new step, as the parked first chat expects.)
export async function liveTurn(history: LiveMessage[], listener: LiveListener | ((s: Step) => void) = {}): Promise<LiveResult> {
  const listen: LiveListener = typeof listener === "function"
    ? { onSteps: (all) => listener(all[all.length - 1]) }
    : listener;
  // No Supabase in this build, or nobody is logged in: keep the scripted answer.
  if (!supabaseReady) return { kind: "fallback" };
  try {
    const { data } = await supabaseBrowser().auth.getSession();
    if (!data.session) return { kind: "fallback" };
  } catch {
    return { kind: "fallback" };
  }

  let res: Response;
  try {
    res = await fetch("/api/assistant", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: history, stream: true }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    return { kind: "error", error: "No connection. Check your internet and try again." };
  }

  // Not signed in, or the AI is not switched on yet: quietly keep the scripted answer.
  if (res.status === 401 || res.status === 503) return { kind: "fallback" };

  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: unknown };
    const message = typeof body?.error === "string" && body.error ? body.error : "Kestrel AI could not answer just now. Try again.";
    return { kind: "error", error: message };
  }

  // The route sends its steps as they happen, then the finished answer.
  const steps: Step[] = [];
  const thoughts: string[] = [];
  const thoughtAt: number[] = [];
  let clientT0 = Date.now();  // the route's "start", on this browser's clock
  let written = "";          // the answer text streamed so far
  let newThought = true;     // the next piece of thinking starts a new entry (after a step or a tool note)
  let paintTimer: ReturnType<typeof setTimeout> | null = null;
  let dirtyThinking = false, dirtyText = false;
  const paint = () => {
    paintTimer = null;
    if (dirtyThinking) { dirtyThinking = false; listen.onThinking?.([...thoughts], [...thoughtAt]); }
    if (dirtyText) { dirtyText = false; listen.onText?.(written); }
  };
  const later = () => { if (!paintTimer) paintTimer = setTimeout(paint, PAINT_MS); };
  const think = (t: string) => {
    if (newThought || !thoughts.length) { thoughts.push(""); thoughtAt.push(steps.length); newThought = false; }
    thoughts[thoughts.length - 1] += t;
    dirtyThinking = true;
    later();
  };
  // When each step started (ms since the question reached the route), so each step can show how long it took.
  const startedAt: number[] = [];
  const close = (until: number) => {
    const last = steps.length - 1;
    if (last < 0 || steps[last].state === "done") return;
    steps[last] = { ...steps[last], state: "done", ms: Math.max(0, until - startedAt[last]) || undefined };
  };
  let turn: { text?: unknown; messages?: unknown; ai?: unknown; usage?: unknown } | null = null;
  let failure = "";
  const contentType = res.headers.get("content-type") ?? "";
  if (/ndjson/.test(contentType) && res.body) {
    // If the stream breaks (the server was stopped, the network dropped, or the 60s limit above hit while
    // reading), this used to throw past the chat, which then stayed on "Thinking" forever.
    try {
      await readNdjson(res.body, (ev) => {
        const at = typeof ev.at === "number" && Number.isFinite(ev.at) ? ev.at : NaN;
        if (ev.t === "start") {
          clientT0 = Date.now() - (Number.isFinite(at) ? at : 0);
        } else if (ev.t === "step" && typeof ev.text === "string") {
          close(at);
          startedAt.push(at);
          steps.push({ id: `live-${steps.length + 1}`, label: ev.text, state: "running" });
          newThought = true;
          listen.onSteps?.([...steps]);
        } else if (ev.t === "step_done") {
          // The step's lookup came back: it is done, with what it found.
          const last = steps.length - 1;
          if (last >= 0 && typeof ev.detail === "string" && ev.detail) steps[last] = { ...steps[last], detail: ev.detail.slice(0, 120) };
          close(at);
          newThought = true;
          listen.onSteps?.([...steps]);
        } else if (ev.t === "think" && typeof ev.text === "string") {
          think(ev.text);
        } else if (ev.t === "text" && typeof ev.text === "string") {
          // The answer has started: the last step is over.
          if (!written) close(Date.now() - clientT0);
          written = written ? written + ev.text : ev.text.replace(/^\s+/, "");
          dirtyText = true;
          later();
        } else if (ev.t === "text_reset") {
          // What was written was a note before a tool call: it moves into the thinking.
          const note = written.trim();
          written = "";
          dirtyText = true;
          if (note) { newThought = true; think(note); }
          newThought = true;
          later();
        } else if (ev.t === "thought" && typeof ev.text === "string" && ev.text.trim()) {
          // An older route sent whole pieces of thinking.
          newThought = true;
          think(ev.text.trim());
          newThought = true;
        } else if (ev.t === "done") {
          close(at);
          turn = ev.turn as typeof turn;
        } else if (ev.t === "error" && typeof ev.error === "string") {
          failure = ev.error;
        }
      });
    } catch {
      // handled just below: no answer and no error means the stream was cut
    }
    // The stream ended (or broke) without an answer or an error line.
    if (!(turn as typeof turn) && !failure) failure = "Kestrel AI stopped before it could answer. Try again.";
  } else {
    const body = await res.json().catch(() => null) as typeof turn;
    if (body && typeof body === "object") turn = body;
  }

  if (paintTimer) { clearTimeout(paintTimer); paint(); }
  const keep = thoughts.map((t, i) => [t.trim(), thoughtAt[i]] as const).filter(([t]) => t);
  const thoughtsOut = keep.map(([t]) => t);
  const thoughtAtOut = keep.map(([, n]) => n);
  // A step with no time (an older route) still finishes.
  for (let i = 0; i < steps.length; i++) if (steps[i].state !== "done") steps[i] = { ...steps[i], state: "done" };
  if (failure) return { kind: "error", error: failure, partial: written.trim() || undefined, thoughts: thoughtsOut, thoughtAt: thoughtAtOut };
  // The route filled this in from inside the stream callback.
  const answer = turn as { text?: unknown; messages?: unknown; ai?: unknown; usage?: unknown; actions?: unknown } | null;
  const text = answer && typeof answer.text === "string" ? answer.text : "";
  if (!text) return { kind: "error", error: "Kestrel AI could not answer just now. Try again." };

  const messages = answer && Array.isArray(answer.messages) ? answer.messages : [];
  const last = messages[messages.length - 1] as { sig?: unknown } | undefined;
  const usage = answer && answer.usage && typeof answer.usage === "object" ? answer.usage as { used?: unknown; limit?: unknown } : null;
  const counted = usage && typeof usage.used === "number" && typeof usage.limit === "number"
    ? { used: usage.used, limit: usage.limit } : null;
  const actions = answer && Array.isArray(answer.actions) ? (answer.actions as ProposedAction[]) : undefined;

  return {
    kind: "live",
    text,
    steps,
    thoughts: thoughtsOut,
    thoughtAt: thoughtAtOut,
    ai: answer && typeof answer.ai === "string" ? answer.ai : "Kestrel AI",
    usage: counted,
    sig: last && typeof last.sig === "string" ? last.sig : undefined,
    ...(actions?.length ? { actions } : {}),
  };
}

/**
 * Executes a `ProposedAction` after the user clicks Confirm in chat.
 * Bulk AI actions (5+ leads) queue via /api/ai/enqueue (AI-4b) with /api/ai fallback.
 */
export async function runProposedAction(a: ProposedAction): Promise<{ ok: boolean; msg: string }> {
  const sb = supabaseBrowser();
  if (a.kind === "score_leads" || a.kind === "write_emails" || a.kind === "find_emails") {
    const ids = a.lead_ids ?? [];
    if (!ids.length) return { ok: false, msg: "No leads selected." };
    const task = a.kind === "score_leads" ? "score" : a.kind === "write_emails" ? "emails" : "find_emails";
    if (ids.length >= 5 || task === "find_emails") {
      const qRes = await fetch("/api/ai/enqueue", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ task, ids, offerId: a.offer_id, ...(a.sequence ? { sequence: a.sequence } : {}) }),
      }).catch(() => null);
      const qOut = qRes ? await qRes.json().catch(() => null) : null;
      if (qRes?.ok && typeof qOut?.queued === "number" && qOut.queued > 0) {
        return { ok: true, msg: `Queued ${qOut.queued} leads in background — watch live progress in Lead Brain.` };
      }
      if (qRes && qRes.status !== 404 && qRes.status !== 501 && !qOut?.fallback) {
        return { ok: false, msg: qOut?.error || "Could not queue leads." };
      }
      if (task === "find_emails") {
        return { ok: false, msg: "Run Find emails from the Leads page." };
      }
    }
    let done = 0;
    for (let i = 0; i < ids.length; i += 4) {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ task, ids: ids.slice(i, i + 4), offerId: a.offer_id || "current", ...(a.sequence ? { sequence: a.sequence } : {}) }),
      }).catch(() => null);
      const out = res ? await res.json().catch(() => null) : null;
      if (!res?.ok || out?.error) return { ok: false, msg: out?.error || `Done ${done} of ${ids.length} before error.` };
      done += Array.isArray(out?.done) ? out.done.length : 0;
    }
    return { ok: true, msg: `Done for ${done} lead${done === 1 ? "" : "s"}.` };
  }

  if (a.kind === "pause_campaign" || a.kind === "resume_campaign") {
    if (!a.campaign_id) return { ok: false, msg: "Missing campaign id." };
    const paused = a.kind === "pause_campaign";
    const { error } = await sb.rpc("pause_campaign", { campaign: a.campaign_id, paused });
    return error ? { ok: false, msg: error.message } : { ok: true, msg: paused ? "Campaign paused." : "Campaign resumed." };
  }

  if (a.kind === "stop_campaign") {
    if (!a.campaign_id) return { ok: false, msg: "Missing campaign id." };
    const { error } = await sb.rpc("stop_campaign", { campaign: a.campaign_id });
    return error ? { ok: false, msg: error.message } : { ok: true, msg: "Campaign stopped." };
  }

  if (a.kind === "set_lead_fit" && a.lead_ids?.length && a.verdict) {
    const { error } = await sb.from("leads").update({ verdict: a.verdict }).in("id", a.lead_ids);
    return error ? { ok: false, msg: error.message } : { ok: true, msg: `Updated ${a.lead_ids.length} leads.` };
  }

  if (a.kind === "set_lead_keep" && a.lead_ids?.length && a.keep) {
    const { error } = await sb.from("leads").update({ status: a.keep }).in("id", a.lead_ids);
    return error ? { ok: false, msg: error.message } : { ok: true, msg: `Updated ${a.lead_ids.length} leads.` };
  }

  if (a.kind === "mark_reply_done" && a.conversation_id) {
    const { error } = await sb.from("mail_replies").update({ handled: true }).eq("campaign_lead_id", a.conversation_id);
    return error ? { ok: false, msg: error.message } : { ok: true, msg: "Marked as done." };
  }

  if (a.kind === "set_lead_status" && a.conversation_id) {
    const { error } = await sb.rpc("set_lead_stage", { cl: a.conversation_id, stage: a.stage ?? null });
    return error ? { ok: false, msg: error.message } : { ok: true, msg: "Updated reply status." };
  }

  return { ok: false, msg: "Open the linked page to complete this action." };
}
