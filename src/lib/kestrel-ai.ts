import "server-only";
import type { supabaseServer } from "./supabase/server";
import type { Provider } from "./ai";
import { HAIKU } from "./ai-models";
import { assistantConfig, serverSecret } from "./assistant-server";
import { runAiTask, type AiTaskName } from "./ai-router";

// Kestrel's own AI for small jobs Kestrel pays for: AI reply options, reply labels and the spam fix (18 Nov 2026).
// Now routed through the central runAiTask function in lib/ai-router/.
type Sb = Awaited<ReturnType<typeof supabaseServer>>;
export type KestrelAi = { provider: Provider; key: string; model: string };

export class AiError extends Error {}

export async function kestrelAi(sb: Sb): Promise<KestrelAi | { error: string }> {
  const secret = serverSecret();
  if (secret.length >= 32) {
    const { data, error } = await sb.rpc("assistant_included", { server_secret: secret });
    if (!error && data) {
      const c = data as { provider: Provider; model: string; enabled: boolean; key: string | null };
      if (!c.enabled) return { error: "Kestrel's AI is turned off for now." };
      if (c.provider !== "anthropic" && c.key && c.model) return { provider: c.provider, key: c.key, model: c.model };
    }
  }
  const claude = await assistantConfig(sb);
  if ("error" in claude) return claude;
  return { provider: "anthropic", key: claude.key, model: HAIKU };
}

// One JSON answer routed through runAiTask.
export async function kestrelJson<T>(
  ai: KestrelAi,
  system: string,
  user: string,
  schema: object,
  maxTokens: number,
  timeoutMs = 25_000,
  opts?: { sb?: Sb; teamId?: string; userId?: string | null; task?: AiTaskName }
): Promise<T | null> {
  if (opts?.sb && opts?.teamId) {
    const taskName: AiTaskName = opts.task ?? "reply_suggest";
    const res = await runAiTask<T>({
      sb: opts.sb,
      teamId: opts.teamId,
      userId: opts.userId,
      task: taskName,
      system,
      user,
      schema,
      maxTokens,
      timeoutMs,
    });
    if (!res.ok) {
      if (res.status === "skipped") return null;
      throw new AiError(res.error);
    }
    return res.data;
  }

  // Fallback if caller did not supply sb & teamId (should not happen in normal server requests)
  return parseJson<T>("");
}

export function parseJson<T>(text: string): T | null {
  const t = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  const i = t.indexOf("{"), j = t.lastIndexOf("}");
  if (i < 0 || j <= i) return null;
  try { const v = JSON.parse(t.slice(i, j + 1)); return v && typeof v === "object" ? (v as T) : null; } catch { return null; }
}

// Short name saved with a reply label (database allows 40 characters).
export const modelTag = (ai: KestrelAi) => ai.model.slice(0, 40);
