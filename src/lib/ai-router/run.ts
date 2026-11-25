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
  timeoutMs?: number; // Override for tests or specific short jobs
  // Chat / assistant context
  history?: { role: "user" | "assistant"; content: string }[];
  tools?: { name: string; description: string; schema: Record<string, unknown> }[];
  runTool?: (name: string, input: Record<string, unknown>) => Promise<string>;
  images?: { type: string; data: string }[];
  // Fallback handler for qc or custom
  onCodeChecksOnly?: () => Record<string, unknown>;
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
    };

export const CUSTOMER_ERROR_MESSAGE = "Kestrel AI can't answer right now. Try again in a minute.";

type ModelResolution = {
  provider: Provider;
  model: string;
  key: string;
  source: "team_key" | "kestrel";
  effort?: "low" | "medium" | "high";
};

// Helper: resolve model for a given tier ("fast" vs "strong")
async function resolveModelForTier(
  sb: Sb,
  tier: AiTier,
  task: AiTaskName
): Promise<ModelResolution | { error: string }> {
  const secret = serverSecret();

  // 1. Check if team has its own key saved in Settings / Connections
  try {
    const { data: teamAi } = await sb.from("team_ai").select("*").maybeSingle();
    const provider = (teamAi?.provider as Provider) || null;
    if (provider && secret.length >= 32) {
      const { data: key } = await sb.rpc("ai_key_for_server", {
        server_secret: secret,
        service: provider,
      });
      if (key && typeof key === "string") {
        const pick = modelForTask(
          provider,
          String(teamAi?.model ?? ""),
          tier === "strong" || task === "write" ? "emails" : "score"
        );
        if (pick.model) {
          return {
            provider,
            model: pick.model,
            key,
            source: "team_key",
            effort: pick.effort,
          };
        }
      }
    }
  } catch {
    // ignore and fall back to kestrel
  }

  // 2. Kestrel AI:
  // fast = assistant_included()
  // strong = assistant_config() (Kestrel's Claude)
  if (tier === "fast") {
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
              effort: "low",
            };
          }
        }
      } catch {
        // fall back
      }
    }
    // Default fast: Haiku 5.5
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

  // tier === "strong"
  const claude = await assistantConfig(sb);
  if ("error" in claude) return claude;
  return {
    provider: "anthropic",
    model: SONNET,
    key: claude.key,
    source: "kestrel",
    effort: "medium",
  };
}

// Log one attempt to supabase public.ai_runs via log_ai_run RPC
async function logRun(
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

  const timeoutMs = params.timeoutMs ?? cfg.timeoutMs;
  const maxTokens = params.maxTokens ?? cfg.maxTokens;

  // Resolve initial model by task tier
  const resolution = await resolveModelForTier(sb, cfg.tier, task);
  if ("error" in resolution) {
    return { ok: false, error: CUSTOMER_ERROR_MESSAGE, status: "error" };
  }

  let currentTier: AiTier = cfg.tier;
  let currentResolution: ModelResolution = resolution;

  const maxAttempts = 1 + cfg.retries;
  let lastErrorMsg = "";
  let lastStatus: "timeout" | "error" | "skipped" = "error";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const startMs = Date.now();
    try {
      const answer: ProviderAnswer = await callProvider({
        provider: currentResolution.provider,
        key: currentResolution.key,
        model: currentResolution.model,
        system,
        user,
        schema,
        maxTokens,
        effort: params.effort ?? currentResolution.effort,
        timeoutMs,
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
        await logRun(
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

      await logRun(
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
      const status: "timeout" | "error" = isTimeout ? "timeout" : "error";
      lastStatus = status;
      lastErrorMsg = err instanceof Error ? err.message : String(err);

      await logRun(
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

      if (attempt < maxAttempts) {
        await wait(500 * attempt);
        continue;
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
      await logRun(
        sb,
        teamId,
        userId,
        task,
        currentResolution.provider,
        currentResolution.model,
        currentResolution.source,
        maxAttempts + 1,
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
      const fastRes = await resolveModelForTier(sb, "fast", task);
      if (!("error" in fastRes)) {
        currentTier = "fast";
        currentResolution = fastRes;
        const startMs = Date.now();
        try {
          const answer: ProviderAnswer = await callProvider({
            provider: currentResolution.provider,
            key: currentResolution.key,
            model: currentResolution.model,
            system,
            user,
            schema,
            maxTokens: Math.min(maxTokens, 1500),
            effort: "low",
            timeoutMs: 20_000,
            history: params.history,
            tools: params.tools,
            runTool: params.runTool,
            images: params.images,
          });

          const elapsedMs = Date.now() - startMs;
          const tokensIn = answer.usage.input_tokens || 0;
          const tokensOut = answer.usage.output_tokens || 0;
          const cost = costOf(answer.usage, currentResolution.provider, currentResolution.model);

          await logRun(
            sb,
            teamId,
            userId,
            task,
            currentResolution.provider,
            currentResolution.model,
            currentResolution.source,
            maxAttempts + 1,
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
          await logRun(
            sb,
            teamId,
            userId,
            task,
            currentResolution.provider,
            currentResolution.model,
            currentResolution.source,
            maxAttempts + 1,
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
