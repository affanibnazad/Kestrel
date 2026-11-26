"use client";

// The live Kestrel AI route, called from the chat page with the person's own
// session. There is no log-in page on this route: if the browser already has a
// session, the route uses it silently. If there is no session, or the AI is not
// switched on yet, the answer falls back to the scripted one.

import { supabaseBrowser } from "@/lib/supabase/client";
import { supabaseReady } from "@/lib/supabase/config";
import { readNdjson } from "@/lib/ndjson";
import type { Step } from "@/lib/ai-chat-script";

// One message of the conversation, in the shape the route expects. The assistant
// messages carry the signature the server gave, so the chat can continue.
export type LiveMessage = { role: "user" | "assistant"; content: string; sig?: string };

export type LiveResult =
  | { kind: "live"; text: string; steps: Step[]; thoughts: string[]; ai: string; usage: { used: number; limit: number } | null; sig?: string }
  | { kind: "fallback" }
  | { kind: "error"; error: string };

// What the page hears while the answer is being worked out.
export type LiveListener = {
  // The steps so far. The newest one is still running; the ones before it are done, with how long each took.
  onSteps?: (steps: Step[]) => void;
  // One piece of the model's own thinking, as it arrives.
  onThought?: (text: string) => void;
};

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
        if (ev.t === "step" && typeof ev.text === "string") {
          close(at);
          startedAt.push(at);
          steps.push({ id: `live-${steps.length + 1}`, label: ev.text, state: "running" });
          listen.onSteps?.([...steps]);
        } else if (ev.t === "thought" && typeof ev.text === "string" && ev.text.trim()) {
          thoughts.push(ev.text.trim());
          listen.onThought?.(ev.text.trim());
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

  // A step with no time (an older route) still finishes.
  for (let i = 0; i < steps.length; i++) if (steps[i].state !== "done") steps[i] = { ...steps[i], state: "done" };
  if (failure) return { kind: "error", error: failure };
  // The route filled this in from inside the stream callback.
  const answer = turn as { text?: unknown; messages?: unknown; ai?: unknown; usage?: unknown } | null;
  const text = answer && typeof answer.text === "string" ? answer.text : "";
  if (!text) return { kind: "error", error: "Kestrel AI could not answer just now. Try again." };

  const messages = answer && Array.isArray(answer.messages) ? answer.messages : [];
  const last = messages[messages.length - 1] as { sig?: unknown } | undefined;
  const usage = answer && answer.usage && typeof answer.usage === "object" ? answer.usage as { used?: unknown; limit?: unknown } : null;
  const counted = usage && typeof usage.used === "number" && typeof usage.limit === "number"
    ? { used: usage.used, limit: usage.limit } : null;

  return {
    kind: "live",
    text,
    steps,
    thoughts,
    ai: answer && typeof answer.ai === "string" ? answer.ai : "Kestrel AI",
    usage: counted,
    sig: last && typeof last.sig === "string" ? last.sig : undefined,
  };
}
