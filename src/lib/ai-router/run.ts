import "server-only";
import type { supabaseServer } from "../supabase/server";
import type { Provider } from "../ai";
import { HAIKU, SONNET, modelForTask } from "../ai-models";
import { assistantConfig, serverSecret } from "../assistant-server";
import { AI_TASKS, type AiTaskName, type AiTier } from "./tasks";
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
};

export type RunAiTaskResult<T = unknown> =
  | {
      ok: true;
      data: T;
      text: string;
      provider: string;
      model: string;
      source: "kestrel" | "team_key";
      tokens_in: number;
      tokens_out: number;
      cost_usd: number | null;
      ms: number;
    }
  | {
      ok: false;
      error: string;
      status: "timeout" | "error" | "skipped";
      provider?: string;
      model?: string;
      source?: "kestrel" | "team_key";
      cost_usd?: number | null;
      lastError?: string;
      statusCode?: number;
    };

export const CUSTOMER_ERROR_MESSAGE = "Kestrel AI can't answer right now. Try again in a minute.";

// Tasks that must ALWAYS use Kestrel's AI (Owner → Assistant / assistant_included)
// Reverted as per AI-1: chat, reply_suggest, reply_label, spam_fix never use the team's key.
export const KESTREL_ALWAYS_TASKS = new Set<AiTaskName>([
  "chat",
  "reply_suggest",
  "reply_label",
  "spam_fix",
]);

// Tasks that must ALWAYS use the team's key (from Settings / Connections)
export const TEAM_KEY_TASKS = new Set<AiTaskName>([
  "research",
  "explain",
  "voice",
  "score",
  "write",
  "qc",
]);

export type ModelResolution = {
  provider: Provider;
  model: string;
  key: string;
  source: "team_key" | "kestrel";
  effort?: "low" | "medium" | "high";
};

// Helper: resolve backup model for fast tier fallback (Requirement 5)
// Primary = included AI, Backup = Claude Haiku on Kestrel's Claude key
export async function resolveFastBackup(
  sb: Sb
): Promise<ModelResolution | { error: string }> {
  const claude = await assistantConfig(sb);
  if ("error" in claude) return claude;
  return {
    provider: "anthropic",
    model: HAIKU,
    key: claude.key,
    source: "kestrel",
    effort: "low",
  };
}

// Helper: resolve model for a given tier ("fast" vs "strong")
export async function resolveModelForTier(
  sb: Sb,
  teamId: string,
  tier: AiTier,
  task: AiTaskName
): Promise<ModelResolution | { error: string; isDbError?: boolean }> {
  const secret = serverSecret();

  // 1. Kestrel AI tasks ALWAYS use Kestrel's AI (never the team's key)
  if (KESTREL_ALWAYS_TASKS.has(task)) {
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
              effort: tier === "strong" ? "medium" : "low",
            };
          }
        }
      } catch {
        // fall back to assistantConfig
      }
    }
    // Fall back to Kestrel's Claude key (assistantConfig)
    const claude = await assistantConfig(sb);
    if ("error" in claude) return claude;
    return {
      provider: "anthropic",
      model: tier === "strong" ? SONNET : HAIKU,
      key: claude.key,
      source: "kestrel",
      effort: tier === "strong" ? "medium" : "low",
    };
  }

  // 2. Team key tasks (research, explain, voice, score, write, qc) ALWAYS require the team's key
  const { data: teamAi, error: teamAiError } = await sb
    .from("team_ai")
    .select("*")
    .eq("team_id", teamId)
    .maybeSingle();

  // If reading team_ai FAILS (error, not "no row"): do NOT fall back to Kestrel's key — return the error.
  if (teamAiError) {
    return { error: `Failed to read team AI configuration: ${teamAiError.message}`, isDbError: true };
  }

  const provider = (teamAi?.provider as Provider) || null;
  if (!provider || secret.length < 32) {
    return {
      error: `Your team has no AI key configured for ${task}. Add one in Settings → Connections.`,
    };
  }

  const { data: key, error: keyError } = await sb.rpc("ai_key_for_server", {
    server_secret: secret,
    service: provider,
  });
  if (keyError) {
    return { error: keyError.message || "Failed to retrieve team AI key.", isDbError: true };
  }
  if (!key || typeof key !== "string") {
    return {
      error: `Your team has no AI key configured for ${task}. Add one in Settings → Connections.`,
    };
  }

  const pick = modelForTask(
    provider,
    String(teamAi?.model ?? ""),
    tier === "fast" ? "score" : "emails"
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
    effort: pick.effort,
  };
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
  errorText: string | null
) {
  const secret = serverSecret();
  try {
    await sb.rpc("log_ai_run", {
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
    });
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

  // Resolve initial model by task tier
  const resolution = await resolveModelForTier(sb, teamId, cfg.tier, task);
  if ("error" in resolution) {
    const isDb = Boolean("isDbError" in resolution && resolution.isDbError) || /database|relation|failed to read/i.test(resolution.error);
    const code = isDb ? 500 : 401;
    return { ok: false, error: CUSTOMER_ERROR_MESSAGE, status: "error", lastError: resolution.error, statusCode: code };
  }

  let currentTier: AiTier = cfg.tier;
  let currentResolution: ModelResolution = resolution;

  const maxAttempts = 1 + cfg.retries;
  let lastErrorMsg = "";
  let lastStatus: "timeout" | "error" | "skipped" = "error";
  let lastStatusCode: number | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const timeLeft = absoluteDeadline - Date.now();
    const neededForStep = baseTaskTimeout + 2000;

    // Before every attempt / retry: if time left is less than step's timeout + 2s, do NOT start it
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
        "no time left"
      );
      return {
        ok: false,
        error: CUSTOMER_ERROR_MESSAGE,
        status: "skipped",
        provider: currentResolution.provider,
        model: currentResolution.model,
        source: currentResolution.source,
      };
    }

    // Each attempt's timeout = min(task timeout, time left - 2s)
    const effectiveTimeout = Math.max(1, Math.min(baseTaskTimeout, timeLeft - 2000));
    const startMs = Date.now();

    try {
      const answer: ProviderAnswer = await callProviderImpl({
        provider: currentResolution.provider,
        key: currentResolution.key,
        model: currentResolution.model,
        system,
        user,
        schema,
        maxTokens,
        effort: params.effort ?? currentResolution.effort,
        timeoutMs: effectiveTimeout,
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
          `AI skipped: ${answer.skip}`
        );
        return {
          ok: false,
          error: CUSTOMER_ERROR_MESSAGE,
          status: "skipped",
          provider: currentResolution.provider,
          model: currentResolution.model,
          source: currentResolution.source,
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
        null
      );

      // Parse JSON if schema provided or caller expects structured data
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
      const is5xx =
        (err instanceof ProviderCallError && typeof err.status === "number" && err.status >= 500 && err.status < 600) ||
        /\b5\d{2}\b/i.test(err instanceof Error ? err.message : String(err));

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
        lastErrorMsg
      );

      // On 429: read Retry-After / reset header; if wait fits in deadline, wait that long, else proceed to backup / exit
      if (is429) {
        if (attempt < maxAttempts) {
          const retryAfterMs = err instanceof ProviderCallError ? err.retryAfterMs : undefined;
          if (retryAfterMs !== undefined && retryAfterMs > 0) {
            const timeLeftAfterWait = absoluteDeadline - (Date.now() + retryAfterMs);
            if (timeLeftAfterWait >= neededForStep) {
              await wait(retryAfterMs);
              continue;
            }
          }
        }
        // If wait doesn't fit or retries exhausted: do NOT retry same provider. Proceed to fast backup if applicable.
      } else if (attempt < maxAttempts) {
        await wait(300);
        continue;
      }

      // Requirement 5: Provider backup on fast tier for Kestrel tasks only
      // Team-key tasks NEVER use Kestrel's key. Only Kestrel tasks can use Kestrel backup.
      // On 429, timeout or 5xx from primary, try backup once if deadline allows
      if (currentResolution.source === "kestrel" && currentTier === "fast" && (isTimeout || is5xx || is429)) {
        const backupRes = await resolveFastBackup(sb);
        if (
          !("error" in backupRes) &&
          (backupRes.provider !== currentResolution.provider || backupRes.model !== currentResolution.model)
        ) {
          const timeLeftForBackup = absoluteDeadline - Date.now();
          if (timeLeftForBackup >= baseTaskTimeout + 2000) {
            const backupTimeout = Math.max(1, Math.min(baseTaskTimeout, timeLeftForBackup - 2000));
            const backupStartMs = Date.now();
            try {
              const backupAnswer: ProviderAnswer = await callProviderImpl({
                provider: backupRes.provider,
                key: backupRes.key,
                model: backupRes.model,
                system,
                user,
                schema,
                maxTokens,
                effort: "low",
                timeoutMs: backupTimeout,
                history: params.history,
                tools: params.tools,
                runTool: params.runTool,
                images: params.images,
              });

              const bElapsedMs = Date.now() - backupStartMs;
              const bTokensIn = backupAnswer.usage.input_tokens || 0;
              const bTokensOut = backupAnswer.usage.output_tokens || 0;
              const bCost = costOf(backupAnswer.usage, backupRes.provider, backupRes.model);

              await logRunImpl(
                sb,
                teamId,
                userId,
                task,
                backupRes.provider,
                backupRes.model,
                backupRes.source,
                Math.min(attempt, maxAttempts),
                bElapsedMs,
                bTokensIn,
                bTokensOut,
                bCost,
                "fallback",
                null
              );

              let parsedData: unknown = backupAnswer.text;
              if (schema) {
                parsedData = parseJsonObject(backupAnswer.text);
              }

              return {
                ok: true,
                data: parsedData as T,
                text: backupAnswer.text,
                provider: backupRes.provider,
                model: backupRes.model,
                source: backupRes.source,
                tokens_in: bTokensIn,
                tokens_out: bTokensOut,
                cost_usd: bCost,
                ms: bElapsedMs,
              };
            } catch (backupErr: unknown) {
              const bElapsedMs = Date.now() - backupStartMs;
              const bIsTimeout =
                backupErr instanceof ProviderCallError
                  ? backupErr.isTimeout
                  : /timeout|abort/i.test(String(backupErr));
              const bStatus = bIsTimeout ? "timeout" : "error";
              await logRunImpl(
                sb,
                teamId,
                userId,
                task,
                backupRes.provider,
                backupRes.model,
                backupRes.source,
                Math.min(attempt, maxAttempts),
                bElapsedMs,
                0,
                0,
                null,
                bStatus,
                backupErr instanceof Error ? backupErr.message : String(backupErr)
              );
            }
          }
        }
      }

      if (is429) {
        return {
          ok: false,
          error: "Kestrel AI is busy, try again in a minute.",
          status: "error",
          provider: currentResolution.provider,
          model: currentResolution.model,
          source: currentResolution.source,
          lastError: "rate_limited",
          statusCode: 429,
        };
      }
    }
  }

  // If retries exhausted and fallback exists
  if (cfg.fallback) {
    if (cfg.fallback === "skip") {
      return {
        ok: false,
        error: CUSTOMER_ERROR_MESSAGE,
        status: "skipped",
        provider: currentResolution.provider,
        model: currentResolution.model,
        source: currentResolution.source,
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
        "code_checks_only"
      );
      return {
        ok: true,
        data: fallbackData as T,
        text: JSON.stringify(fallbackData),
        provider: currentResolution.provider,
        model: currentResolution.model,
        source: currentResolution.source,
        tokens_in: 0,
        tokens_out: 0,
        cost_usd: null,
        ms: 0,
      };
    }

    if (cfg.fallback === "fast" && currentTier === "strong") {
      const timeLeft = absoluteDeadline - Date.now();
      const fallbackTimeout = 20_000;
      if (timeLeft < fallbackTimeout + 2000) {
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
          "skipped",
          "no time left"
        );
        return {
          ok: false,
          error: CUSTOMER_ERROR_MESSAGE,
          status: "skipped",
          provider: currentResolution.provider,
          model: currentResolution.model,
          source: currentResolution.source,
        };
      }

      const fastRes = await resolveModelForTier(sb, teamId, "fast", task);
      if (!("error" in fastRes)) {
        currentTier = "fast";
        currentResolution = fastRes;
        const effectiveFallbackTimeout = Math.max(1, Math.min(fallbackTimeout, timeLeft - 2000));
        const startMs = Date.now();
        try {
          const answer: ProviderAnswer = await callProviderImpl({
            provider: currentResolution.provider,
            key: currentResolution.key,
            model: currentResolution.model,
            system,
            user,
            schema,
            maxTokens: Math.min(maxTokens, 1500),
            effort: "low",
            timeoutMs: effectiveFallbackTimeout,
            history: params.history,
            tools: params.tools,
            runTool: params.runTool,
            images: params.images,
          });

          const elapsedMs = Date.now() - startMs;
          const tokensIn = answer.usage.input_tokens || 0;
          const tokensOut = answer.usage.output_tokens || 0;
          const cost = costOf(answer.usage, currentResolution.provider, currentResolution.model);

          await logRunImpl(
            sb,
            teamId,
            userId,
            task,
            currentResolution.provider,
            currentResolution.model,
            currentResolution.source,
            1,
            elapsedMs,
            tokensIn,
            tokensOut,
            cost,
            "fallback",
            null
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
            tokens_in: tokensIn,
            tokens_out: tokensOut,
            cost_usd: cost,
            ms: elapsedMs,
          };
        } catch (fallbackErr: unknown) {
          const elapsedMs = Date.now() - startMs;
          const isTimeout =
            fallbackErr instanceof ProviderCallError
              ? fallbackErr.isTimeout
              : /timeout|abort/i.test(String(fallbackErr));
          const status = isTimeout ? "timeout" : "error";
          await logRunImpl(
            sb,
            teamId,
            userId,
            task,
            currentResolution.provider,
            currentResolution.model,
            currentResolution.source,
            1,
            elapsedMs,
            0,
            0,
            null,
            status,
            fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)
          );
        }
      }
    }
  }

  return {
    ok: false,
    error: CUSTOMER_ERROR_MESSAGE,
    status: lastStatus,
    provider: currentResolution.provider,
    model: currentResolution.model,
    source: currentResolution.source,
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
