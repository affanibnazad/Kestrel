import "server-only";
import type { supabaseServer } from "./supabase/server";
import type { Provider } from "./ai";
import { AUTO, assistantModel } from "./ai-models";

// The Kestrel Assistant's settings for the App's server: Kestrel's Claude key, model and on/off switch, set by a
// Kestrel admin in the Owner panel (database 023, encrypted in Supabase Vault). Read with the server secret, so only
// the server can get the key. ANTHROPIC_API_KEY on Vercel is used only when no key is saved in the Owner panel.
type Sb = Awaited<ReturnType<typeof supabaseServer>>;
export type AssistantConfig = { key: string; model: string; enabled: boolean };
export const ASSISTANT_MODELS = [
  ["auto", "Auto: Sonnet 5.5 for normal questions, Opus 5.5 for big tasks"],
  ["claude-opus-5-5", "Claude Opus 5.5 (best answers)"],
  ["claude-sonnet-5-5", "Claude Sonnet 5.5 (balanced)"],
  ["claude-haiku-5-5", "Claude Haiku 5.5 (cheapest)"],
] as const;

export const serverSecret = () => process.env.MAIL_SERVER_SECRET || "";
// What people see for Kestrel's included AI, whichever company runs it: each model's Kestrel name from Owner → Assistant
// (database 057), or this when none is set. The Owner panel still shows the real company and model. A team's own key
// keeps its company's name.
export const KESTREL_AI_NAME = "Kestrel AI";

export async function assistantConfig(sb: Sb): Promise<AssistantConfig | { error: string }> {
  const secret = serverSecret();
  if (secret.length >= 32) {
    const { data, error } = await sb.rpc("assistant_config", { server_secret: secret });
    if (!error && data) {
      const c = data as { key: string | null; model: string; enabled: boolean };
      if (!c.enabled) return { error: "Kestrel AI is turned off for now. Try again later." };
      if (c.key) return { key: c.key, model: c.model, enabled: true };
    }
  }
  const env = process.env.ANTHROPIC_API_KEY;
  if (env) return { key: env, model: "auto", enabled: true };
  return { error: "Kestrel AI is not switched on yet. The Kestrel owner adds its Claude key in the Owner panel." };
}

// ---- Any AI (database 027): which company, model and key answer this person's question.
// "included" = Kestrel's own AI (Kestrel pays; counts against the team's daily messages).
// "team" = the person chose their team's own key from Connections (the team pays; no daily limit from Kestrel).
export type Resolved = {
  provider: string;
  baseUrl?: string | null;
  key: string;
  model: string;
  effort: "low" | "medium" | "high";
  included: boolean;
  label: string;
  slot?: "swift" | "talon" | "nest";
};
export type Prefs = { source: "included" | "team"; provider: Provider | null; model: string | null; about: string; style: string };
const COMPANY: Record<Provider, string> = { anthropic: "Claude", openai: "ChatGPT", gemini: "Gemini", openrouter: "OpenRouter", groq: "Groq", nvidia: "NVIDIA" };

export async function resolveAssistant(sb: Sb, prefs: Prefs | null, question: string, turns: number): Promise<Resolved | { error: string }> {
  const secret = serverSecret();
  if (prefs?.source === "team" && prefs.provider) {
    if (secret.length < 32) return { error: "The server secret is missing on Vercel (MAIL_SERVER_SECRET)." };
    const { data, error } = await sb.rpc("assistant_team_key", { server_secret: secret, service: prefs.provider });
    if (error) return { error: /plan has ended/.test(error.message) ? "Your plan has ended, so your team key can't be used here. Switch to Kestrel's own AI in Kestrel AI → Personalize." : "Your role can't use the team's AI keys. Switch to Kestrel's own AI in Kestrel AI → Personalize." };
    if (!data) return { error: `Your team has no ${COMPANY[prefs.provider]} key yet. Add it in Connections, or switch to Kestrel's AI in Kestrel AI → Personalize.` };
    if (prefs.provider === "anthropic") { const p = assistantModel(prefs.model || AUTO, question, turns); return { provider: "anthropic", key: data as string, ...p, included: false, label: `Claude (your team's key)` }; }
    if (!prefs.model) return { error: `Choose a ${COMPANY[prefs.provider]} model in Kestrel AI → Personalize.` };
    return { provider: prefs.provider, key: data as string, model: prefs.model, effort: "low", included: false, label: `${COMPANY[prefs.provider]} (your team's key)` };
  }
  // Kestrel's included AI: try Talon slot from ai_slots first, then fall back to assistant_included (safe rollout).
  if (secret.length >= 32) {
    try {
      const { data: slotData, error: slotErr } = await sb.rpc("ai_slot_for_server", { server_secret: secret, p_slot: "talon" });
      if (!slotErr && slotData) {
        const s = slotData as { provider?: string; base_url?: string | null; model?: string; key?: string | null; enabled?: boolean };
        if (s.enabled === false) return { error: "Kestrel AI is turned off for now. Try again later." };
        if (s.provider && s.model && s.key) {
          return {
            provider: s.provider,
            baseUrl: s.base_url ?? null,
            key: s.key,
            model: s.model,
            effort: "medium",
            included: true,
            label: KESTREL_AI_NAME,
            slot: "talon",
          };
        }
      }
    } catch {
      // 077 not applied yet -> fall back to assistant_included
    }
    const { data, error } = await sb.rpc("assistant_included", { server_secret: secret });
    if (!error && data) {
      const c = data as { provider: Provider; model: string; enabled: boolean; key: string | null; name?: string | null };
      const label = KESTREL_AI_NAME;
      if (!c.enabled) return { error: "Kestrel AI is turned off for now. Try again later." };
      if (!c.key && c.provider !== "anthropic") return { error: "Kestrel AI is not switched on yet. The Kestrel owner adds its AI key in the Owner panel." };
      // Claude without a saved key: fall through to the older path, which can use ANTHROPIC_API_KEY on Vercel.
      if (c.provider === "anthropic" && c.key) return { provider: "anthropic", key: c.key, ...assistantModel(c.model, question, turns), included: true, label };
      if (c.provider !== "anthropic" && c.key) return { provider: c.provider, key: c.key, model: c.model, effort: "low", included: true, label };
    }
  }
  const old = await assistantConfig(sb);
  if ("error" in old) return old;
  return { provider: "anthropic", key: old.key, ...assistantModel(old.model, question, turns), included: true, label: KESTREL_AI_NAME };
}
