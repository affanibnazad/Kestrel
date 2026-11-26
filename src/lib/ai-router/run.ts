import "server-only";
import type { supabaseServer } from "../supabase/server";
import type { Provider } from "../ai";
import { HAIKU, SONNET, modelForTask } from "../ai-models";
import { assistantConfig, serverSecret } from "../assistant-server";
import { aiAllowance, allowanceExhaustedMessage } from "../plans";
import { AI_TASKS, type AiSlot, type AiTaskName } from "./tasks";
import { callProvider, costOf, ProviderCallError, type ProviderAnswer } from "./providers";

type Sb = Awaited<ReturnType<typeof supabaseServer>>;

export type RunAiTaskParams = {
  sb: Sb;
  teamId: string;
  userId?: string | null;
  task: AiTaskName;
  system: string;
  user: string;
  schema?: object;
  // Optional overrides or context
  maxTokens?: number;
  effort?: "low" | "medium" | "high";
  timeoutMs?: number; // Override per-attempt timeout if specified
  deadlineMs?: number; // Absolute timestamp (Date.now() + remaining) or relative ms
  // Chat / assistant context
  history?: { role: "user" | "assistant"; content: string }[];
  tools?: { name: string; description: string; schema: Record<string, unknown> }[];
  runTool?: (name: string, input: Record<string, unknown>) => Promise<string>;
  images?: { type: string; data: string }[];
  // Fallback handler for qc or custom
  onCodeChecksOnly?: () => Record<string, unknown>;
  // For unit tests / dependency injection
  providerFn?: typeof callProvider;
  logRunFn?: typeof logRun;
  // Optional pre-resolved provider/key/model — skips resolveModelForSlot for attempt 1.
  // Passed by assistant-engine (for chat) and Owner -> AI slot tester.
  resolution?: ModelResolution;
  // Owner -> AI "Test": test exactly this slot. No Nest fallback and no retry, so the result
  // can never show another slot's model.
  noFallback?: boolean;
  retries?: number;
};

export type RunAiTaskResult<T = unknown> =
  | {
      ok: true;
      data: T;
      text: string;
      provider: string;
      model: string;
      source: "kestrel" | "team_key";
      slot?: AiSlot;
      tokens_in: number;
      tokens_out: number;
      cost_usd: number | null;
      ms: number;
      /** True when the first slot failed and Nest answered instead. */
      fellBack?: boolean;
    }
  | {
      ok: false;
      error: string;
      status: "timeout" | "error" | "skipped";
      refused?: boolean;
      provider?: string;
      model?: string;
      source?: "kestrel" | "team_key";
      slot?: AiSlot;
      cost_usd?: number | null;
      lastError?: string;
      statusCode?: number;
    };

export const CUSTOMER_ERROR_MESSAGE = "Kestrel AI can't answer right now. Try again in a minute.";

// Tasks that must ALWAYS use Kestrel's AI (ai_slots / assistant_included)
export const KESTREL_ALWAYS_TASKS = new Set<AiTaskName>([
  "chat",
  "reply_suggest",
  "reply_label",
  "spam_fix",
]);

// Tasks that use the team's own key (from Settings / Connections)
export const TEAM_KEY_TASKS = new Set<AiTaskName>([
  "research",
  "explain",
  "voice",
  "score",
  "write",
  "qc",
]);

export type ModelResolution = {
  provider: string;
  baseUrl?: string | null;
  model: string;
  key: string;
  source: "team_key" | "kestrel";
  slot?: AiSlot;
  effort?: "low" | "medium" | "high";
};

// Resolve one of the 3 Kestrel AI slots (swift | talon | nest) from ai_slot_for_server RPC.
// Returns null if the slot is not configured, disabled, or 077 migration is not applied yet.
export async function resolveSlot(
  sb: Sb,
  slot: AiSlot
): Promise<ModelResolution | null> {
  const secret = serverSecret();
  if (secret.length < 32) return null;
  try {
    const { data, error } = await sb.rpc("ai_slot_for_server", {
      server_secret: secret,
      p_slot: slot,
    });
    if (error || !data) return null;
    const s = data as {
      slot?: AiSlot;
      provider?: string;
      base_url?: string | null;
      model?: string;
      key?: string | null;
      enabled?: boolean;
    };
    if (s.enabled !== false && s.provider && s.model && s.key) {
      return {
        provider: s.provider,
        baseUrl: s.base_url ?? null,
        model: s.model,
        key: s.key,
        source: "kestrel",
        slot,
        effort: slot === "talon" ? "medium" : "low",
      };
    }
  } catch {
    // Migration 077 not applied yet or RPC error -> safe rollout fallback
  }
  return null;
}

// Legacy backup for safe rollout before Nest slot is filled
async function resolveLegacyBackup(sb: Sb): Promise<ModelResolution | null> {
  const claude = await assistantConfig(sb);
  if ("error" in claude) return null;
  return {
    provider: "anthropic",
    model: HAIKU,
    key: claude.key,
    source: "kestrel",
    slot: "nest",
    effort: "low",
  };
}

// Resolve Kestrel's included AI for a slot: ai_slots first, then safe-rollout fallback (assistant_included / assistantConfig).
async function resolveKestrelSlot(
  sb: Sb,
  slot: AiSlot
): Promise<ModelResolution | { error: string; isDbError?: boolean }> {
  const slotRes = await resolveSlot(sb, slot);
  if (slotRes) return slotRes;

  const secret = serverSecret();
  if (secret.length >= 32) {
    try {
      const { data, error } = await sb.rpc("assistant_included", { server_secret: secret });
      if (!error && data) {
        const c = data as { provider: Provider; model: string; enabled: boolean; key: string | null };
        if (c.enabled && c.key && c.model) {
          return {
            provider: c.provider,
            model: c.model,
            key: c.key,
            source: "kestrel",
            slot,
            effort: slot === "talon" ? "medium" : "low",
          };
        }
      }
    } catch {
      // fall back to assistantConfig
    }
  }
  const claude = await assistantConfig(sb);
  if ("error" in claude) return claude;
  return {
    provider: "anthropic",
    model: slot === "talon" ? SONNET : HAIKU,
    key: claude.key,
    source: "kestrel",
    slot,
    effort: slot === "talon" ? "medium" : "low",
  };
}

// Check monthly Kestrel-paid AI allowance for a team (chat has its own daily limit and does not count here).
export async function checkKestrelAllowance(
  sb: Sb,
  teamId: string
): Promise<{ allowed: boolean; used: number; allowance: number; message?: string }> {
  const [usageRes, acctRes] = await Promise.all([
    sb.rpc("ai_usage_this_month", { p_team_id: teamId }),
    sb.rpc("my_account"),
  ]);

  let planData = acctRes?.data as {
    plan?: string | null;
    active?: boolean | null;
    paid_until?: string | null;
    access_until?: string | null;
    access_plan?: string | null;
  } | null;

  if (!planData) {
    const teamRes = await sb.from("teams").select("plan,paid_until").eq("id", teamId).maybeSingle();
    planData = (teamRes?.data as typeof planData) ?? null;
  }

  const allowance = aiAllowance(planData);
  const used =
    !usageRes?.error && usageRes?.data !== null && usageRes?.data !== undefined
      ? Number(usageRes.data) || 0
      : 0;

  if (used >= allowance) {
    return { allowed: false, used, allowance, message: allowanceExhaustedMessage() };
  }
  return { allowed: true, used, allowance };
}

// Resolve model for a given slot ("swift" | "talon" | "nest")
export async function resolveModelForSlot(
  sb: Sb,
  teamId: string,
  slot: AiSlot,
  task: AiTaskName
): Promise<ModelResolution | { error: string; isDbError?: boolean }> {
  const secret = serverSecret();

  // 1. Kestrel AI tasks ALWAYS use Kestrel's AI (ai_slots first, then safe-rollout fallback)
  if (KESTREL_ALWAYS_TASKS.has(task)) {
    return resolveKestrelSlot(sb, slot);
  }

  // 2. Team-key tasks (research, explain, voice, score, write, qc):
  //    Use the team's own key if configured; otherwise fall back to Kestrel's Swift slot.
  const { data: teamAi, error: teamAiError } = await sb
    .from("team_ai")
    .select("*")
    .eq("team_id", teamId)
    .maybeSingle();

  if (teamAiError) {
    return { error: `Failed to read team AI configuration: ${teamAiError.message}`, isDbError: true };
  }

  const provider = (teamAi?.provider as Provider) || null;
  if (provider && secret.length >= 32) {
    const { data: key, error: keyError } = await sb.rpc("ai_key_for_server", {
      server_secret: secret,
      service: provider,
    });
    if (keyError) {
      const isPlanErr = /PLAN_NEEDED/i.test(keyError.message || "");
      return {
        error: keyError.message || "Failed to retrieve team AI key.",
        isDbError: !isPlanErr,
      };
    }
    if (key && typeof key === "string") {
      const pick = modelForTask(
        provider,
        String(teamAi?.model ?? ""),
        slot === "swift" ? "score" : "emails"
      );
      if (!pick.model) {
        return {
          error: `Your team has no model configured for ${task}. Choose one in Settings → Connections.`,
        };
      }
      return {
        provider,
        model: pick.model,
        key,
        source: "team_key",
        slot,
        effort: pick.effort,
      };
    }
  }

  // No team key configured -> use Kestrel's Swift slot for all tiers (including write).
  return resolveKestrelSlot(sb, "swift");
}

// Log one attempt to supabase public.ai_runs via log_ai_run RPC
export async function logRun(
  sb: Sb,
  teamId: string,
  userId: string | null | undefined,
  task: string,
  provider: string,
  model: string,
  source: string,
  attempt: number,
  ms: number,
  tokensIn: number,
  tokensOut: number,
  costUsd: number | null,
  status: "ok" | "timeout" | "error" | "fallback" | "skipped",
  errorText: string | null,
  slot?: AiSlot | null
) {
  const secret = serverSecret();
  const baseArgs = {
    server_secret: secret,
    p_team_id: teamId,
    p_user_id: userId ?? null,
    p_task: task,
    p_provider: provider,
    p_model: model,
    p_source: source,
    p_attempt: attempt,
    p_ms: ms,
    p_tokens_in: tokensIn,
    p_tokens_out: tokensOut,
    p_cost_usd: costUsd,
    p_status: status,
    p_error: errorText ? errorText.slice(0, 300) : null,
  };
  try {
    const res = await sb.rpc("log_ai_run", slot ? { ...baseArgs, p_slot: slot } : baseArgs);
    // Safe rollout: if 077 isn't applied yet, PGRST202 rejects p_slot; retry without it
    if (res?.error && slot && /PGRST202|p_slot/i.test(String(res.error.code || res.error.message || ""))) {
      await sb.rpc("log_ai_run", baseArgs);
    }
  } catch (err) {
    console.error("[ai-router] failed to log ai_run:", err);
  }
}

export async function runAiTask<T = unknown>(params: RunAiTaskParams): Promise<RunAiTaskResult<T>> {
  const { sb, teamId, userId, task, system, user, schema } = params;
  const cfg = AI_TASKS[task];
  if (!cfg) {
    return { ok: false, error: CUSTOMER_ERROR_MESSAGE, status: "error" };
  }

  const callProviderImpl = params.providerFn ?? callProvider;
  const logRunImpl = params.logRunFn ?? logRun;

  // Deadline calculation: default 50s from start of request unless specified
  const now = Date.now();
  const absoluteDeadline =
    params.deadlineMs !== undefined
      ? params.deadlineMs > 1_000_000_000_000
        ? params.deadlineMs
        : now + params.deadlineMs
      : now + 50_000;

  const baseTaskTimeout = params.timeoutMs ?? cfg.timeoutMs;
  const maxTokens = params.maxTokens ?? cfg.maxTokens;

  // Resolve initial model by task slot — or use pre-resolved override if provided
  let currentSlot: AiSlot = params.resolution?.slot ?? cfg.slot;
  let currentResolution: ModelResolution;

  if (params.resolution) {
    currentResolution = params.resolution;
  } else {
    const resolution = await resolveModelForSlot(sb, teamId, cfg.slot, task);
    if ("error" in resolution) {
      const isDb = Boolean("isDbError" in resolution && resolution.isDbError) || /database|relation|failed to read/i.test(resolution.error);
      const code = isDb ? 500 : 401;
      return { ok: false, error: CUSTOMER_ERROR_MESSAGE, status: "error", slot: currentSlot, lastError: resolution.error, statusCode: code };
    }
    currentResolution = resolution;
    currentSlot = resolution.slot ?? cfg.slot;
  }

  // Check monthly Kestrel AI allowance before every Kestrel-paid call (chat has its own daily limit).
  if (currentResolution.source === "kestrel" && task !== "chat") {
    const limit = await checkKestrelAllowance(sb, teamId);
    if (!limit.allowed) {
      await logRunImpl(
        sb,
        teamId,
        userId,
        task,
        currentResolution.provider,
        currentResolution.model,
        "kestrel",
        1,
        0,
        0,
        0,
        null,
        "skipped",
        "monthly_allowance_reached",
        currentSlot
      );
      return {
        ok: false,
        error: limit.message!,
        status: "skipped",
        provider: currentResolution.provider,
        model: currentResolution.model,
        source: "kestrel",
        slot: currentSlot,
        lastError: "monthly_allowance_reached",
      };
    }
  }

  const maxAttempts = 1 + (params.retries ?? cfg.retries);

  // Nest can only help if it still has time when the first slot gives up. So the first slot must stop
  // NEST_RESERVE_MS before the deadline. Before this, a Talon timeout (40s) used all 50s and Nest was
  // always skipped with "no time left": the person waited ~50s for an error.
  const nestPossible =
    !params.noFallback &&
    cfg.fallback === "nest" &&
    currentResolution.source === "kestrel" &&
    currentSlot !== "nest";
  const reserve = nestPossible ? Math.min(NEST_RESERVE_MS, Math.max(0, (absoluteDeadline - now) / 2)) : 0;
  const primaryDeadline = absoluteDeadline - reserve;
  // Look up Nest at the same time as the first call, so a fallback does not wait for another
  // database round trip. Errors here are ignored; Nest is simply not used.
  const nestLookup: Promise<ModelResolution | null> | null = nestPossible
    ? (async () => {
        try {
          return (await resolveSlot(sb, "nest")) ?? (await resolveLegacyBackup(sb));
        } catch {
          return null;
        }
      })()
    : null;

  let lastErrorMsg = "";
  let lastStatus: "timeout" | "error" | "skipped" = "error";
  let lastStatusCode: number | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const timeLeft = primaryDeadline - Date.now();
    const neededForStep = baseTaskTimeout + 2000;

    // Before every retry: if time left is less than step's timeout + 2s, do NOT start it.
    // When Nest can take over, go to Nest instead of giving up.
    if (attempt > 1 && timeLeft < neededForStep && nestPossible) break;
    if (attempt > 1 && timeLeft < neededForStep) {
      await logRunImpl(
        sb,
        teamId,
        userId,
        task,
        currentResolution.provider,
        currentResolution.model,
        currentResolution.source,
        attempt,
        0,
        0,
        0,
        null,
        "skipped",
        "no time left",
        currentSlot
      );
      return {
        ok: false,
        error: CUSTOMER_ERROR_MESSAGE,
        status: "skipped",
        provider: currentResolution.provider,
        model: currentResolution.model,
        source: currentResolution.source,
        slot: currentSlot,
      };
    }

    const effectiveTimeout = Math.max(1, Math.min(baseTaskTimeout, timeLeft - 2000));
    const startMs = Date.now();

    try {
      const answer: ProviderAnswer = await callProviderImpl({
        provider: currentResolution.provider,
        baseUrl: currentResolution.baseUrl,
        key: currentResolution.key,
        model: currentResolution.model,
        system,
        user,
        schema,
        maxTokens,
        effort: params.effort ?? currentResolution.effort,
        timeoutMs: effectiveTimeout,
        // The first model call must answer before Nest's reserved time starts, so a dead or
        // rate-limited slot hands over fast. Once it has answered once, the tool loop may use
        // the whole deadline (but never more: before, each round got a fresh 40s).
        firstCallDeadlineAt: primaryDeadline - 1000,
        deadlineAt: absoluteDeadline - 1000,
        history: params.history,
        tools: params.tools,
        runTool: params.runTool,
        images: params.images,
      });

      const elapsedMs = Date.now() - startMs;
      const tokensIn = answer.usage.input_tokens || 0;
      const tokensOut = answer.usage.output_tokens || 0;
      const cost = costOf(answer.usage, currentResolution.provider, currentResolution.model);

      if (answer.skip) {
        await logRunImpl(
          sb,
          teamId,
          userId,
          task,
          currentResolution.provider,
          currentResolution.model,
          currentResolution.source,
          attempt,
          elapsedMs,
          tokensIn,
          tokensOut,
          cost,
          "skipped",
          `AI skipped: ${answer.skip}`,
          currentSlot
        );
        return {
          ok: false,
          error: CUSTOMER_ERROR_MESSAGE,
          status: "skipped",
          refused: true,
          provider: currentResolution.provider,
          model: currentResolution.model,
          source: currentResolution.source,
          slot: currentSlot,
          cost_usd: cost,
        };
      }

      await logRunImpl(
        sb,
        teamId,
        userId,
        task,
        currentResolution.provider,
        currentResolution.model,
        currentResolution.source,
        attempt,
        elapsedMs,
        tokensIn,
        tokensOut,
        cost,
        "ok",
        null,
        currentSlot
      );

      let parsedData: unknown = answer.text;
      if (schema) {
        parsedData = parseJsonObject(answer.text);
      }

      return {
        ok: true,
        data: parsedData as T,
        text: answer.text,
        provider: currentResolution.provider,
        model: currentResolution.model,
        source: currentResolution.source,
        slot: currentSlot,
        tokens_in: tokensIn,
        tokens_out: tokensOut,
        cost_usd: cost,
        ms: elapsedMs,
      };
    } catch (err: unknown) {
      const elapsedMs = Date.now() - startMs;
      const isTimeout =
        err instanceof ProviderCallError ? err.isTimeout : /timeout|abort/i.test(String(err));
      const is429 =
        (err instanceof ProviderCallError && err.status === 429) ||
        /\b429\b|rate limit|too many requests/i.test(err instanceof Error ? err.message : String(err));

      const status: "timeout" | "error" = isTimeout ? "timeout" : "error";
      lastStatus = status;
      lastErrorMsg = is429 ? "rate_limited" : (err instanceof Error ? err.message : String(err));
      lastStatusCode = err instanceof ProviderCallError ? err.status : undefined;

      await logRunImpl(
        sb,
        teamId,
        userId,
        task,
        currentResolution.provider,
        currentResolution.model,
        currentResolution.source,
        attempt,
        elapsedMs,
        0,
        0,
        null,
        status,
        lastErrorMsg,
        currentSlot
      );

      // On 429: read Retry-After / reset header; if wait fits in deadline, wait that long, else break to Nest fallback / exit
      if (is429) {
        if (attempt < maxAttempts) {
          const retryAfterMs = err instanceof ProviderCallError ? err.retryAfterMs : undefined;
          if (retryAfterMs !== undefined && retryAfterMs > 0) {
            const timeLeftAfterWait = primaryDeadline - (Date.now() + retryAfterMs);
            if (timeLeftAfterWait >= neededForStep) {
              await wait(retryAfterMs);
              continue;
            }
          }
        }
        break;
      }

      if (attempt < maxAttempts) {
        await wait(300);
        continue;
      }
    }
  }

  // Retries exhausted (or 429 broke early): handle fallback
  if (params.noFallback) {
    return {
      ok: false,
      error: CUSTOMER_ERROR_MESSAGE,
      status: lastStatus,
      provider: currentResolution.provider,
      model: currentResolution.model,
      source: currentResolution.source,
      slot: currentSlot,
      lastError: lastErrorMsg,
      statusCode: lastStatusCode,
    };
  }

  if (cfg.fallback === "skip") {
    return {
      ok: false,
      error: CUSTOMER_ERROR_MESSAGE,
      status: "skipped",
      provider: currentResolution.provider,
      model: currentResolution.model,
      source: currentResolution.source,
      slot: currentSlot,
    };
  }

  if (cfg.fallback === "code_checks_only") {
    const fallbackData = params.onCodeChecksOnly ? params.onCodeChecksOnly() : {};
    await logRunImpl(
      sb,
      teamId,
      userId,
      task,
      currentResolution.provider,
      currentResolution.model,
      currentResolution.source,
      1,
      0,
      0,
      0,
      null,
      "fallback",
      "code_checks_only",
      currentSlot
    );
    return {
      ok: true,
      data: fallbackData as T,
      text: JSON.stringify(fallbackData),
      provider: currentResolution.provider,
      model: currentResolution.model,
      source: currentResolution.source,
      slot: currentSlot,
      tokens_in: 0,
      tokens_out: 0,
      cost_usd: null,
      ms: 0,
    };
  }

  // Nest fallback: Swift fails -> Nest. Talon fails -> Nest. Nest fails -> honest error. Never loop.
  // Team-key tasks NEVER fall back to Kestrel's Nest slot.
  if (nestPossible && nestLookup) {
    const nestRes = await nestLookup;
    const isSameModel =
      nestRes &&
      nestRes.provider === currentResolution.provider &&
      nestRes.model === currentResolution.model &&
      (nestRes.baseUrl ?? null) === (currentResolution.baseUrl ?? null);

    if (nestRes && !isSameModel) {
      const timeLeft = absoluteDeadline - Date.now();
      const fallbackTimeout = Math.min(baseTaskTimeout, 20_000);
      // Nest gets whatever time is left (at least NEST_MIN_MS), instead of needing a full 22s.
      if (timeLeft < Math.min(NEST_MIN_MS, reserve)) {
        await logRunImpl(
          sb,
          teamId,
          userId,
          task,
          nestRes.provider,
          nestRes.model,
          nestRes.source,
          1,
          0,
          0,
          0,
          null,
          "skipped",
          "no time left",
          "nest"
        );
        return {
          ok: false,
          error: CUSTOMER_ERROR_MESSAGE,
          status: "skipped",
          provider: nestRes.provider,
          model: nestRes.model,
          source: nestRes.source,
          slot: "nest",
        };
      }

      const effectiveFallbackTimeout = Math.max(1, Math.min(fallbackTimeout, timeLeft - 1000));
      const startMs = Date.now();
      try {
        const answer: ProviderAnswer = await callProviderImpl({
          provider: nestRes.provider,
          baseUrl: nestRes.baseUrl,
          key: nestRes.key,
          model: nestRes.model,
          system,
          user,
          schema,
          // Chat answers need the same room as Talon, or long answers come back cut off / empty.
          maxTokens: task === "chat" ? maxTokens : Math.min(maxTokens, 1500),
          effort: "low",
          timeoutMs: effectiveFallbackTimeout,
          deadlineAt: absoluteDeadline - 1000,
          history: params.history,
          tools: params.tools,
          runTool: params.runTool,
          images: params.images,
        });

        const elapsedMs = Date.now() - startMs;
        const tokensIn = answer.usage.input_tokens || 0;
        const tokensOut = answer.usage.output_tokens || 0;
        const cost = costOf(answer.usage, nestRes.provider, nestRes.model);

        await logRunImpl(
          sb,
          teamId,
          userId,
          task,
          nestRes.provider,
          nestRes.model,
          nestRes.source,
          1,
          elapsedMs,
          tokensIn,
          tokensOut,
          cost,
          "fallback",
          null,
          "nest"
        );

        let parsedData: unknown = answer.text;
        if (schema) {
          parsedData = parseJsonObject(answer.text);
        }

        return {
          ok: true,
          data: parsedData as T,
          text: answer.text,
          provider: nestRes.provider,
          model: nestRes.model,
          source: nestRes.source,
          slot: "nest",
          tokens_in: tokensIn,
          tokens_out: tokensOut,
          cost_usd: cost,
          ms: elapsedMs,
          fellBack: true,
        };
      } catch (fallbackErr: unknown) {
        const elapsedMs = Date.now() - startMs;
        const isTimeout =
          fallbackErr instanceof ProviderCallError
            ? fallbackErr.isTimeout
            : /timeout|abort/i.test(String(fallbackErr));
        const bStatus = isTimeout ? "timeout" : "error";
        const bMsg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
        lastStatus = bStatus;
        lastErrorMsg = bMsg;
        lastStatusCode = fallbackErr instanceof ProviderCallError ? fallbackErr.status : lastStatusCode;
        await logRunImpl(
          sb,
          teamId,
          userId,
          task,
          nestRes.provider,
          nestRes.model,
          nestRes.source,
          1,
          elapsedMs,
          0,
          0,
          null,
          bStatus,
          bMsg,
          "nest"
        );
      }
    }
  }

  if (lastStatusCode === 429) {
    return {
      ok: false,
      error: "Kestrel AI is busy, try again in a minute.",
      status: "error",
      provider: currentResolution.provider,
      model: currentResolution.model,
      source: currentResolution.source,
      slot: currentSlot,
      lastError: "rate_limited",
      statusCode: 429,
    };
  }

  return {
    ok: false,
    error: CUSTOMER_ERROR_MESSAGE,
    status: lastStatus,
    provider: currentResolution.provider,
    model: currentResolution.model,
    source: currentResolution.source,
    slot: currentSlot,
    lastError: lastErrorMsg,
    statusCode: lastStatusCode,
  };
}

export function parseJsonObject<T = unknown>(text: string): T | null {
  const t = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  const i = t.indexOf("{"),
    j = t.lastIndexOf("}");
  if (i < 0 || j <= i) return null;
  try {
    const v = JSON.parse(t.slice(i, j + 1));
    return v && typeof v === "object" ? (v as T) : null;
  } catch {
    return null;
  }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Time kept back for Nest when the first slot (Swift / Talon) can fall back to it.
const NEST_RESERVE_MS = 15_000;
// Nest is not started with less than this left: it could not finish anyway.
const NEST_MIN_MS = 6_000;
