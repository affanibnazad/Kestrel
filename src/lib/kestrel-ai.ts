import "server-only";
import type { supabaseServer } from "./supabase/server";
import type { Provider } from "./ai";
import { HAIKU } from "./ai-models";
import { AiError, ask } from "./ai-server";
import { assistantConfig, serverSecret } from "./assistant-server";

// Kestrel's own AI for small jobs Kestrel pays for: AI reply options, reply labels and the spam fix (18 Nov 2026).
// It is the AI chosen in Owner → Assistant: when that is NVIDIA (or ChatGPT, Gemini, OpenRouter, Groq) with Kestrel's
// key, these jobs use it with the chosen model; otherwise Claude Haiku 5.5 on Kestrel's Claude key, as before.
// Keys come from Vault through the server secret and never reach a browser.
type Sb = Awaited<ReturnType<typeof supabaseServer>>;
export type KestrelAi = { provider: Provider; key: string; model: string };

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

// One JSON answer. Claude gets the schema enforced; the OpenAI-format companies get it written into the instructions
// (JSON mode), and the answer is read from its first "{" to its last "}". Returns null when the AI declined, was cut
// off or sent something that is not JSON; throws AiError when it could not be reached.
export async function kestrelJson<T>(ai: KestrelAi, system: string, user: string, schema: object, maxTokens: number, timeoutMs = 25_000): Promise<T | null> {
  const sys = ai.provider === "anthropic" ? system : `${system}\n\nReply with one JSON object that matches this JSON schema, and nothing else:\n${JSON.stringify(schema)}`;
  const a = await ask(ai.provider, ai.key, ai.model, sys, user, schema, maxTokens, ai.provider === "anthropic" ? "low" : undefined, { timeoutMs, retries: 1 });
  if (a.skip) return null;
  return parseJson<T>(a.text);
}

export function parseJson<T>(text: string): T | null {
  const t = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  const i = t.indexOf("{"), j = t.lastIndexOf("}");
  if (i < 0 || j <= i) return null;
  try { const v = JSON.parse(t.slice(i, j + 1)); return v && typeof v === "object" ? (v as T) : null; } catch { return null; }
}

// Short name saved with a reply label (database allows 40 characters).
export const modelTag = (ai: KestrelAi) => ai.model.slice(0, 40);
export { AiError };
