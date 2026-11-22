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
  | { kind: "live"; text: string; steps: Step[]; ai: string; usage: { used: number; limit: number } | null; sig?: string }
  | { kind: "fallback" }
  | { kind: "error"; error: string };

const step = (i: number, label: string): Step => ({ id: `live-${i}`, label, state: "done" });

// Ask the route. onStep is called as each step arrives, so the page can show the
// work while it happens.
export async function liveTurn(history: LiveMessage[], onStep?: (s: Step) => void): Promise<LiveResult> {
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
  let turn: { text?: unknown; messages?: unknown; ai?: unknown; usage?: unknown } | null = null;
  let failure = "";
  const contentType = res.headers.get("content-type") ?? "";
  if (/ndjson/.test(contentType) && res.body) {
    await readNdjson(res.body, (ev) => {
      if (ev.t === "step" && typeof ev.text === "string") {
        const s = step(steps.length + 1, ev.text);
        steps.push(s);
        onStep?.(s);
      } else if (ev.t === "done") {
        turn = ev.turn as typeof turn;
      } else if (ev.t === "error" && typeof ev.error === "string") {
        failure = ev.error;
      }
    });
  } else {
    const body = await res.json().catch(() => null) as typeof turn;
    if (body && typeof body === "object") turn = body;
  }

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
    ai: answer && typeof answer.ai === "string" ? answer.ai : "Kestrel AI",
    usage: counted,
    sig: last && typeof last.sig === "string" ? last.sig : undefined,
  };
}
