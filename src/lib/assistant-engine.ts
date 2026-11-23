import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { geminiSchema } from "./ai-server";
import { hasFallback } from "./ai-models";
import { CHAT_BASE, type Provider } from "./ai";

// The Kestrel Assistant's tool loop on any AI company: Claude (official Anthropic SDK), ChatGPT and OpenRouter
// (OpenAI-style chat completions), and Gemini (function calling). The same tools, the same instructions; only the
// wire format differs. The chat history between turns is plain text, so a person can switch AI in the middle of a chat.
export type ChatMsg = { role: "user" | "assistant"; content: string };
export type NeutralTool = { name: string; description: string; schema: Record<string, unknown> };
export type EngineInput = {
  provider: Provider; key: string; model: string; effort?: "low" | "medium" | "high";
  system: string; history: ChatMsg[]; tools: NeutralTool[];
  runTool: (name: string, input: Record<string, unknown>) => Promise<string>;
  maxRounds: number;
  // Pictures the person dropped or pasted with this question (Phase 3D), added to the last user message only.
  images?: { type: string; data: string }[];
};
const lastUser = (h: ChatMsg[]) => h.map((m) => m.role).lastIndexOf("user");
export type EngineResult = { text: string; refused?: boolean; outOfRounds?: boolean };
// Vercel stops the request at 60 s: no new round starts after 48 s, and each call has its own shorter timeout.
const BUDGET_MS = 48_000;
const timeLeft = (start: number) => BUDGET_MS - (Date.now() - start);
export class EngineError extends Error { constructor(message: string, public kind: "key" | "rate" | "model" | "network" | "other") { super(message); } }

const NAMES: Record<Provider, string> = { anthropic: "Claude", openai: "ChatGPT", gemini: "Gemini", openrouter: "OpenRouter", groq: "Groq", nvidia: "NVIDIA" };
const parse = (s: unknown) => { try { const v = typeof s === "string" ? JSON.parse(s || "{}") : s; return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {}; } catch { return {}; } };

export async function runAssistant(x: EngineInput): Promise<EngineResult> {
  x = { ...x, start: Date.now() } as EngineInput & { start: number };
  if (x.provider === "anthropic") return claude(x);
  if (x.provider === "gemini") return gemini(x);
  return openaiStyle(x);
}

// ---- Claude: the official SDK, prompt caching, server-side refusal fallback for Opus and Sonnet.
async function claude(x: EngineInput): Promise<EngineResult> {
  const start = (x as EngineInput & { start: number }).start;
  const client = new Anthropic({ apiKey: x.key, maxRetries: 1, timeout: 40_000 });
  const tools = x.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.schema as Anthropic.Beta.BetaTool.InputSchema }));
  const li = lastUser(x.history);
  const messages: Anthropic.Beta.BetaMessageParam[] = x.history.map((m, i) => (i === li && x.images?.length
    ? { role: m.role, content: [...x.images.map((im) => ({ type: "image" as const, source: { type: "base64" as const, media_type: im.type as "image/png" | "image/jpeg" | "image/webp" | "image/gif", data: im.data } })), { type: "text" as const, text: m.content }] }
    : { role: m.role, content: m.content }));
  try {
    for (let round = 0; round < x.maxRounds; round++) {
      if (round > 0 && timeLeft(start) < 12_000) return { text: "", outOfRounds: true };
      const res = await client.beta.messages.create({
        model: x.model, max_tokens: 16000, system: x.system, tools, messages,
        output_config: { effort: x.effort ?? "low" }, cache_control: { type: "ephemeral" },
        ...(hasFallback(x.model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      });
      messages.push({ role: "assistant", content: res.content });
      if (res.stop_reason === "refusal") return { text: "", refused: true };
      const calls = res.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      if (res.stop_reason !== "tool_use" || !calls.length) return { text: textOf(res.content) };
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const c of calls) results.push({ type: "tool_result", tool_use_id: c.id, content: await safeRun(x, c.name, parse(c.input)) });
      messages.push({ role: "user", content: results });
    }
    return { text: "", outOfRounds: true };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) throw new EngineError("The Claude key was not accepted.", "key");
    if (e instanceof Anthropic.RateLimitError) throw new EngineError("Claude is busy or the credit is used up. Try again in a minute.", "rate");
    if (e instanceof Anthropic.NotFoundError || e instanceof Anthropic.BadRequestError) throw new EngineError(`Claude could not use the model "${x.model}".`, "model");
    if (e instanceof Anthropic.APIConnectionError) throw new EngineError("No connection to Claude. Try again.", "network");
    throw new EngineError("Claude could not answer just now. Try again.", "other");
  }
}
const textOf = (blocks: Anthropic.Beta.BetaContentBlock[]) => blocks.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("\n\n").trim();

// A tool that fails tells the model so; it never stops the whole answer.
async function safeRun(x: EngineInput, name: string, input: Record<string, unknown>) {
  try { return await x.runTool(name, input); } catch { return JSON.stringify({ error: "That lookup failed." }); }
}

// One HTTP call with the usual retries and plain-English errors (ChatGPT, OpenRouter, Gemini have no SDK here).
async function call(provider: Provider, url: string, headers: Record<string, string>, body: unknown) {
  const name = NAMES[provider];
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    const startMs = Date.now();
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(attempt ? 15_000 : 30_000),
      });
    } catch (err: unknown) {
      const elapsed = Date.now() - startMs;
      const errorObj = err instanceof Error ? {
        name: err.name,
        message: err.message,
        cause: err.cause instanceof Error ? `${err.cause.name}: ${err.cause.message}` : err.cause ? String(err.cause) : undefined,
      } : { name: "UnknownError", message: String(err) };
      console.error(`[assistant-engine] ${name} call error (attempt ${attempt + 1}, ${elapsed}ms):`, {
        errorName: errorObj.name,
        message: errorObj.message,
        cause: errorObj.cause,
        elapsedMs: elapsed,
      });
      if (attempt >= 1) throw new EngineError(`No connection to ${name}. Try again.`, "network");
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
      continue;
    }
    const elapsed = Date.now() - startMs;
    if (res.ok) return res.json();
    const detail = await res.json().catch(() => ({}));
    const msg = String((detail?.error && (detail.error.message || detail.error)) || detail?.detail || detail?.title || "");
    console.error(`[assistant-engine] ${name} HTTP ${res.status} (attempt ${attempt + 1}, ${elapsed}ms):`, {
      status: res.status,
      error: msg,
      elapsedMs: elapsed,
    });
    if ([429, 500, 502, 503].includes(res.status) && attempt < 1) {
      await new Promise((r) => setTimeout(r, (Number(res.headers.get("retry-after")) || attempt + 1) * 1000));
      continue;
    }
    if (res.status === 401 || res.status === 403 || /API_KEY_INVALID|invalid api key|incorrect api key/i.test(msg)) throw new EngineError(`The ${name} key was not accepted.`, "key");
    if (res.status === 429) throw new EngineError(`${name} is busy or the credit is used up. Try again later.`, "rate");
    if (res.status === 404 || /model/i.test(msg)) throw new EngineError(`${name} could not use the model "${String((body as { model?: string }).model ?? "")}".`, "model");
    throw new EngineError(`${name} could not answer just now (${res.status}).`, "other");
  }
}

// ---- ChatGPT, OpenRouter, Groq and NVIDIA: chat completions with function tools (the same OpenAI format).
type OaPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
type OaMsg = { role: "system" | "user" | "assistant" | "tool"; content: string | OaPart[] | null; tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[]; tool_call_id?: string };
async function openaiStyle(x: EngineInput): Promise<EngineResult> {
  const url = `${CHAT_BASE[x.provider] ?? CHAT_BASE.openai}/chat/completions`;
  const headers: Record<string, string> = { authorization: `Bearer ${x.key}`, ...(x.provider === "openrouter" ? { "x-title": "Kestrel" } : {}) };
  const tools = x.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.schema } }));
  const li = lastUser(x.history);
  const messages: OaMsg[] = [{ role: "system", content: x.system }, ...x.history.map((m, i): OaMsg => (i === li && x.images?.length
    ? { role: m.role, content: [{ type: "text", text: m.content }, ...x.images.map((im): OaPart => ({ type: "image_url", image_url: { url: `data:${im.type};base64,${im.data}` } }))] }
    : { role: m.role, content: m.content }))];
  const start = (x as EngineInput & { start: number }).start;
  for (let round = 0; round < x.maxRounds; round++) {
    if (round > 0 && timeLeft(start) < 12_000) return { text: "", outOfRounds: true };
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const d: any = await call(x.provider, url, headers, { model: x.model, messages, tools, tool_choice: "auto", ...(x.provider === "nvidia" ? { reasoning_effort: "low" } : {}) });
    const msg = d?.choices?.[0]?.message;
    if (!msg) return { text: "" };
    if (msg.refusal) return { text: "", refused: true };
    const calls = (msg.tool_calls ?? []).filter((c: any) => c?.type === "function" && c.function?.name);
    /* eslint-enable @typescript-eslint/no-explicit-any */
    if (!calls.length) return { text: String(msg.content ?? "").trim() };
    messages.push({ role: "assistant", content: msg.content ?? null, tool_calls: calls });
    for (const c of calls) messages.push({ role: "tool", tool_call_id: c.id, content: await safeRun(x, c.function.name, parse(c.function.arguments)) });
  }
  return { text: "", outOfRounds: true };
}

// ---- Gemini: function declarations and function responses.
type GPart = { inline_data?: { mime_type: string; data: string }; text?: string; functionCall?: { name: string; args?: Record<string, unknown> }; functionResponse?: { name: string; response: Record<string, unknown> } };
async function gemini(x: EngineInput): Promise<EngineResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(x.model)}:generateContent`;
  const tools = [{ functionDeclarations: x.tools.map((t) => ({ name: t.name, description: t.description, parameters: geminiSchema(t.schema) })) }];
  const li = lastUser(x.history);
  const contents: { role: "user" | "model"; parts: GPart[] }[] = x.history.map((m, i) => ({ role: m.role === "assistant" ? "model" : "user",
    parts: i === li && x.images?.length ? [...x.images.map((im) => ({ inline_data: { mime_type: im.type, data: im.data } })), { text: m.content }] : [{ text: m.content }] }));
  const start = (x as EngineInput & { start: number }).start;
  for (let round = 0; round < x.maxRounds; round++) {
    if (round > 0 && timeLeft(start) < 12_000) return { text: "", outOfRounds: true };
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    const d: any = await call("gemini", url, { "x-goog-api-key": x.key }, { systemInstruction: { parts: [{ text: x.system }] }, contents, tools });
    const c = d?.candidates?.[0];
    if (!c) return { text: "" };
    if (["SAFETY", "RECITATION", "PROHIBITED_CONTENT"].includes(c.finishReason)) return { text: "", refused: true };
    const parts: GPart[] = c.content?.parts ?? [];
    const calls = parts.filter((p) => p.functionCall?.name);
    if (!calls.length) return { text: parts.map((p) => p.text ?? "").join("").trim() };
    contents.push({ role: "model", parts });
    const out: GPart[] = [];
    for (const p of calls) {
      const raw = await safeRun(x, p.functionCall!.name, parse(p.functionCall!.args ?? {}));
      out.push({ functionResponse: { name: p.functionCall!.name, response: { result: parse(raw) } } });
    }
    contents.push({ role: "user", parts: out });
  }
  return { text: "", outOfRounds: true };
}
