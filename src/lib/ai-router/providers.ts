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
};

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
        const res = await client.beta.messages.create({
          model,
          max_tokens: maxTokens || 16000,
          system,
          tools: formattedTools,
          messages,
          output_config: { effort: effort ?? "low" },
          cache_control: { type: "ephemeral" },
          ...(hasFallback(model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
        }, { timeout: roundTimeout });
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
    for (let round = 0; round < 6; round++) {
      let res: Response;
      try {
        res = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model,
            messages,
            tools: formattedTools,
            tool_choice: "auto",
            // Without a cap, a model can keep writing (or thinking) far past what a chat answer needs.
            ...(maxTokens ? { [provider === "openai" ? "max_completion_tokens" : "max_tokens"]: maxTokens } : {}),
            ...(provider === "nvidia" ? { reasoning_effort: "low" } : {}),
          }),
          signal: AbortSignal.timeout(callTimeout(params, round)),
        });
      } catch (err: unknown) {
        if (isAbortError(err)) throw new ProviderCallError(`${provider} timed out`, undefined, true);
        throw new ProviderCallError(`Network error reaching ${provider}: ${errMsg(err)}`, undefined, false, true);
      }

      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        const msg = String((detail?.error && (detail.error.message || detail.error)) || res.statusText || "");
        const retryAfterMs = parseResetHeader(res.headers.get("retry-after") || res.headers.get("x-ratelimit-reset-tokens")) ?? undefined;
        throw new ProviderCallError(`${provider} error (${res.status}): ${msg}`.slice(0, 300), res.status, false, false, retryAfterMs);
      }

      /* eslint-disable @typescript-eslint/no-explicit-any */
      const d: any = await res.json();
      const u = d.usage || {};
      totalIn += u.prompt_tokens || 0;
      totalOut += u.completion_tokens || 0;
      const msg = d?.choices?.[0]?.message;
      if (!msg) return { text: "", usage: { input_tokens: totalIn, output_tokens: totalOut } };
      if (msg.refusal) return { text: "", usage: { input_tokens: totalIn, output_tokens: totalOut }, skip: "declined" };
      const calls = (msg.tool_calls ?? []).filter((c: any) => c?.type === "function" && c.function?.name);
      if (!calls.length) {
        const text = String(msg.content ?? "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
        // An empty answer (often: the model used all its room on thinking) is a failure, not "Done.".
        // Throwing lets the router hand the question to Nest instead.
        if (!text) throw new ProviderCallError(`${provider} returned an empty answer (${d?.choices?.[0]?.finish_reason ?? "unknown"})`);
        return { text, usage: { input_tokens: totalIn, output_tokens: totalOut } };
      }
      messages.push({ role: "assistant", content: msg.content ?? null, tool_calls: calls });
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
    if (c.finish_reason === "length") return { text: "", usage, skip: "cut off" };
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
