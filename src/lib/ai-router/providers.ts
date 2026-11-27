import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { CHAT_BASE, type Provider, PROVIDERS } from "../ai";
import { hasFallback } from "../ai-models";
import { presetBaseUrl } from "../ai-slots";

export class ProviderCallError extends Error {
  constructor(
    message: string,
    public status?: number,
    public isTimeout: boolean = false,
    public isNetwork: boolean = false,
    public retryAfterMs?: number
  ) {
    super(message);
  }
}

export function parseResetHeader(val: string | null | undefined): number | null {
  if (!val) return null;
  val = val.trim();
  // Case: "960ms" or "100 ms"
  const msMatch = val.match(/^([\d.]+)\s*ms$/i);
  if (msMatch) return Math.round(parseFloat(msMatch[1]));
  // Case: pure seconds e.g. "6.975s" or "5s"
  const secMatch = val.match(/^([\d.]+)\s*s$/i);
  if (secMatch) return Math.round(parseFloat(secMatch[1]) * 1000);
  // Case: compound minutes and seconds e.g. "25m55.199s" or "25m"
  const compoundMatch = val.match(/^(?:(\d+)m)?(?:\s*([\d.]+)s)?$/i);
  if (compoundMatch && (compoundMatch[1] || compoundMatch[2])) {
    let ms = 0;
    if (compoundMatch[1]) ms += parseInt(compoundMatch[1], 10) * 60 * 1000;
    if (compoundMatch[2]) ms += Math.round(parseFloat(compoundMatch[2]) * 1000);
    return ms;
  }
  // Case: standard numeric seconds e.g. "5" (standard HTTP Retry-After)
  if (/^\d+$/.test(val)) return parseInt(val, 10) * 1000;
  return null;
}

export type ProviderUsage = {
  input_tokens: number;
  output_tokens: number;
  cost?: number;
};

export type ProviderAnswer = {
  text: string;
  usage: ProviderUsage;
  skip?: string;
};

export type ProviderCallParams = {
  provider: string;
  baseUrl?: string | null;
  key: string;
  model: string;
  system: string;
  user: string;
  schema?: object;
  maxTokens: number;
  effort?: "low" | "medium" | "high";
  timeoutMs: number;
  /** Absolute time (ms) by which the whole call, including every tool round, must end. */
  deadlineAt?: number;
  /** Absolute time (ms) by which the FIRST model call must answer (so a dead slot fails over fast). */
  firstCallDeadlineAt?: number;
  // Optional assistant / chat parameters
  history?: { role: "user" | "assistant"; content: string }[];
  tools?: { name: string; description: string; schema: Record<string, unknown> }[];
  runTool?: (name: string, input: Record<string, unknown>) => Promise<string>;
  images?: { type: string; data: string }[];
  /** Chat only: stream the answer as the model writes it. When set, the tool loop asks the provider for a
   *  stream and passes on each piece the moment it arrives: `thinking` (the model's reasoning), `text` (answer
   *  text) and `textReset` (the text written this round was a note before a tool call, not the answer). */
  onStream?: StreamSink;
};

export type StreamSink = {
  thinking: (text: string) => void;
  text: (text: string) => void;
  textReset: () => void;
};

// Calls a stream listener without ever letting it break the answer.
function safe(fn: () => void) {
  try { fn(); } catch { /* the listener must never break the answer */ }
}

// Splits streamed text into answer text and <think>…</think> reasoning (models such as MiniMax and DeepSeek write
// their reasoning inline). Tags may arrive split across chunks, so a possible partial tag is held back.
export function thinkSplitter(onText: (t: string) => void, onThink: (t: string) => void) {
  let inThink = false;
  let buf = "";
  const out = (t: string) => { if (t) (inThink ? onThink : onText)(t); };
  return {
    push(chunk: string) {
      buf += chunk;
      for (;;) {
        const tag = inThink ? "</think>" : "<think>";
        const i = buf.indexOf(tag);
        if (i >= 0) {
          out(buf.slice(0, i));
          buf = buf.slice(i + tag.length);
          inThink = !inThink;
          continue;
        }
        let keep = 0;
        for (let k = Math.min(tag.length - 1, buf.length); k > 0; k--) {
          if (tag.startsWith(buf.slice(-k))) { keep = k; break; }
        }
        out(buf.slice(0, buf.length - keep));
        buf = buf.slice(buf.length - keep);
        return;
      }
    },
    flush() { out(buf); buf = ""; },
  };
}

// A timer that aborts one streamed model call. Until the first piece arrives it allows the normal per-call limit
// (so a dead slot still hands over to Nest fast); once the model is writing, it may write until the deadline.
function streamTimer(params: ProviderCallParams, round: number) {
  const ctl = new AbortController();
  let timer = setTimeout(() => ctl.abort(), callTimeout(params, round));
  let started = false;
  return {
    signal: ctl.signal,
    abort: () => ctl.abort(),
    started: () => started,
    firstPiece() {
      if (started) return;
      started = true;
      clearTimeout(timer);
      const until = params.deadlineAt ?? Date.now() + params.timeoutMs;
      timer = setTimeout(() => ctl.abort(), Math.max(500, until - Date.now()));
    },
    stop() { clearTimeout(timer); },
  };
}

export const geminiSchema = (s: unknown): unknown => {
  if (Array.isArray(s)) return s.map(geminiSchema);
  if (!s || typeof s !== "object") return s;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s as Record<string, unknown>)) {
    if (k === "additionalProperties") continue;
    out[k] =
      k === "type"
        ? String(v).toUpperCase()
        : k === "properties"
        ? Object.fromEntries(
            Object.entries(v as object).map(([pk, pv]) => [pk, geminiSchema(pv)])
          )
        : geminiSchema(v);
  }
  return out;
};

// Cost calculation moved here from ai-server.ts
export function costOf(usage: ProviderUsage, provider: string, model: string): number | null {
  if (Number.isFinite(usage.cost)) return usage.cost as number;
  const m = PROVIDERS[provider as Provider]?.models?.find((x) => x.id === model);
  return m && m.input !== null && m.output !== null
    ? (usage.input_tokens * m.input + usage.output_tokens * m.output) / 1e6
    : null;
}

// Timeout for one model call: the per-call limit, cut down to what is left before the deadline.
// round 0 is the first call of a tool loop (or the only call).
export function callTimeout(params: ProviderCallParams, round: number): number {
  let t = params.timeoutMs;
  const dl = [params.deadlineAt, round === 0 ? params.firstCallDeadlineAt : undefined].filter(
    (x): x is number => typeof x === "number"
  );
  if (dl.length) t = Math.min(t, Math.min(...dl) - Date.now());
  if (t < 500) throw new ProviderCallError(`${params.provider} timeout: no time left for another call`, undefined, true);
  return Math.round(t);
}

export async function callProvider(params: ProviderCallParams): Promise<ProviderAnswer> {
  const { provider } = params;
  if (provider === "anthropic") {
    return callAnthropic(params);
  }
  if (provider === "gemini") {
    return callGemini(params);
  }
  return callOpenAiStyle(params);
}

// ----------------------------------------------------------------------------
// 1. Anthropic Adapter
// ----------------------------------------------------------------------------
async function callAnthropic(params: ProviderCallParams): Promise<ProviderAnswer> {
  const { key, model, system, user, schema, maxTokens, effort, timeoutMs, tools, history, runTool, images } = params;

  // Tool / Assistant flow
  if (tools && tools.length && runTool) {
    const client = new Anthropic({ apiKey: key, maxRetries: 0, timeout: timeoutMs });
    const formattedTools = tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.schema as Anthropic.Beta.BetaTool.InputSchema,
    }));
    const hist = history ?? [];
    const li = hist.map((m) => m.role).lastIndexOf("user");
    const messages: Anthropic.Beta.BetaMessageParam[] = hist.map((m, i) =>
      i === li && images?.length
        ? {
            role: m.role,
            content: [
              ...images.map((im) => ({
                type: "image" as const,
                source: {
                  type: "base64" as const,
                  media_type: im.type as "image/png" | "image/jpeg" | "image/webp" | "image/gif",
                  data: im.data,
                },
              })),
              { type: "text" as const, text: m.content },
            ],
          }
        : { role: m.role, content: m.content }
    );
    if (!messages.length && user) {
      messages.push({ role: "user", content: user });
    }

    try {
      let totalIn = 0, totalOut = 0;
      for (let round = 0; round < 6; round++) {
        const roundTimeout = callTimeout(params, round);
        const request = {
          model,
          max_tokens: maxTokens || 16000,
          system,
          tools: formattedTools,
          messages,
          output_config: { effort: effort ?? "low" },
          cache_control: { type: "ephemeral" as const },
          ...(hasFallback(model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
        };
        const sink = params.onStream;
        let wroteText = false;
        let res: Anthropic.Beta.BetaMessage;
        if (sink) {
          // Streamed: pass on reasoning and text as Claude writes them.
          const timer = streamTimer(params, round);
          const stream = client.beta.messages.stream(request, { timeout: roundTimeout, signal: timer.signal });
          try {
            for await (const ev of stream) {
              if (ev.type !== "content_block_delta") continue;
              if (ev.delta.type === "text_delta" && ev.delta.text) { timer.firstPiece(); wroteText = true; const t = ev.delta.text; safe(() => sink.text(t)); }
              else if (ev.delta.type === "thinking_delta" && ev.delta.thinking) { timer.firstPiece(); const t = ev.delta.thinking; safe(() => sink.thinking(t)); }
            }
            res = await stream.finalMessage();
          } finally {
            timer.stop();
          }
        } else {
          res = await client.beta.messages.create(request, { timeout: roundTimeout });
        }
        totalIn += res.usage?.input_tokens || 0;
        totalOut += res.usage?.output_tokens || 0;
        messages.push({ role: "assistant", content: res.content });
        if (res.stop_reason === "refusal") {
          return { text: "", usage: { input_tokens: totalIn, output_tokens: totalOut }, skip: "declined" };
        }
        const calls = res.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
        if (res.stop_reason !== "tool_use" || !calls.length) {
          const text = res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("\n\n").trim();
          return { text, usage: { input_tokens: totalIn, output_tokens: totalOut } };
        }
        // The short note Claude wrote before it looks something up ("Let me check your campaigns") was its
        // thinking for this round, not the answer.
        if (sink && wroteText) safe(() => sink.textReset());
        const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
        for (const c of calls) {
          let toolRes: string;
          try {
            toolRes = await runTool(c.name, typeof c.input === "object" && c.input !== null ? c.input as Record<string, unknown> : {});
          } catch {
            toolRes = JSON.stringify({ error: "That lookup failed." });
          }
          results.push({ type: "tool_result", tool_use_id: c.id, content: toolRes });
        }
        messages.push({ role: "user", content: results });
      }
      return { text: "", usage: { input_tokens: totalIn, output_tokens: totalOut }, skip: "cut off" };
    } catch (err: unknown) {
      handleAnthropicError(err, model);
    }
  }

  // Standard JSON / Text Prompt flow
  const url = "https://api.anthropic.com/v1/messages";
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-api-key": key,
    "anthropic-version": "2026-10-21",
  };
  const body: Record<string, unknown> = {
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: user }],
  };
  if (schema) {
    body.output_config = {
      ...(effort ? { effort } : {}),
      format: { type: "json_schema", schema },
    };
  }
  if (model !== "claude-haiku-5-5" && /^claude-(opus|sonnet)/.test(model)) {
    headers["anthropic-beta"] = "server-side-fallback-2026-07-01";
    body.fallbacks = "default";
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(callTimeout(params, 0)),
    });
  } catch (err: unknown) {
    if (isAbortError(err)) {
      throw new ProviderCallError(`Anthropic timed out after ${timeoutMs}ms`, undefined, true);
    }
    throw new ProviderCallError(`Network error reaching Anthropic: ${errMsg(err)}`, undefined, false, true);
  }

  if (res.ok) {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const d: any = await res.json();
    const usage = { input_tokens: d.usage?.input_tokens || 0, output_tokens: d.usage?.output_tokens || 0 };
    if (d.stop_reason === "refusal") return { text: "", usage, skip: "declined" };
    if (d.stop_reason === "max_tokens") return { text: "", usage, skip: "cut off" };
    const text = (d.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
    return { text, usage };
    /* eslint-enable @typescript-eslint/no-explicit-any */
  }

  const detail = await res.json().catch(() => ({}));
  const msg = String((detail?.error && (detail.error.message || detail.error)) || res.statusText || "");
  const retryHeader = res.headers.get("retry-after") || res.headers.get("x-ratelimit-reset-tokens");
  const retryAfterMs = parseResetHeader(retryHeader) ?? undefined;
  throw new ProviderCallError(`Anthropic error (${res.status}): ${msg}`.slice(0, 300), res.status, false, false, retryAfterMs);
}

function handleAnthropicError(err: unknown, model: string): never {
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    throw new ProviderCallError("The Claude key was not accepted.", 401);
  }
  if (err instanceof Anthropic.RateLimitError) {
    throw new ProviderCallError("Claude is busy or credit is exhausted.", 429);
  }
  if (err instanceof Anthropic.NotFoundError || err instanceof Anthropic.BadRequestError) {
    throw new ProviderCallError(`Claude could not use the model "${model}".`, 400);
  }
  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    throw new ProviderCallError("Anthropic connection timed out.", undefined, true);
  }
  if (err instanceof Anthropic.APIConnectionError) {
    throw new ProviderCallError("No connection to Claude.", undefined, false, true);
  }
  if (isAbortError(err)) {
    throw new ProviderCallError("Anthropic call timed out.", undefined, true);
  }
  throw new ProviderCallError(`Anthropic error: ${errMsg(err)}`.slice(0, 300));
}

// ----------------------------------------------------------------------------
// 2. Gemini Adapter
// ----------------------------------------------------------------------------
async function callGemini(params: ProviderCallParams): Promise<ProviderAnswer> {
  const { key, model, system, user, schema, timeoutMs } = params;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const headers = { "content-type": "application/json", "x-goog-api-key": key };
  const body: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: user }] }],
  };
  if (schema) {
    body.generationConfig = {
      responseMimeType: "application/json",
      responseSchema: geminiSchema(schema),
    };
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(callTimeout(params, 0)),
    });
  } catch (err: unknown) {
    if (isAbortError(err)) {
      throw new ProviderCallError(`Gemini timed out after ${timeoutMs}ms`, undefined, true);
    }
    throw new ProviderCallError(`Network error reaching Gemini: ${errMsg(err)}`, undefined, false, true);
  }

  if (res.ok) {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const d: any = await res.json();
    const c = (d.candidates || [])[0], u = d.usageMetadata || {};
    const usage = { input_tokens: u.promptTokenCount || 0, output_tokens: u.candidatesTokenCount || 0 };
    if (!c) return { text: "", usage, skip: "no answer" };
    if (c.finishReason === "MAX_TOKENS") return { text: "", usage, skip: "cut off" };
    if (["SAFETY", "RECITATION", "PROHIBITED_CONTENT"].includes(c.finishReason)) return { text: "", usage, skip: "declined" };
    const text = (c.content?.parts || []).map((p: any) => p.text || "").join("");
    return { text, usage };
    /* eslint-enable @typescript-eslint/no-explicit-any */
  }

  const detail = await res.json().catch(() => ({}));
  const msg = String((detail?.error && (detail.error.message || detail.error)) || res.statusText || "");
  const retryHeader = res.headers.get("retry-after") || res.headers.get("x-ratelimit-reset-tokens");
  const retryAfterMs = parseResetHeader(retryHeader) ?? undefined;
  throw new ProviderCallError(`Gemini error (${res.status}): ${msg}`.slice(0, 300), res.status, false, false, retryAfterMs);
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type OaRound = {
  content: string;
  toolCalls: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  finish: string | null;
  refusal: boolean;
  empty: boolean;
  wroteText: boolean;
  usageIn: number;
  usageOut: number;
};

async function oaFail(res: Response, provider: string): Promise<never> {
  const detail = await res.json().catch(() => ({}));
  const msg = String((detail?.error && (detail.error.message || detail.error)) || res.statusText || "");
  const retryAfterMs = parseResetHeader(res.headers.get("retry-after") || res.headers.get("x-ratelimit-reset-tokens")) ?? undefined;
  throw new ProviderCallError(`${provider} error (${res.status}): ${msg}`.slice(0, 300), res.status, false, false, retryAfterMs);
}

// One tool-loop round, answered in one piece.
async function oaRound(url: string, headers: Record<string, string>, body: Record<string, unknown>, params: ProviderCallParams, round: number): Promise<OaRound> {
  const { provider } = params;
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(callTimeout(params, round)) });
  } catch (err: unknown) {
    if (isAbortError(err)) throw new ProviderCallError(`${provider} timed out`, undefined, true);
    throw new ProviderCallError(`Network error reaching ${provider}: ${errMsg(err)}`, undefined, false, true);
  }
  if (!res.ok) await oaFail(res, provider);
  const d: any = await res.json();
  const u = d.usage || {};
  const msg = d?.choices?.[0]?.message;
  return {
    content: String(msg?.content ?? ""),
    toolCalls: msg?.tool_calls ?? [],
    finish: d?.choices?.[0]?.finish_reason ?? null,
    refusal: Boolean(msg?.refusal),
    empty: !msg,
    wroteText: false,
    usageIn: u.prompt_tokens || 0,
    usageOut: u.completion_tokens || 0,
  };
}

// One tool-loop round, streamed (server-sent events). Reasoning (`reasoning_content`, `reasoning`, or <think> in
// the text) and answer text are passed on the moment they arrive; tool calls are put together from their pieces.
const isJson = (t: string) => { try { JSON.parse(t); return true; } catch { return false; } };

async function oaStreamRound(url: string, headers: Record<string, string>, body: Record<string, unknown>, params: ProviderCallParams, round: number, sink: StreamSink): Promise<OaRound> {
  const { provider } = params;
  const timer = streamTimer(params, round);
  let wroteText = false;
  const split = thinkSplitter(
    (t) => { wroteText = true; safe(() => sink.text(t)); },
    (t) => safe(() => sink.thinking(t)),
  );
  const out: OaRound = { content: "", toolCalls: [], finish: null, refusal: false, empty: true, wroteText: false, usageIn: 0, usageOut: 0 };
  const calls: { id: string; type: "function"; function: { name: string; arguments: string } }[] = [];
  try {
    let res: Response;
    try {
      res = await fetch(url, { method: "POST", headers, body: JSON.stringify({ ...body, stream: true }), signal: timer.signal });
    } catch (err: unknown) {
      if (isAbortError(err)) throw new ProviderCallError(`${provider} timed out`, undefined, true);
      throw new ProviderCallError(`Network error reaching ${provider}: ${errMsg(err)}`, undefined, false, true);
    }
    if (!res.ok) await oaFail(res, provider);
    if (!res.body) throw new ProviderCallError(`${provider} sent no stream`);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let done = false;
    const line = (raw: string) => {
      const t = raw.trim();
      if (!t.startsWith("data:")) return;
      const data = t.slice(5).trim();
      if (data === "[DONE]") { done = true; return; }
      let chunk: any;
      try { chunk = JSON.parse(data); } catch { return; }
      if (chunk?.error) throw new ProviderCallError(`${provider} error: ${String(chunk.error.message || chunk.error).slice(0, 200)}`);
      const usage = chunk?.usage || chunk?.x_groq?.usage;
      if (usage) { out.usageIn = usage.prompt_tokens || out.usageIn; out.usageOut = usage.completion_tokens || out.usageOut; }
      const choice = chunk?.choices?.[0];
      if (!choice) return;
      out.empty = false;
      const delta = choice.delta || {};
      const reasoning = typeof delta.reasoning_content === "string" ? delta.reasoning_content : typeof delta.reasoning === "string" ? delta.reasoning : "";
      if (reasoning) { timer.firstPiece(); safe(() => sink.thinking(reasoning)); }
      if (typeof delta.content === "string" && delta.content) { timer.firstPiece(); out.content += delta.content; split.push(delta.content); }
      // Some providers (Mistral's reasoning models) send content as parts: { type: "thinking" } and { type: "text" }.
      else if (Array.isArray(delta.content)) {
        for (const part of delta.content) {
          const words = (x: any): string => typeof x === "string" ? x : Array.isArray(x) ? x.map(words).join("") : typeof x?.text === "string" ? x.text : "";
          if (part?.type === "thinking") { const t = words(part.thinking); if (t) { timer.firstPiece(); safe(() => sink.thinking(t)); } }
          else if (part?.type === "text" && typeof part.text === "string" && part.text) { timer.firstPiece(); out.content += part.text; split.push(part.text); }
        }
      }
      if (delta.refusal) out.refusal = true;
      for (const tc of Array.isArray(delta.tool_calls) ? delta.tool_calls : []) {
        timer.firstPiece();
        // Without an index, a piece with a new id starts a new call; any other piece belongs to the last one.
        const i = typeof tc.index === "number" ? tc.index : tc.id || !calls.length ? calls.length : calls.length - 1;
        const c = (calls[i] ??= { id: "", type: "function", function: { name: "", arguments: "" } });
        if (tc.id) c.id = tc.id;
        const n = tc.function?.name;
        // Some providers repeat the whole name in every chunk; glued together it would name no tool.
        if (typeof n === "string" && n) c.function.name = c.function.name && n.startsWith(c.function.name) ? n : c.function.name + n;
        // Arguments arrive as pieces of a JSON string. Some providers send an object instead, or repeat the
        // whole string so far in every chunk; both are taken as they are rather than glued on.
        const a = tc.function?.arguments;
        if (a && typeof a === "object") c.function.arguments = JSON.stringify(a);
        else if (typeof a === "string" && a) {
          const so = c.function.arguments;
          // Already a whole JSON value, and the new piece repeats it with more: the provider sends the full string.
          c.function.arguments = so && a.length > so.length && a.startsWith(so) && isJson(so) ? a : so + a;
        }
      }
      if (choice.finish_reason) out.finish = choice.finish_reason;
    };
    try {
      while (!done) {
        const { value, done: end } = await reader.read();
        if (end) break;
        buf += dec.decode(value, { stream: true });
        let nl;
        while (!done && (nl = buf.indexOf("\n")) >= 0) { line(buf.slice(0, nl)); buf = buf.slice(nl + 1); }
      }
      if (!done && buf) line(buf);
    } catch (err: unknown) {
      if (err instanceof ProviderCallError) throw err;
      if (isAbortError(err) || timer.signal.aborted) throw new ProviderCallError(`${provider} timed out`, undefined, true);
      throw new ProviderCallError(`${provider} stream broke: ${errMsg(err)}`, undefined, false, true);
    } finally {
      reader.cancel().catch(() => {});
    }
    split.flush();
  } finally {
    timer.stop();
  }
  // A tool with no inputs often streams no arguments at all. Sent back like that ("") on the next call,
  // providers reject the whole request, so the answer died right after its first lookup. Always send valid JSON.
  const json = (a: string) => { const t = a.trim(); return t && isJson(t) ? t : "{}"; };
  out.toolCalls = calls.filter(Boolean).map((c, i) => ({ ...c, id: c.id || `call_${round}_${i}`, function: { ...c.function, arguments: json(c.function.arguments) } }));
  out.wroteText = wroteText;
  // Providers that send no usage in a stream: a rough count, so the run log is not empty.
  if (!out.usageOut) out.usageOut = Math.ceil(out.content.length / 4);
  return out;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ----------------------------------------------------------------------------
// 3. OpenAI-Style Adapter (OpenAI, Groq, OpenRouter, NVIDIA)
// ----------------------------------------------------------------------------
async function callOpenAiStyle(params: ProviderCallParams): Promise<ProviderAnswer> {
  const { provider, baseUrl, key, model, system, user, schema, maxTokens, timeoutMs, tools, history, runTool, images } = params;
  const resolvedBase = presetBaseUrl(provider, baseUrl || CHAT_BASE[provider as Provider]);
  const url = `${resolvedBase}/chat/completions`;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${key}`,
    ...(provider === "openrouter" ? { "x-title": "Kestrel" } : {}),
  };

  // Assistant / Tools flow
  if (tools && tools.length && runTool) {
    type OaPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
    type OaMsg = {
      role: "system" | "user" | "assistant" | "tool";
      content: string | OaPart[] | null;
      tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
      tool_call_id?: string;
    };
    const hist = history ?? [];
    const li = hist.map((m) => m.role).lastIndexOf("user");
    const formattedTools = tools.map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.schema },
    }));
    const messages: OaMsg[] = [
      { role: "system", content: system },
      ...hist.map((m, i): OaMsg =>
        i === li && images?.length
          ? {
              role: m.role,
              content: [
                { type: "text", text: m.content },
                ...images.map((im): OaPart => ({
                  type: "image_url",
                  image_url: { url: `data:${im.type};base64,${im.data}` },
                })),
              ],
            }
          : { role: m.role, content: m.content }
      ),
    ];
    if (messages.length === 1 && user) {
      messages.push({ role: "user", content: user });
    }

    let totalIn = 0, totalOut = 0;
    let retriedToolValidation = false;
    for (let round = 0; round < 6; round++) {
      const body = {
        model,
        messages,
        tools: formattedTools,
        tool_choice: "auto",
        // Without a cap, a model can keep writing (or thinking) far past what a chat answer needs.
        ...(maxTokens ? { [provider === "openai" ? "max_completion_tokens" : "max_tokens"]: maxTokens } : {}),
        // In the live chat the thinking is shown to the person, so the model thinks properly ("medium");
        // elsewhere nobody sees it, so it stays short and fast.
        ...(provider === "nvidia" ? { reasoning_effort: params.onStream ? "medium" : "low" } : {}),
      };
      /* eslint-disable @typescript-eslint/no-explicit-any */
      let r: Awaited<ReturnType<typeof oaRound>>;
      try {
        r = params.onStream
          ? await oaStreamRound(url, headers, body, params, round, params.onStream)
          : await oaRound(url, headers, body, params, round);
      } catch (err) {
        if (!retriedToolValidation && err instanceof ProviderCallError && err.status === 400 && /tool call validation failed/i.test(err.message)) {
          retriedToolValidation = true;
          messages.push({
            role: "user",
            content: `Your previous tool call failed validation: ${err.message}. Fix the tool arguments to match the schema and try again.`,
          });
          continue;
        }
        throw err;
      }
      totalIn += r.usageIn;
      totalOut += r.usageOut;
      if (r.refusal) return { text: "", usage: { input_tokens: totalIn, output_tokens: totalOut }, skip: "declined" };
      if (r.empty) return { text: "", usage: { input_tokens: totalIn, output_tokens: totalOut } };
      const calls = r.toolCalls.filter((c: any) => c?.type === "function" && c.function?.name);
      if (!calls.length) {
        const text = r.content.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/^[\s\S]*?<\/think>/i, "").trim();
        // An empty answer (often: the model used all its room on thinking) is a failure, not "Done.".
        // Throwing lets the router hand the question to Nest instead.
        if (!text) throw new ProviderCallError(`${provider} returned an empty answer (${r.finish ?? "unknown"})`);
        return { text, usage: { input_tokens: totalIn, output_tokens: totalOut } };
      }
      // The text written this round was a note before a tool call: it was thinking, not the answer.
      if (params.onStream && r.wroteText) { const sink = params.onStream; safe(() => sink.textReset()); }
      messages.push({ role: "assistant", content: r.content || null, tool_calls: calls });
      for (const c of calls) {
        let args = {};
        try { args = JSON.parse(c.function.arguments || "{}"); } catch { args = {}; }
        let toolRes = "";
        try { toolRes = await runTool(c.function.name, args as Record<string, unknown>); }
        catch { toolRes = JSON.stringify({ error: "That lookup failed." }); }
        messages.push({ role: "tool", tool_call_id: c.id, content: toolRes });
      }
      /* eslint-enable @typescript-eslint/no-explicit-any */
    }
    return { text: "", usage: { input_tokens: totalIn, output_tokens: totalOut }, skip: "cut off" };
  }

  // Standard JSON / Chat Completion flow
  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: schema ? `${system}\n\nAnswer with JSON only.` : system },
      { role: "user", content: user },
    ],
  };
  if (schema) {
    body.response_format = { type: "json_object" };
  }
  if (maxTokens) {
    // OpenAI's newer models refuse max_tokens; max_completion_tokens works on all of them.
    body[provider === "openai" ? "max_completion_tokens" : "max_tokens"] = maxTokens;
  }
  if (provider === "nvidia") {
    body.reasoning_effort = "none";
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(callTimeout(params, 0)),
    });
  } catch (err: unknown) {
    if (isAbortError(err)) {
      throw new ProviderCallError(`${provider} timed out after ${timeoutMs}ms`, undefined, true);
    }
    throw new ProviderCallError(`Network error reaching ${provider}: ${errMsg(err)}`, undefined, false, true);
  }

  if (res.ok) {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const d: any = await res.json();
    const c = (d.choices || [])[0], u = d.usage || {};
    const usage: ProviderUsage = {
      input_tokens: u.prompt_tokens || 0,
      output_tokens: u.completion_tokens || 0,
      cost: Number.isFinite(u.cost) ? u.cost : undefined,
    };
    if (!c) return { text: "", usage, skip: "no answer" };
    if (c.message?.refusal) return { text: "", usage, skip: "declined" };
    if (c.finish_reason === "length") throw new ProviderCallError(`${provider} response cut off (finish_reason=length)`, 500);
    return { text: c.message?.content || "", usage };
    /* eslint-enable @typescript-eslint/no-explicit-any */
  }

  const detail = await res.json().catch(() => ({}));
  const msg = String((detail?.error && (detail.error.message || detail.error)) || res.statusText || "");
  const retryHeader = res.headers.get("retry-after") || res.headers.get("x-ratelimit-reset-tokens");
  const retryAfterMs = parseResetHeader(retryHeader) ?? undefined;

  // Special groq 400 retry without response_format
  if (res.status === 400 && provider === "groq" && /Failed to validate JSON/i.test(msg) && schema) {
    delete body.response_format;
    const retryRes = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(callTimeout(params, 1)),
    }).catch(() => null);
    if (retryRes && retryRes.ok) {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const d: any = await retryRes.json();
      const c = (d.choices || [])[0], u = d.usage || {};
      const usage = { input_tokens: u.prompt_tokens || 0, output_tokens: u.completion_tokens || 0 };
      return { text: c?.message?.content || "", usage };
      /* eslint-enable @typescript-eslint/no-explicit-any */
    }
  }

  throw new ProviderCallError(`${provider} error (${res.status}): ${msg}`.slice(0, 300), res.status, false, false, retryAfterMs);
}

function isAbortError(err: unknown): boolean {
  return (
    (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) ||
    String(err).includes("timeout") ||
    String(err).includes("aborted")
  );
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
