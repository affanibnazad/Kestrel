import "server-only";
import { CHAT_BASE, FIT_SCHEMA, PROVIDERS, type Provider } from "./ai";

// One call to an AI company from the App's server. The team key is used here and never sent to the browser.
// Same requests as the extension (core/ai.js, core/writer.js), minus the browser-only header.
export class AiError extends Error {}

type Usage = { input_tokens: number; output_tokens: number; cost?: number };
type Answer = { text: string; usage: Usage; skip?: string };

export const geminiSchema = (s: unknown): unknown => {
  if (Array.isArray(s)) return s.map(geminiSchema);
  if (!s || typeof s !== "object") return s;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s as Record<string, unknown>)) {
    if (k === "additionalProperties") continue;
    out[k] = k === "type" ? String(v).toUpperCase() : k === "properties" ? Object.fromEntries(Object.entries(v as object).map(([pk, pv]) => [pk, geminiSchema(pv)])) : geminiSchema(v);
  }
  return out;
};

// opts: a shorter wait and fewer retries for jobs inside a page request (reply options, labels, spam fix).
export async function ask(provider: Provider, key: string, model: string, system: string, user: string, schema: object, maxTokens: number, effort?: "low" | "medium" | "high",
  opts: { timeoutMs?: number; retries?: number } = {}): Promise<Answer> {
  const timeoutMs = opts.timeoutMs ?? 45_000, retries = opts.retries ?? 2;
  const name = PROVIDERS[provider].label;
  let url: string, body: Record<string, unknown>;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (provider === "anthropic") {
    url = "https://api.anthropic.com/v1/messages";
    Object.assign(headers, { "x-api-key": key, "anthropic-version": "2026-10-21" });
    body = { model, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }],
      output_config: { ...(effort ? { effort } : schema === FIT_SCHEMA ? { effort: "low" } : {}), format: { type: "json_schema", schema } } };
    if (model !== "claude-haiku-5-5" && /^claude-(opus|sonnet)/.test(model)) { headers["anthropic-beta"] = "server-side-fallback-2026-07-01"; body.fallbacks = "default"; }
  } else if (provider === "gemini") {
    url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    headers["x-goog-api-key"] = key;
    body = { systemInstruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { responseMimeType: "application/json", responseSchema: geminiSchema(schema) } };
  } else {
    url = `${CHAT_BASE[provider]}/chat/completions`;
    headers.authorization = `Bearer ${key}`;
    if (provider === "openrouter") headers["x-title"] = "Kestrel";
    body = { model, messages: [{ role: "system", content: `${system}\n\nAnswer with JSON only.` }, { role: "user", content: user }], response_format: { type: "json_object" } };
    // NVIDIA's Nemotron models think before answering unless told not to; short JSON jobs don't need it (faster, cheaper).
    if (provider === "nvidia") Object.assign(body, { reasoning_effort: "none", max_tokens: maxTokens });
  }

  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try { res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) }); }
    catch { if (attempt >= retries) throw new AiError(`Network problem reaching ${name}.`); await wait(1000 * 2 ** attempt); continue; }
    if (res.ok) return read(provider, await res.json());
    const detail = await res.json().catch(() => ({}));
    const message = String((detail?.error && (detail.error.message || detail.error)) || "");
    if ([429, 500, 502, 503, 529].includes(res.status) && attempt < retries) { await wait((Number(res.headers.get("retry-after")) || 2 ** attempt) * 1000); continue; }
    if (res.status === 401 || /API_KEY_INVALID|invalid api key/i.test(message)) throw new AiError(`The team's ${name} key was not accepted. Change it in Connections.`);
    if (res.status === 403) throw new AiError(`The team's ${name} key isn't allowed to use that model.`);
    if (res.status === 404) throw new AiError("That model was not found. Check the model name.");
    if (res.status === 429) throw new AiError("Rate limit or spending limit reached. Try again later.");
    throw new AiError(message.slice(0, 200) || `${name} returned an error (${res.status}).`);
  }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* eslint-disable @typescript-eslint/no-explicit-any */
function read(provider: Provider, d: any): Answer {
  if (provider === "anthropic") {
    const usage = { input_tokens: d.usage?.input_tokens || 0, output_tokens: d.usage?.output_tokens || 0 };
    if (d.stop_reason === "refusal") return { text: "", usage, skip: "declined" };
    if (d.stop_reason === "max_tokens") return { text: "", usage, skip: "cut off" };
    return { text: (d.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join(""), usage };
  }
  if (provider === "gemini") {
    const c = (d.candidates || [])[0], u = d.usageMetadata || {};
    const usage = { input_tokens: u.promptTokenCount || 0, output_tokens: u.candidatesTokenCount || 0 };
    if (!c) return { text: "", usage, skip: "no answer" };
    if (c.finishReason === "MAX_TOKENS") return { text: "", usage, skip: "cut off" };
    if (["SAFETY", "RECITATION", "PROHIBITED_CONTENT"].includes(c.finishReason)) return { text: "", usage, skip: "declined" };
    return { text: (c.content?.parts || []).map((p: any) => p.text || "").join(""), usage };
  }
  const c = (d.choices || [])[0], u = d.usage || {};
  const usage = { input_tokens: u.prompt_tokens || 0, output_tokens: u.completion_tokens || 0, cost: Number.isFinite(u.cost) ? u.cost : undefined };
  if (!c) return { text: "", usage, skip: "no answer" };
  if (c.message?.refusal) return { text: "", usage, skip: "declined" };
  if (c.finish_reason === "length") return { text: "", usage, skip: "cut off" };
  return { text: c.message?.content || "", usage };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// Cost in dollars, or null when this model's price is not known.
export function costOf(usage: Usage, provider: Provider, model: string) {
  if (Number.isFinite(usage.cost)) return usage.cost as number;
  const m = PROVIDERS[provider].models.find((x) => x.id === model);
  return m && m.input !== null && m.output !== null ? (usage.input_tokens * m.input + usage.output_tokens * m.output) / 1e6 : null;
}
