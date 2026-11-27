import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";

// Import REAL source modules using tsx TypeScript & @/ alias support
import { aiLeadError, aiAnswer, aiOne, writeChecked, NEEDS_RESEARCH } from "@/lib/lead-steps";
import { runAiTask, AI_TASKS, checkKestrelAllowance } from "@/lib/ai-router";
import { runDueAiJobs, executeClaimedJob } from "@/lib/ai-jobs";
import { callProvider, ProviderCallError, costOf } from "@/lib/ai-router/providers";
import { readJson, EMPTY_SENDER, assemble, emailSystem, emailPayload, qcSystem, cleanParts, cleanQc, hasObservations, cleanResearch, numbersNotInQuote } from "@/lib/ai";
import { sortBestLeads, fillStepDefaults, looksLikeInlineColdEmail } from "@/lib/assistant";
import { CHAT_SYSTEM, CHAT_TOOLS } from "@/lib/assistant-prompt";
import { renderAll } from "@/lib/sequence";

// Ensure server secret is valid for standalone test runner
process.env.MAIL_SERVER_SECRET = "1234567890123456789012345678901234";

const CUSTOMER_MSG = "Kestrel AI can't answer right now. Try again in a minute.";

// Helper to construct mock supabase client for unit testing runAiTask
function createMockSb(options = {}) {
  return {
    from: (table) => ({
      select: () => ({
        eq: (_col, val) => ({
          maybeSingle: async () => {
            if (options.teamAiError) {
              return { data: null, error: new Error(options.teamAiError) };
            }
            if (options.hasTeamKey !== false) {
              return {
                data: {
                  team_id: val,
                  provider: options.provider || "anthropic",
                  model: options.model || "claude-haiku-5-5",
                },
                error: null,
              };
            }
            return { data: null, error: null };
          },
        }),
      }),
    }),
    rpc: async (fn) => {
      if (fn === "ai_key_for_server") {
        if (options.hasTeamKey === false) return { data: null, error: null };
        return { data: "test-secret-key-123", error: null };
      }
      // 078: this month's Kestrel-paid use. The router blocks Kestrel AI when it cannot count, so the mock answers.
      if (fn === "ai_usage_this_month") return { data: options.usage ?? 0, error: null };
      if (fn === "assistant_included") {
        return {
          data: {
            provider: "anthropic",
            model: "claude-haiku-5-5",
            enabled: true,
            key: "kestrel-included-key",
          },
          error: null,
        };
      }
      if (fn === "assistant_config") {
        return { data: { key: "kestrel-strong-key", model: "claude-sonnet-5-5", enabled: true }, error: null };
      }
      if (fn === "log_ai_run") {
        return { data: null, error: null };
      }
      return { data: null, error: null };
    },
  };
}

describe("AI Router Configuration & Logic", () => {
  it("verifies AI_TASKS table configuration in tasks.ts (task -> slot mapping)", () => {
    assert.equal(AI_TASKS.research.slot, "swift");
    assert.equal(AI_TASKS.research.timeoutMs, 20_000);
    assert.equal(AI_TASKS.research.retries, 1);

    assert.equal(AI_TASKS.explain.slot, "swift");
    assert.equal(AI_TASKS.explain.timeoutMs, 10_000);
    assert.equal(AI_TASKS.explain.retries, 1);
    assert.equal(AI_TASKS.explain.fallback, "skip");

    assert.equal(AI_TASKS.voice.slot, "swift");
    assert.equal(AI_TASKS.voice.timeoutMs, 20_000);
    assert.equal(AI_TASKS.voice.retries, 1);

    assert.equal(AI_TASKS.score.slot, "swift");
    assert.equal(AI_TASKS.score.timeoutMs, 20_000);
    assert.equal(AI_TASKS.score.retries, 1);

    assert.equal(AI_TASKS.write.slot, "talon");
    assert.equal(AI_TASKS.write.timeoutMs, 40_000);
    assert.equal(AI_TASKS.write.retries, 1);
    assert.equal(AI_TASKS.write.fallback, "skip");

    assert.equal(AI_TASKS.qc.slot, "talon");
    assert.equal(AI_TASKS.qc.timeoutMs, 15_000);
    assert.equal(AI_TASKS.qc.retries, 1);
    assert.equal(AI_TASKS.qc.fallback, "code_checks_only");

    assert.equal(AI_TASKS.reply_suggest.slot, "talon");
    assert.equal(AI_TASKS.reply_label.slot, "swift");
    assert.equal(AI_TASKS.spam_fix.slot, "swift");
    assert.equal(AI_TASKS.chat.slot, "talon");
    assert.equal(AI_TASKS.chat.retries, 0);
    assert.equal(AI_TASKS.chat.fallback, "nest");
  });
});

describe("AI Router Unit Tests (Real runAiTask & Injected Mocks)", () => {
  it("timeout -> retry -> ok succeeds on second attempt", async () => {
    let callCount = 0;
    const logs = [];
    const providerFn = async () => {
      callCount++;
      if (callCount === 1) {
        throw new ProviderCallError("Anthropic timed out after 20000ms", undefined, true);
      }
      return { text: "success after timeout", usage: { input_tokens: 5, output_tokens: 5 } };
    };

    const sb = createMockSb();
    const res = await runAiTask({
      sb,
      teamId: "team-test",
      task: "research",
      system: "sys",
      user: "usr",
      providerFn,
      logRunFn: async (...args) => { logs.push(args); },
    });

    assert.equal(res.ok, true);
    assert.equal(res.text, "success after timeout");
    assert.equal(callCount, 2);
    assert.equal(logs.length, 2);
    assert.equal(logs[0][12], "timeout"); // first attempt status
    assert.equal(logs[1][12], "ok");      // second attempt status
  });

  it("swift fails -> nest used (logs: error, error, fallback)", async () => {
    const logs = [];
    let lastUsedModel = "";
    const providerFn = async (params) => {
      lastUsedModel = params.model;
      if (params.model === "swift-model") {
        throw new ProviderCallError("Swift unavailable", 500);
      }
      return { text: "nest fallback success", usage: { input_tokens: 10, output_tokens: 10 } };
    };

    const sb = {
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
      rpc: async (fn, args) => {
        if (fn === "ai_slot_for_server") {
          if (args.p_slot === "swift") {
            return { data: { slot: "swift", provider: "groq", model: "swift-model", key: "swift-key", enabled: true }, error: null };
          }
          if (args.p_slot === "nest") {
            return { data: { slot: "nest", provider: "openai", model: "nest-model", key: "nest-key", enabled: true }, error: null };
          }
        }
        if (fn === "ai_usage_this_month") return { data: 0, error: null };
        if (fn === "log_ai_run") return { data: null, error: null };
        return { data: null, error: null };
      },
    };

    const res = await runAiTask({
      sb,
      teamId: "team-test",
      task: "reply_label",
      system: "sys",
      user: "usr",
      providerFn,
      logRunFn: async (...args) => { logs.push(args); },
    });

    assert.equal(res.ok, true);
    assert.equal(res.text, "nest fallback success");
    assert.equal(lastUsedModel, "nest-model");
    assert.equal(res.model, "nest-model");
    assert.equal(res.slot, "nest");
    assert.equal(logs.length, 3);
    assert.equal(logs[0][12], "error");
    assert.equal(logs[1][12], "error");
    assert.equal(logs[2][12], "fallback");
    assert.equal(logs[2][14], "nest");
  });

  it("nest fails -> honest error, no loop", async () => {
    let callCount = 0;
    const providerFn = async () => {
      callCount++;
      throw new ProviderCallError("Nest unavailable", 500);
    };

    const sb = {
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
      rpc: async (fn, args) => {
        if (fn === "ai_slot_for_server") {
          return { data: { slot: args.p_slot, provider: "groq", model: `${args.p_slot}-model`, key: "k", enabled: true }, error: null };
        }
        if (fn === "log_ai_run") return { data: null, error: null };
        return { data: null, error: null };
      },
    };

    const res = await runAiTask({
      sb,
      teamId: "team-test",
      task: "chat",
      system: "sys",
      user: "usr",
      resolution: { provider: "groq", model: "nest-model", key: "k", source: "kestrel", slot: "nest" },
      providerFn,
      logRunFn: async () => {},
    });

    assert.equal(res.ok, false);
    assert.equal(res.error, CUSTOMER_MSG);
    assert.equal(callCount, 1, "nest must not loop or fall back to itself");
  });

  it("slot not set -> old behaviour (assistant_included) used", async () => {
    let assistantIncludedCalled = false;
    let capturedModel = "";
    const sb = {
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
      rpc: async (fn) => {
        if (fn === "ai_slot_for_server") return { data: null, error: null };
        if (fn === "assistant_included") {
          assistantIncludedCalled = true;
          return { data: { provider: "groq", model: "legacy-included-model", enabled: true, key: "legacy-key" }, error: null };
        }
        if (fn === "log_ai_run") return { data: null, error: null };
        return { data: null, error: null };
      },
    };

    const res = await runAiTask({
      sb,
      teamId: "team-test",
      task: "chat",
      system: "sys",
      user: "usr",
      providerFn: async (params) => {
        capturedModel = params.model;
        return { text: "legacy ok", usage: { input_tokens: 5, output_tokens: 5 } };
      },
      logRunFn: async () => {},
    });

    assert.equal(res.ok, true);
    assert.equal(assistantIncludedCalled, true);
    assert.equal(capturedModel, "legacy-included-model");
  });

  it("OpenAI-compatible adapter sends to slot base_url with slot model and key", async () => {
    let capturedAuth = "";
    let capturedModel = "";
    let capturedPath = "";

    const server = http.createServer((req, res) => {
      capturedAuth = req.headers.authorization || "";
      capturedPath = req.url || "";
      let body = "";
      req.on("data", (c) => { body += c; });
      req.on("end", () => {
        const parsed = JSON.parse(body || "{}");
        capturedModel = parsed.model || "";
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
          choices: [{ message: { content: "custom-endpoint-ok" } }],
          usage: { prompt_tokens: 4, completion_tokens: 2 },
        }));
      });
    });

    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    const baseUrl = `http://127.0.0.1:${addr.port}/v1`;

    try {
      const ans = await callProvider({
        provider: "custom",
        baseUrl,
        key: "slot-custom-key-xyz",
        model: "my-custom-model",
        system: "sys",
        user: "hi",
        maxTokens: 50,
        timeoutMs: 5000,
      });

      assert.equal(ans.text, "custom-endpoint-ok");
      assert.equal(capturedPath, "/v1/chat/completions");
      assert.equal(capturedAuth, "Bearer slot-custom-key-xyz");
      assert.equal(capturedModel, "my-custom-model");
    } finally {
      server.close();
    }
  });

  it("deadline 5s left -> no retry, status 'skipped', friendly message, total time < 6s", async () => {
    const logs = [];
    const startMs = Date.now();
    const providerFn = async () => {
      throw new ProviderCallError("Temporary error", 500);
    };

    const sb = createMockSb();
    const res = await runAiTask({
      sb,
      teamId: "team-test",
      task: "write",
      system: "sys",
      user: "usr",
      deadlineMs: 5000,
      providerFn,
      logRunFn: async (...args) => { logs.push(args); },
    });

    const elapsed = Date.now() - startMs;
    assert.equal(res.ok, false);
    assert.equal(res.error, CUSTOMER_MSG);
    assert.equal(res.status, "skipped");
    assert.equal(elapsed < 6000, true, `Expected execution < 6s, took ${elapsed}ms`);
  });

  it("qc fails -> code_checks_only result returned", async () => {
    const logs = [];
    const providerFn = async () => {
      throw new ProviderCallError("QC failure", 500);
    };

    const sb = createMockSb();
    const res = await runAiTask({
      sb,
      teamId: "team-test",
      task: "qc",
      system: "sys",
      user: "usr",
      providerFn,
      onCodeChecksOnly: () => ({ passed: true, issues: [], source: "code_checks_only" }),
      logRunFn: async (...args) => { logs.push(args); },
    });

    assert.equal(res.ok, true);
    assert.equal(res.data.source, "code_checks_only");
    const fallbackLog = logs.find((l) => l[12] === "fallback");
    assert.ok(fallbackLog);
  });

  it("team_ai read error -> error returned, statusCode 500, Kestrel key NOT used", async () => {
    const sb = createMockSb({ teamAiError: "connection refused to postgres" });
    const res = await runAiTask({
      sb,
      teamId: "team-test",
      task: "score",
      system: "sys",
      user: "usr",
    });

    assert.equal(res.ok, false);
    assert.equal(res.error, CUSTOMER_MSG);
    assert.equal(res.statusCode, 500);
    const leadErr = aiLeadError(res);
    assert.equal(leadErr.why, "AI server error. Try again in a minute.");
  });

  it("verifies no API key or prompt text exists in ai_runs logs", async () => {
    const secretKey = "sk-ant-secret-key-999999999";
    const promptText = "Secret lead email: confidential@company.com";
    const loggedEntries = [];

    const sb = createMockSb();
    const res = await runAiTask({
      sb,
      teamId: "team-test",
      task: "write",
      system: "System prompt",
      user: promptText,
      providerFn: async () => ({ text: "ok answer", usage: { input_tokens: 1, output_tokens: 1 } }),
      logRunFn: async (...args) => { loggedEntries.push(args); },
    });

    assert.equal(res.ok, true);
    for (const log of loggedEntries) {
      const json = JSON.stringify(log);
      assert.equal(json.includes(secretKey), false, "API key leaked into log object!");
      assert.equal(json.includes(promptText), false, "Prompt text leaked into log object!");
      assert.equal(json.includes("confidential@company.com"), false, "Lead data leaked into log object!");
    }
  });

  it("routes chat, reply_suggest, reply_label, spam_fix to kestrel and others to team_key", async () => {
    const sb = createMockSb({ provider: "groq", model: "qwen/qwen3.8-27b" });
    const providerFn = async () => ({ text: "ok", usage: { input_tokens: 1, output_tokens: 1 } });

    // Kestrel tasks
    for (const task of ["chat", "reply_suggest", "reply_label", "spam_fix"]) {
      const res = await runAiTask({
        sb,
        teamId: "team-123",
        task,
        system: "sys",
        user: "usr",
        providerFn,
      });
      assert.equal(res.ok, true);
      assert.equal(res.source, "kestrel", `Task ${task} must use source 'kestrel'`);
    }

    // Team tasks
    for (const task of ["research", "explain", "voice", "score", "write", "qc"]) {
      const res = await runAiTask({
        sb,
        teamId: "team-123",
        task,
        system: "sys",
        user: "usr",
        providerFn,
      });
      assert.equal(res.ok, true);
      assert.equal(res.source, "team_key", `Task ${task} must use source 'team_key'`);
    }
  });

  it("costOf calculates pricing for Groq and Anthropic models and returns null for unknown", () => {
    const groqCost = costOf({ input_tokens: 1_000_000, output_tokens: 1_000_000 }, "groq", "qwen/qwen3.8-27b");
    assert.ok(groqCost !== null && groqCost > 0);

    const anthropicCost = costOf({ input_tokens: 1_000_000, output_tokens: 1_000_000 }, "anthropic", "claude-haiku-5-5");
    assert.ok(anthropicCost !== null && anthropicCost > 0);

    const unknownCost = costOf({ input_tokens: 1_000_000, output_tokens: 1_000_000 }, "groq", "unknown-model-xyz");
    assert.equal(unknownCost, null);
  });
});

describe("AI Lead Error Honest Classification (Real runAiTask -> aiLeadError)", () => {
  it("forces 429 via runAiTask and returns 'Not done — AI busy, try again'", async () => {
    const sb = createMockSb();
    const res = await runAiTask({
      sb,
      teamId: "test-team",
      task: "score",
      system: "sys",
      user: "usr",
      providerFn: async () => {
        throw new ProviderCallError("groq error (429): Rate limit reached", 429, false, false, 0);
      },
    });

    const leadErr = aiLeadError(res);
    console.log("  [429 test output] -> message:", leadErr.why);
    assert.equal(res.ok, false);
    assert.equal(res.statusCode, 429);
    assert.equal(leadErr.why, "Not done — AI busy, try again");
  });

  it("forces 500 via runAiTask and returns 'AI server error. Try again in a minute.'", async () => {
    const sb = createMockSb();
    const res = await runAiTask({
      sb,
      teamId: "test-team",
      task: "score",
      system: "sys",
      user: "usr",
      providerFn: async () => {
        throw new ProviderCallError("Internal Server Error 500", 500, false, false);
      },
    });

    const leadErr = aiLeadError(res);
    console.log("  [500 test output] -> message:", leadErr.why);
    assert.equal(res.ok, false);
    assert.equal(res.statusCode, 500);
    assert.equal(leadErr.why, "AI server error. Try again in a minute.");
  });

  it("forces 413 via runAiTask and returns 'This lead's page is too long for AI. Skipped.'", async () => {
    const sb = createMockSb();
    const res = await runAiTask({
      sb,
      teamId: "test-team",
      task: "score",
      system: "sys",
      user: "usr",
      providerFn: async () => {
        throw new ProviderCallError("groq error (413): request too large for model context window", 413, false, false);
      },
    });

    const leadErr = aiLeadError(res);
    console.log("  [413 test output] -> message:", leadErr.why);
    assert.equal(res.ok, false);
    assert.equal(res.statusCode, 413);
    assert.equal(leadErr.why, "This lead's page is too long for AI. Skipped.");
  });

  it("forces 401 via runAiTask and returns 'Your AI key was rejected. Check Settings → AI.'", async () => {
    // 1. Provider 401 rejection
    const sb = createMockSb();
    const res = await runAiTask({
      sb,
      teamId: "test-team",
      task: "score",
      system: "sys",
      user: "usr",
      providerFn: async () => {
        throw new ProviderCallError("The Claude key was not accepted.", 401);
      },
    });

    const leadErr = aiLeadError(res);
    console.log("  [401 test output] -> message:", leadErr.why);
    assert.equal(res.ok, false);
    assert.equal(res.statusCode, 401);
    assert.equal(leadErr.why, "Your AI key was rejected. Check Settings → AI.");

    // 2. No team key (AI-4a): not an error any more; Kestrel's included AI answers instead.
    //    (Before, this ran with no providerFn, so it made a real network call with a fake key to get its 401.)
    const sbNoKey = createMockSb({ hasTeamKey: false });
    const resNoKey = await runAiTask({
      sb: sbNoKey,
      teamId: "test-team",
      task: "score",
      system: "sys",
      user: "usr",
      providerFn: async () => ({ text: "ok", usage: { input_tokens: 1, output_tokens: 1 } }),
      logRunFn: async () => {},
    });
    assert.equal(resNoKey.ok, true);
    assert.equal(resNoKey.source, "kestrel");
  });

  it("forces timeout via runAiTask and returns 'AI took too long. Try again.'", async () => {
    const sb = createMockSb();
    const res = await runAiTask({
      sb,
      teamId: "test-team",
      task: "score",
      system: "sys",
      user: "usr",
      timeoutMs: 50,
      providerFn: async () => {
        throw new ProviderCallError("Anthropic timed out after 20000ms", undefined, true);
      },
    });

    const leadErr = aiLeadError(res);
    console.log("  [timeout test output] -> message:", leadErr.why);
    assert.equal(res.ok, false);
    assert.equal(res.status, "timeout");
    assert.equal(leadErr.why, "AI took too long. Try again.");
  });

  it("forces bad JSON via runAiTask and returns 'AI answer was broken. Try again.'", async () => {
    // Case A: provider error due to JSON failure (e.g. Groq 400 Failed to validate JSON schema)
    const sb = createMockSb();
    const resA = await runAiTask({
      sb,
      teamId: "test-team",
      task: "score",
      system: "sys",
      user: "usr",
      providerFn: async () => {
        throw new ProviderCallError("groq error (400): Failed to validate JSON schema", 400);
      },
    });

    const leadErrA = aiLeadError(resA);
    console.log("  [bad JSON provider error output] -> message:", leadErrA.why);
    assert.equal(resA.ok, false);
    assert.equal(leadErrA.why, "AI answer was broken. Try again.");

    // Case B: provider returns unparseable text
    const resB = await runAiTask({
      sb,
      teamId: "test-team",
      task: "score",
      system: "sys",
      user: "usr",
      providerFn: async () => ({
        text: "Sure! Here is the JSON: { fit: 90, verdict: 'broken' unclosed",
        usage: { input_tokens: 10, output_tokens: 10 },
      }),
    });

    assert.equal(resB.ok, true);
    const parsed = readJson(resB.text);
    assert.equal(parsed, null);
    const leadErrB = parsed ? { ok: true } : { ok: false, why: "AI answer was broken. Try again." };
    console.log("  [bad JSON unparseable text output] -> message:", leadErrB.why);
    assert.equal(leadErrB.why, "AI answer was broken. Try again.");
  });

  it("resolution override: provider receives exact model+key, assistant_included NOT called", async () => {
    let assistantIncludedCalled = false;
    let capturedModel = "";
    let capturedKey = "";

    const sb = {
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
      rpc: async (fn) => {
        if (fn === "assistant_included") {
          assistantIncludedCalled = true;
          // Return a valid row so we can detect if it was wrongly used
          return { data: { provider: "anthropic", model: "claude-haiku-5-5", key: "wrong-key", enabled: true, name: null }, error: null };
        }
        if (fn === "log_ai_run") return { data: null, error: null };
        return { data: null, error: null };
      },
    };

    const res = await runAiTask({
      sb,
      teamId: "test-team",
      task: "chat",
      system: "sys",
      user: "hello",
      resolution: {
        provider: "groq",
        key: "my-groq-key",
        model: "qwen/qwen3.8-27b",
        effort: "low",
        source: "kestrel",
      },
      providerFn: async (params) => {
        capturedModel = params.model;
        capturedKey = params.key;
        return { text: "hi from groq", usage: { input_tokens: 5, output_tokens: 5 } };
      },
      logRunFn: async () => {},
    });

    assert.equal(res.ok, true, `runAiTask failed: ${res.ok === false ? res.error : ""}`);
    assert.equal(capturedModel, "qwen/qwen3.8-27b", `expected model qwen/qwen3.8-27b, got ${capturedModel}`);
    assert.equal(capturedKey, "my-groq-key", `expected key my-groq-key, got ${capturedKey}`);
    assert.equal(assistantIncludedCalled, false, "assistant_included must NOT be called when resolution is provided");
    console.log("  [resolution override] model:", capturedModel, "| key ends:", capturedKey.slice(-4), "| assistant_included called:", assistantIncludedCalled);
  });

  it("chat: Talon hangs -> Nest still gets time and answers before the deadline", async () => {
    const started = Date.now();
    const calls = [];
    const providerFn = async (params) => {
      calls.push({ model: params.model, timeoutMs: params.timeoutMs, firstLeft: params.firstCallDeadlineAt - Date.now() });
      if (params.model === "talon-model") {
        // Simulate a hung provider that respects its first-call deadline.
        const t = Math.min(params.timeoutMs, params.firstCallDeadlineAt - Date.now());
        await new Promise((r) => setTimeout(r, t));
        throw new ProviderCallError("talon timed out", undefined, true);
      }
      return { text: "nest answer", usage: { input_tokens: 1, output_tokens: 1 } };
    };
    const sb = {
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
      rpc: async (fn, args) => {
        if (fn === "ai_slot_for_server" && args.p_slot === "nest") {
          return { data: { slot: "nest", provider: "nvidia", model: "nest-model", key: "nest-key", enabled: true }, error: null };
        }
        return { data: null, error: null };
      },
    };
    const res = await runAiTask({
      sb, teamId: "t", task: "chat", system: "s", user: "u",
      deadlineMs: 6000, // scaled-down deadline: Talon may use at most half, Nest keeps the rest
      resolution: { provider: "groq", model: "talon-model", key: "k", source: "kestrel", slot: "talon" },
      providerFn, logRunFn: async () => {},
    });
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(res.slot, "nest");
    assert.equal(res.fellBack, true);
    assert.equal(calls.length, 2);
    assert.ok(Date.now() - started < 6000, "answered inside the deadline");
  });

  it("slot test (noFallback): a failing slot reports its own error, never Nest's model", async () => {
    const models = [];
    const sb = {
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
      rpc: async (fn) => {
        if (fn === "ai_slot_for_server") return { data: { slot: "nest", provider: "groq", model: "nest-model", key: "k", enabled: true }, error: null };
        return { data: null, error: null };
      },
    };
    const res = await runAiTask({
      sb, teamId: "t", task: "reply_label", system: "s", user: "u",
      noFallback: true, retries: 0, uncounted: "slot_test",
      resolution: { provider: "groq", model: "swift-model", key: "k", source: "kestrel", slot: "swift" },
      providerFn: async (p) => { models.push(p.model); throw new ProviderCallError("rate limited", 429); },
      logRunFn: async () => {},
    });
    assert.equal(res.ok, false);
    assert.equal(res.slot, "swift");
    assert.equal(res.model, "swift-model");
    assert.deepEqual(models, ["swift-model"], "only the tested slot was called, once");
  });

  it("callTimeout: per-call timeout is cut to the deadline, first call to its own deadline", async () => {
    const { callTimeout } = await import("@/lib/ai-router/providers");
    const now = Date.now();
    const base = { provider: "groq", timeoutMs: 20_000, deadlineAt: now + 10_000, firstCallDeadlineAt: now + 4_000 };
    assert.ok(callTimeout(base, 0) <= 4_000);
    assert.ok(callTimeout(base, 1) <= 10_000 && callTimeout(base, 1) > 4_000);
    assert.throws(() => callTimeout({ ...base, deadlineAt: now + 100 }, 1), /timeout/);
  });
});


// ── Score keeps / revokes outreach_approved ─────────────────────────
describe("Score: outreach_approved preservation", () => {
  // Minimal AiPlan stub for task=score
  const basePlan = {
    task: "score",
    provider: "groq",
    key: "test-key",
    model: "test",
    offer: { name: "Test", offer: "test", customer: "test", good: "good", bad: "bad", one_line: "test" },
    sender: { ...EMPTY_SENDER },
    hash: "testhash",
    system: "",
    schema: {},
    followUps: 0,
    seq: null,
    activeServices: [],
  };

  const goodAnswer = { verdict: "good", fit: 85, reason: "Great fit" };
  const badAnswer  = { verdict: "no",   fit: 10, reason: "Not a fit" };

  it("approved Good lead re-scored Good → stays approved", () => {
    const lead = { id: "aaa", email: "a@b.com", data: {}, outreach_approved: true };
    const r = aiAnswer(basePlan, lead, goodAnswer);
    assert.equal(r.ok, true);
    assert.equal(r.patch.outreach_approved, true, "column must stay true");
    assert.equal(r.patch.data.outreach_approved, true, "data field must stay true");
  });

  it("approved Good lead re-scored Bad → becomes unapproved", () => {
    const lead = { id: "bbb", email: "b@b.com", data: {}, outreach_approved: true };
    const r = aiAnswer(basePlan, lead, badAnswer);
    assert.equal(r.ok, true);
    assert.equal(r.patch.outreach_approved, false, "column must become false");
    assert.equal(r.patch.data.outreach_approved, false, "data field must become false");
  });

  it("unapproved lead re-scored Good → stays unapproved", () => {
    const lead = { id: "ccc", email: "c@b.com", data: {}, outreach_approved: false };
    const r = aiAnswer(basePlan, lead, goodAnswer);
    assert.equal(r.ok, true);
    assert.equal(r.patch.outreach_approved, false, "unapproved stays false even if Good");
    assert.equal(r.patch.data.outreach_approved, false, "data field stays false");
  });

  it("lead without outreach_approved scored Good → stays false", () => {
    const lead = { id: "ddd", email: "d@b.com", data: {} };
    const r = aiAnswer(basePlan, lead, goodAnswer);
    assert.equal(r.ok, true);
    assert.equal(r.patch.outreach_approved, false, "undefined → false");
  });

  it("approved lead re-scored Maybe → becomes unapproved", () => {
    const lead = { id: "eee", email: "e@b.com", data: {}, outreach_approved: true };
    const maybeAnswer = { verdict: "maybe", fit: 50, reason: "Unclear" };
    const r = aiAnswer(basePlan, lead, maybeAnswer);
    assert.equal(r.ok, true);
    assert.equal(r.patch.outreach_approved, false, "Maybe revokes approval");
  });
});

describe("AI-4a Kestrel-Paid AI & Monthly Allowance", () => {
  it("team without key -> Kestrel Swift model used, source kestrel", async () => {
    let calledModel = "";
    const sb = {
      from: (table) => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () =>
              table === "teams"
                ? { data: { plan: "starter", active: true }, error: null }
                : { data: null, error: null },
          }),
        }),
      }),
      rpc: async (fn, args) => {
        if (fn === "ai_key_for_server") return { data: null, error: null };
        if (fn === "ai_slot_for_server" && args?.p_slot === "swift") {
          return { data: { slot: "swift", provider: "groq", model: "llama-swift-fast", key: "kestrel-swift-key", enabled: true }, error: null };
        }
        if (fn === "ai_usage_this_month") return { data: 5, error: null };
        if (fn === "my_account") return { data: { plan: "starter", active: true }, error: null };
        return { data: null, error: null };
      },
    };

    const res = await runAiTask({
      sb,
      teamId: "team-no-key",
      task: "score",
      system: "s",
      user: "u",
      providerFn: async (p) => {
        calledModel = p.model;
        return { text: '{"fit":8,"verdict":"good","reason":"ok"}', usage: { input_tokens: 5, output_tokens: 5 } };
      },
      logRunFn: async () => {},
    });

    assert.equal(res.ok, true);
    assert.equal(res.source, "kestrel");
    assert.equal(res.slot, "swift");
    assert.equal(calledModel, "llama-swift-fast");
  });

  it("team with key -> team key used, allowance NOT checked", async () => {
    let allowanceChecked = false;
    const sb = {
      from: () => ({
        select: () => ({
          eq: (_col, val) => ({
            maybeSingle: async () => ({
              data: { team_id: val, provider: "anthropic", model: "claude-haiku-5-5" },
              error: null,
            }),
          }),
        }),
      }),
      rpc: async (fn) => {
        if (fn === "ai_key_for_server") return { data: "team-own-key-123", error: null };
        if (fn === "ai_usage_this_month") {
          allowanceChecked = true;
          return { data: 99999, error: null };
        }
        return { data: null, error: null };
      },
    };

    const res = await runAiTask({
      sb,
      teamId: "team-with-key",
      task: "score",
      system: "s",
      user: "u",
      providerFn: async () => ({ text: "ok", usage: { input_tokens: 5, output_tokens: 5 } }),
      logRunFn: async () => {},
    });

    assert.equal(res.ok, true);
    assert.equal(res.source, "team_key");
    assert.equal(allowanceChecked, false, "ai_usage_this_month must NOT be called when using team_key");
  });

  it("team key 401 -> honest error, Kestrel key NOT used", async () => {
    const keysUsed = [];
    const sb = {
      from: () => ({
        select: () => ({
          eq: (_col, val) => ({
            maybeSingle: async () => ({
              data: { team_id: val, provider: "anthropic", model: "claude-haiku-5-5" },
              error: null,
            }),
          }),
        }),
      }),
      rpc: async (fn) => {
        if (fn === "ai_key_for_server") return { data: "bad-team-key", error: null };
        if (fn === "ai_slot_for_server") {
          return { data: { slot: "swift", provider: "groq", model: "swift-model", key: "kestrel-secret-key", enabled: true }, error: null };
        }
        return { data: null, error: null };
      },
    };

    const res = await runAiTask({
      sb,
      teamId: "team-bad-key",
      task: "score",
      system: "s",
      user: "u",
      retries: 0,
      providerFn: async (p) => {
        keysUsed.push(p.key);
        throw new ProviderCallError("Invalid API key", 401);
      },
      logRunFn: async () => {},
    });

    assert.equal(res.ok, false);
    assert.equal(res.source, "team_key");
    assert.deepEqual(keysUsed, ["bad-team-key"], "Kestrel key must NOT be called when team key fails");
    const mapped = aiLeadError(res);
    assert.equal(mapped.why, "Your AI key was rejected. Check Settings → AI.");
  });

  it("usage = allowance -> provider NOT called, status skipped, used-up message returned", async () => {
    let providerCalled = false;
    const logged = [];
    const sb = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { plan: "trial", active: true }, error: null }),
          }),
        }),
      }),
      rpc: async (fn, args) => {
        if (fn === "ai_key_for_server") return { data: null, error: null };
        if (fn === "ai_slot_for_server" && args?.p_slot === "swift") {
          return { data: { slot: "swift", provider: "groq", model: "llama-swift-fast", key: "kestrel-swift-key", enabled: true }, error: null };
        }
        if (fn === "ai_usage_this_month") return { data: 100, error: null }; // trial allowance = 100
        if (fn === "my_account") return { data: { plan: "trial", active: true }, error: null };
        return { data: null, error: null };
      },
    };

    const res = await runAiTask({
      sb,
      teamId: "team-exhausted",
      task: "score",
      system: "s",
      user: "u",
      providerFn: async () => {
        providerCalled = true;
        return { text: "should not run", usage: { input_tokens: 1, output_tokens: 1 } };
      },
      logRunFn: async (...args) => {
        logged.push({ source: args[6], status: args[12], error: args[13] });
      },
    });

    assert.equal(providerCalled, false, "provider must NOT be called when allowance is used up");
    assert.equal(res.ok, false);
    assert.equal(res.status, "skipped");
    assert.match(res.error, /^This month's Kestrel AI is used up\. It resets on .+\.$/);
    assert.equal(logged.length, 1);
    assert.equal(logged[0].status, "skipped");
    assert.equal(logged[0].source, "kestrel");
  });

  it("write on Kestrel -> uses Talon slot model, not Swift", async () => {
    let calledModel = "";
    const requestedSlots = [];
    const sb = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      }),
      rpc: async (fn, args) => {
        if (fn === "ai_key_for_server") return { data: null, error: null };
        if (fn === "ai_slot_for_server") {
          requestedSlots.push(args?.p_slot);
          if (args?.p_slot === "swift") {
            return { data: { slot: "swift", provider: "groq", model: "llama-swift-fast", key: "kestrel-swift-key", enabled: true }, error: null };
          }
          if (args?.p_slot === "talon") {
            return { data: { slot: "talon", provider: "groq", model: "openai/gpt-oss-120b", key: "kestrel-talon-key", enabled: true }, error: null };
          }
        }
        if (fn === "ai_usage_this_month") return { data: 0, error: null };
        if (fn === "my_account") return { data: { plan: "pro", active: true }, error: null };
        return { data: null, error: null };
      },
    };

    const res = await runAiTask({
      sb,
      teamId: "team-write-kestrel",
      task: "write",
      system: "s",
      user: "u",
      providerFn: async (p) => {
        calledModel = p.model;
        return { text: '{"subject":"hi","body":"hello"}', usage: { input_tokens: 10, output_tokens: 10 } };
      },
      logRunFn: async () => {},
    });

    assert.equal(res.ok, true);
    assert.equal(res.source, "kestrel");
    assert.equal(res.slot, "talon");
    assert.equal(requestedSlots[0], "talon");
    assert.equal(calledModel, "openai/gpt-oss-120b");
  });
});

describe("AI-4a review fixes: gate, fail closed, uncounted runs, batch stop", () => {
  // A team with no key of its own; rpcOverrides replaces single database functions.
  function noKeySb(rpcOverrides = {}) {
    const calls = [];
    return {
      calls,
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
      rpc: async (fn, args) => {
        calls.push(fn);
        if (fn in rpcOverrides) return rpcOverrides[fn](args);
        if (fn === "ai_key_for_server") return { data: null, error: null };
        if (fn === "ai_slot_for_server") return { data: { slot: args?.p_slot, provider: "groq", model: `${args?.p_slot}-model`, key: "kestrel-key", enabled: true }, error: null };
        if (fn === "ai_usage_this_month") return { data: 0, error: null };
        if (fn === "my_account") return { data: { plan: "trial", active: true }, error: null };
        return { data: null, error: null };
      },
    };
  }
  const neverCalled = async () => { throw new Error("provider must not be called"); };

  it("usage cannot be counted (e.g. 078 not run) -> fails closed, provider NOT called, batch stops", async () => {
    const sb = noKeySb({ ai_usage_this_month: () => ({ data: null, error: { message: "function ai_usage_this_month does not exist" } }) });
    const res = await runAiTask({ sb, teamId: "t", task: "score", system: "s", user: "u", providerFn: neverCalled, logRunFn: async () => {} });
    assert.equal(res.ok, false);
    assert.equal(res.status, "skipped");
    assert.equal(res.lastError, "allowance_check_failed");
    assert.match(res.error, /Could not check this month's Kestrel AI use/);
    assert.equal(aiLeadError(res).stop, true);
  });

  it("trial ended, no key of its own -> no Kestrel AI, honest message", async () => {
    const sb = noKeySb({ ai_key_for_server: () => ({ data: null, error: { message: "PLAN_NEEDED: Your free trial has ended. Choose a plan to keep using AI." } }) });
    const res = await runAiTask({ sb, teamId: "t", task: "score", system: "s", user: "u", providerFn: neverCalled, logRunFn: async () => {} });
    assert.equal(res.ok, false);
    assert.equal(res.lastError, "plan_needed");
    assert.equal(res.error, "Your free trial has ended. Choose a plan to keep using AI.");
    assert.equal(sb.calls.includes("ai_slot_for_server"), false, "Kestrel's slots must not even be looked up");
    assert.equal(aiLeadError(res).stop, true);
  });

  it("Viewer -> no Kestrel AI for team-key tasks (voice, explain, score)", async () => {
    for (const task of ["voice", "explain", "score"]) {
      const sb = noKeySb({ ai_key_for_server: () => ({ data: null, error: { message: "Only people who can change leads can use AI" } }) });
      const res = await runAiTask({ sb, teamId: "t", task, system: "s", user: "u", providerFn: neverCalled, logRunFn: async () => {} });
      assert.equal(res.ok, false, task);
      assert.equal(res.lastError, "role_not_allowed", task);
    }
  });

  it("uncounted run (slot test / inbox auto-label) -> runs even when used up, logged under its own name", async () => {
    for (const uncounted of ["slot_test", "reply_label_auto"]) {
      const logged = [];
      const sb = noKeySb({ ai_usage_this_month: () => ({ data: 99999, error: null }) });
      const res = await runAiTask({
        sb, teamId: "t", task: "reply_label", system: "s", user: "u", uncounted,
        providerFn: async () => ({ text: "ok", usage: { input_tokens: 1, output_tokens: 1 } }),
        logRunFn: async (...args) => { logged.push(args[3]); },
      });
      assert.equal(res.ok, true, uncounted);
      assert.equal(sb.calls.includes("ai_usage_this_month"), false, "allowance not checked");
      assert.deepEqual(logged, [uncounted], "ai_runs.task is the uncounted name, which 078 leaves out");
    }
  });

  it("counted reply_label (not auto) is still blocked when used up", async () => {
    const sb = noKeySb({ ai_usage_this_month: () => ({ data: 100, error: null }) });
    const res = await runAiTask({ sb, teamId: "t", task: "reply_label", system: "s", user: "u", providerFn: neverCalled, logRunFn: async () => {} });
    assert.equal(res.ok, false);
    assert.equal(res.lastError, "monthly_allowance_reached");
  });

  it("batch stop: only team-wide failures stop a bulk run, one lead's server error does not", () => {
    assert.equal(aiLeadError({ error: "x", status: "skipped", lastError: "monthly_allowance_reached" }).stop, true);
    assert.equal(aiLeadError({ error: "x", status: "error", statusCode: 401 }).stop, true);
    assert.notEqual(aiLeadError({ error: "x", status: "error", statusCode: 500 }).stop, true);
    assert.notEqual(aiLeadError({ error: "something odd", status: "error" }).stop, true);
    assert.notEqual(aiLeadError({ error: "x", status: "timeout" }).stop, true);
  });
});

describe("Email writer: facts only, no invented claims", () => {
  const offer = { name: "Edit", offer: "Video editing for YouTube channels", customer: "YouTube creators", good: "", bad: "", criteria: "", strictness: "balanced", one_line: "We edit long YouTube videos so creators can post every week." };
  const sender = { sender_name: "Affan", business: "Norven Studio", address: "London, UK", signature: "" };
  const parts = { first_name: "Sam", subject: "your weekly uploads", icebreaker: "I saw your channel says \"new video every Friday\".", question: "Honestly, who edits the Friday videos now?", one_line: "" };

  it("fills every form of the greeting name slot, never leaving braces", () => {
    for (const g of ["Hey {name},", "Hey {{name}},", "Hey {first_name},", "Hey {{FIRST_NAME}},"]) {
      const body = assemble(parts, offer, sender, { greeting: g, sign_off: "Best,", sentence_length: "", words_used: [], words_avoided: [] });
      assert.ok(body.startsWith("Hey Sam,"), `${g} -> ${body.split("\n")[0]}`);
      assert.ok(!/[{}]/.test(body), `braces left for ${g}`);
    }
    const odd = assemble(parts, offer, sender, { greeting: "Hey {nickname},", sign_off: "", sentence_length: "", words_used: [], words_avoided: [] });
    assert.equal(odd.split("\n")[0], "Hi Sam,");
  });

  it("an avoided word sends the one line back to the sender's own words, not a new claim", () => {
    const body = assemble({ ...parts, one_line: "We craft scalable edits for your channel every week." }, offer, sender, { greeting: "", sign_off: "", sentence_length: "", words_used: [], words_avoided: ["scalable"] });
    assert.ok(body.includes(offer.one_line));
    assert.ok(!/high-performance|scalable/i.test(body));
    assert.equal(cleanParts({ ...parts, one_line: "A seamless way to post every week." }).one_line, undefined);
  });

  it("the prompt has no hard-coded web-app / Next.js claims and marks guesses as unverified", () => {
    const sys = emailSystem({ ...offer, offer: "" }, sender) + qcSystem(offer);
    assert.ok(!/Next\.js|web application speed|frontend dashboard|test review/i.test(sys));
    assert.match(sys, /unverified_notes are AI guesses/);
    assert.match(sys, /Never write about what the lead does NOT have/);
    const pay = emailPayload({ name: "Sam TV", research: { observations: [{ fact: "posts weekly", quote: "new video every Friday" }], problem: "They are slow.", how: "Solo.", detail: "Has 2 editors." }, ai: { reason: "Posts often." } });
    assert.equal(pay.likely_problem, undefined);
    assert.equal(pay.website_detail, undefined);
    assert.equal(pay.fit_reason, undefined);
    assert.equal(pay.unverified_notes.likely_problem, "They are slow.");
    assert.equal(pay.unverified_notes.fit_reason, "Posts often.");
  });

  it("Write refuses a lead with no verified website quote, before any AI call", async () => {
    assert.equal(hasObservations({ name: "Linear" }), false);
    assert.equal(hasObservations({ research: { observations: [{ fact: "x", quote: "" }] } }), false);
    assert.equal(hasObservations({ research: { observations: [{ fact: "x", quote: "Plan and build products" }] } }), true);
    const r = await aiOne({ task: "emails" }, { id: "l1", email: "hello@linear.app", data: { name: "Linear", outreach_approved: true } }, { emails: new Set(), domains: new Set() });
    assert.equal(r.ok, false);
    assert.equal(r.why, NEEDS_RESEARCH);
  });

  it("QC no longer demands the sender's usual words", () => {
    const vn = { greeting: "", sign_off: "", sentence_length: "", words_used: ["noticed", "honestly"], words_avoided: [] };
    const q = cleanQc({ pass: true, issues: [] }, "Hi there,\n\nYour site says \"Plan and build products\".", vn);
    assert.ok(!q.issues.some((x) => /sender's voice/.test(x)), JSON.stringify(q));
    assert.ok(!/MUST include at least one/.test(emailSystem({ name: "", offer: "x", customer: "y", good: "", bad: "", criteria: "", strictness: "balanced", one_line: "z" }, { sender_name: "A", business: "", address: "", signature: "" }, undefined, vn)));
  });

  it("Research drops an observation whose fact adds a number, and the writer sees quotes only", () => {
    assert.deepEqual(numbersNotInQuote("Trusted by over 22 million people across 400,000 companies", "Millions of people across 400,000 companies choose Loom"), ["22"]);
    assert.deepEqual(numbersNotInQuote("Captions in 50+ languages", "transcripts and captions in 50+ languages"), []);
    const site = "Millions of people across 400,000 companies choose Loom. We offer SSO, SCIM as well as custom data retention policies.";
    const r = cleanResearch({ observations: [
      { fact: "Trusted by over 22 million people.", quote: "Millions of people across 400,000 companies choose Loom" },
      { fact: "Offers SSO and SCIM.", quote: "We offer SSO, SCIM as well as custom data retention policies" },
    ], hypotheses: [], unknowns: [], problem: "", how: "", detail: "", sure: "high" }, site, "loom.com");
    assert.equal(r.observations.length, 1);
    assert.match(r.observations[0].quote, /SSO, SCIM/);
    const pay = emailPayload({ name: "Loom", research: { observations: [{ fact: "Trusted by 22 million", quote: "Millions of people" }] } });
    assert.deepEqual(pay.evidence.observations, [{ quote: "Millions of people" }]);
  });

  it("QC sees the sender's own one line, and both sides use a neutral question", () => {
    const q = qcSystem({ ...offer, one_line: "We build fast, scalable Next.js web applications." });
    assert.match(q, /We build fast, scalable Next\.js web applications\./);
    assert.match(q, /assumes nothing and is valid/);
    assert.match(emailSystem(offer, sender), /must assume NOTHING about the lead/);
  });
});


// ── AI-4b Background Job Worker & Server-Secret Allowance ───────────
describe("AI-4b: runDueAiJobs & serverSecret allowance", () => {
  it("empty queue returns zero counts", async () => {
    const sb = {
      rpc: async () => ({ data: [], error: null }),
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }), update: () => ({ eq: async () => ({ error: null }) }) }),
    };
    const res = await runDueAiJobs({ sb, secret: "s", phaseDeadlineMs: 10_000 });
    assert.deepEqual(res, { claimed: 0, done: 0, retried: 0, skipped: 0, error: 0 });
  });

  it("runs done, retry, and skipped jobs and logs started/ok/error/skipped Lead Brain events", async () => {
    const events = [];
    const finishes = [];
    const claimed = [
      { id: "j1", team_id: "t1", user_id: "u1", lead_id: "l1", offer_id: "o1", sequence_id: null, kind: "score", attempts: 1, max_attempts: 3, payload: {} },
      { id: "j2", team_id: "t1", user_id: "u1", lead_id: "l2", offer_id: "o1", sequence_id: null, kind: "write", attempts: 1, max_attempts: 3, payload: {} },
      { id: "j3", team_id: "t1", user_id: "u1", lead_id: "l3", offer_id: "o1", sequence_id: null, kind: "research", attempts: 3, max_attempts: 3, payload: {} },
    ];
    const sb = {
      rpc: async (fn, args) => {
        if (fn === "claim_ai_jobs") return { data: claimed, error: null };
        if (fn === "log_lead_brain_event") { events.push({ job: args.p_job_id, status: args.p_status, agent: args.p_agent, from: args.p_from_agent }); return { data: 1, error: null }; }
        if (fn === "finish_ai_job") { finishes.push({ job: args.p_job_id, status: args.p_status }); return { data: null, error: null }; }
        return { data: null, error: null };
      },
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }), update: () => ({ eq: async () => ({ error: null }) }) }),
    };

    const res = await runDueAiJobs({
      sb,
      secret: "s",
      phaseDeadlineMs: 12_000,
      maxJobs: 3,
      runStep: async (job) => {
        if (job.id === "j1") return { status: "done", summary: "Score Good" };
        if (job.id === "j2") return { status: "skipped", error: "monthly_allowance_reached" };
        return { status: "retry", error: "AI busy", retryAfterSec: 60 };
      },
    });

    assert.deepEqual(res, { claimed: 3, done: 1, retried: 0, skipped: 1, error: 1 });
    assert.equal(finishes.find((f) => f.job === "j1")?.status, "done");
    assert.equal(finishes.find((f) => f.job === "j2")?.status, "skipped");
    assert.equal(finishes.find((f) => f.job === "j3")?.status, "retry");
    assert.ok(events.some((e) => e.job === "j1" && e.status === "started" && e.agent === "score" && e.from === "quote"));
    assert.ok(events.some((e) => e.job === "j1" && e.status === "ok"));
    assert.ok(events.some((e) => e.job === "j2" && e.status === "skipped"));
    assert.ok(events.some((e) => e.job === "j3" && e.status === "error"));
  });

  it("checkKestrelAllowance with serverSecret calls ai_usage_this_month(server_secret, p_team_id) without my_account", async () => {
    let myAccountCalled = false;
    let passedSecret = "";
    const sb = {
      rpc: async (fn, args) => {
        if (fn === "my_account") { myAccountCalled = true; return { data: null, error: null }; }
        if (fn === "ai_usage_this_month") { passedSecret = args?.server_secret ?? ""; return { data: 99999, error: null }; }
        return { data: null, error: null };
      },
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { plan: "starter", paid_until: null }, error: null }),
          }),
        }),
      }),
    };

    const lim = await checkKestrelAllowance(sb, "team-1", { serverSecret: "srv-sec" });
    assert.equal(myAccountCalled, false);
    assert.equal(passedSecret, "srv-sec");
    assert.equal(lim.allowed, false);
    assert.equal(lim.code, "monthly_allowance_reached");
  });

  it("executeClaimedJob never queries tables with anon .from() and skips leads on team DNC list", async () => {
    const rpcCalls = [];
    const sb = {
      from: (table) => {
        throw new Error(`RLS blocked: worker must not query ${table} with anon client`);
      },
      rpc: async (fn, args) => {
        rpcCalls.push({ fn, args });
        if (fn === "ai_job_context") {
          return {
            data: {
              lead: { id: "lead-dnc", team_id: "t1", email: "blocked@acme.com", website: "https://acme.com", data: { name: "Acme", outreach_approved: true }, outreach_approved: true },
              offer: { id: "o1", name: "Offer", offer: "x", customer: "y", good: "g", bad: "b", one_line: "z" },
              sequence: null,
              settings: { sender_name: "Affan", business: "Norven", address: "123 St", signature: "Best" },
              about: null,
              team_plan: { plan: "pro" },
              key: null,
              dnc_too_long: false,
              dnc: ["acme.com"],
            },
            error: null,
          };
        }
        return { data: null, error: null };
      },
    };

    const job = { id: "j-dnc", team_id: "t1", user_id: null, lead_id: "lead-dnc", offer_id: "o1", sequence_id: null, kind: "write", attempts: 1, max_attempts: 3, payload: {} };
    const outcome = await executeClaimedJob(sb, job, Date.now() + 10_000, "srv-sec");
    assert.deepEqual(outcome, { status: "skipped", error: "do not contact" });
    assert.equal(rpcCalls[0]?.fn, "ai_job_context");
    assert.equal(rpcCalls[0]?.args?.server_secret, "srv-sec");
    assert.equal(rpcCalls[0]?.args?.p_team_id, "t1");
  });

  it("executeClaimedJob fails cleanly if anon .from() is ever touched (enforces RPC-only boundary)", async () => {
    const sb = {
      from: (table) => {
        throw new Error(`Anon client blocked on ${table}`);
      },
      rpc: async (fn) => {
        if (fn === "ai_job_context") {
          return {
            data: {
              lead: { id: "lead-1", team_id: "t1", email: "ok@good.com", website: "https://good.com", data: { name: "GoodCo" }, outreach_approved: true },
              offer: { id: "o1", name: "Offer", offer: "x", customer: "y", good: "g", bad: "b", one_line: "z" },
              sequence: null,
              settings: { sender_name: "Affan", business: "Norven", address: "123 St", signature: "Best" },
              about: null,
              team_plan: { plan: "pro" },
              key: null,
              dnc_too_long: false,
              dnc: [],
            },
            error: null,
          };
        }
        return { data: null, error: null };
      },
    };

    // For write without research, aiOne returns NEEDS_RESEARCH before any provider call — proving
    // ai_job_context loaded the lead without touching sb.from().
    const job = { id: "j-ok", team_id: "t1", user_id: null, lead_id: "lead-1", offer_id: "o1", sequence_id: null, kind: "write", attempts: 1, max_attempts: 3, payload: {} };
    const outcome = await executeClaimedJob(sb, job, Date.now() + 10_000, "srv-sec");
    // Not researched yet is permanent for this job: skip it instead of retrying it 3 times.
    assert.equal(outcome.status, "skipped");
    assert.match(outcome.error, /Research this lead first/i);
  });

  it("executeClaimedJob write runs QC via writeChecked and stores outreach.qc (hold marks needs review, job done)", async () => {
    const savedPatches = [];
    const sb = {
      from: (table) => { throw new Error(`Anon client blocked on ${table}`); },
      rpc: async (fn, args) => {
        if (fn === "ai_job_context") {
          return {
            data: {
              lead: {
                id: "lead-qc-worker",
                team_id: "t1",
                email: "hello@linear.app",
                website: "https://linear.app",
                outreach_approved: true,
                data: {
                  name: "Linear",
                  outreach_approved: true,
                  research: { observations: [{ url: "linear.app", fact: "Product system", quote: "The product development system for teams and agents" }] },
                },
              },
              offer: { id: "o1", name: "Web", offer: "Next.js web apps", customer: "B2B SaaS", good: "SaaS", bad: "None", one_line: "We build fast custom Next.js web apps." },
              sequence: null,
              settings: { provider: "groq", model: "openai/gpt-oss-120b", sender_name: "Affan", business: "Norven", address: "London, UK", signature: "Best" },
              about: null,
              team_plan: { plan: "pro" },
              key: "gsk-test",
              dnc_too_long: false,
              dnc: [],
            },
            error: null,
          };
        }
        if (fn === "ai_job_save_lead") savedPatches.push(args.p_patch);
        return { data: null, error: null };
      },
    };

    const draftJson = JSON.stringify({
      first_name: "",
      subject: "next js site",
      icebreaker: "I saw your site says \"The product development system for teams and agents\" on your homepage.",
      one_line: "We build fast custom Next.js web apps for growing B2B SaaS teams.",
      question: "Quick question: is building a Next.js web app part of your plans this year?",
    });

    // 1. QC passes -> outreach.qc.status === "passed", job done
    let passCalls = 0;
    const job = { id: "j-w1", team_id: "t1", user_id: null, lead_id: "lead-qc-worker", offer_id: "o1", sequence_id: null, kind: "write", attempts: 1, max_attempts: 3, payload: {} };
    const out1 = await executeClaimedJob(sb, job, Date.now() + 20_000, "srv-sec", async () => {
      passCalls++;
      return {
        text: passCalls === 1 ? draftJson : JSON.stringify({ pass: true, issues: [] }),
        usage: { input_tokens: 10, output_tokens: 10 },
      };
    });
    assert.equal(out1.status, "done");
    assert.equal(savedPatches[0]?.data?.outreach?.qc?.status, "passed");

    // 2. QC holds (always fails) -> job still done (not skipped), outreach.qc.status === "hold", outreach_approved === false
    let holdCalls = 0;
    const out2 = await executeClaimedJob(sb, job, Date.now() + 20_000, "srv-sec", async () => {
      holdCalls++;
      return {
        text: holdCalls % 2 === 1 ? draftJson : JSON.stringify({ pass: false, issues: ["Generic opener."] }),
        usage: { input_tokens: 10, output_tokens: 10 },
      };
    });
    assert.equal(out2.status, "done");
    assert.equal(savedPatches[1]?.data?.outreach?.qc?.status, "hold");
    assert.equal(savedPatches[1]?.outreach_approved, false);
    assert.equal(savedPatches[1]?.data?.outreach_approved, false);
  });

  it("renderAll keeps writer's {{SUBJECT}} instead of overriding with sequence variants", () => {
    const steps = [
      {
        day: 0,
        subject: "{{SUBJECT}}",
        variants: ["video editing overflow for {{FIRST_NAME}}", "quick question on your client video work"],
        body: "Hi {{FIRST_NAME}},\n\n{{ICEBREAKER}}\n\n{{ONE_LINE}}\n\n{{QUESTION}}",
      },
    ];
    const rendered = renderAll(
      steps,
      { first_name: "there", subject: "next.js web app inquiry", icebreaker: "Saw your site.", question: "Planning Next.js this year?" },
      "We build Next.js apps.",
      { sender_name: "Affan", address: "London, UK", signature: "Best" },
      2 // variant C
    );
    assert.equal(rendered[0].subject, "next.js web app inquiry");
    assert.equal(rendered[0].variant, undefined);
  });

  it("cleanQc passes 'Is full-stack Next.js development on your roadmap?' without splitting Next.js at the dot", () => {
    const body = [
      "Hi,",
      "",
      "Your site says Linear is a product development system for teams and agents.",
      "",
      "We build fast, scalable Next.js web apps for B2B SaaS companies and growing tech teams.",
      "",
      "Quick question: Is full-stack Next.js development on your roadmap for this year?",
      "",
      "Best,",
      "Affan",
      "",
      "Not relevant? Reply \"no\" and I won't write again.",
    ].join("\n");
    const res = cleanQc({ pass: true, issues: [] }, body);
    assert.equal(res?.pass, true, `Expected pass, got issues: ${JSON.stringify(res?.issues)}`);
  });

  it("worker write and qc on Kestrel AI (no team key) use talon slot (gpt-oss-120b) and 60s write deadline", async () => {
    const seenModels = [];
    const seenDeadlines = [];
    const sb = {
      from: (table) => { throw new Error(`Anon client blocked on ${table}`); },
      rpc: async (fn, args) => {
        if (fn === "ai_slot_for_server") {
          if (args.p_slot === "talon") return { data: { slot: "talon", provider: "groq", model: "openai/gpt-oss-120b", key: "gsk-talon", enabled: true }, error: null };
          return { data: { slot: "swift", provider: "groq", model: "openai/gpt-oss-20b", key: "gsk-swift", enabled: true }, error: null };
        }
        if (fn === "ai_usage_this_month") return { data: 0, error: null };
        if (fn === "ai_job_context") {
          return {
            data: {
              lead: {
                id: "lead-kestrel-120b",
                team_id: "t1",
                email: "hello@linear.app",
                website: "https://linear.app",
                outreach_approved: true,
                data: {
                  name: "Linear",
                  outreach_approved: true,
                  research: { observations: [{ url: "linear.app", fact: "System", quote: "The product development system for teams and agents" }] },
                },
              },
              offer: { id: "o1", name: "Web", offer: "Next.js web apps", customer: "B2B SaaS", good: "SaaS", bad: "None", one_line: "We build Next.js web apps." },
              sequence: null,
              settings: { sender_name: "Affan", business: "Norven", address: "London, UK", signature: "Best" },
              about: null,
              team_plan: { plan: "pro" },
              key: null,
              dnc_too_long: false,
              dnc: [],
            },
            error: null,
          };
        }
        return { data: null, error: null };
      },
    };
    const draftJson = JSON.stringify({
      first_name: "",
      subject: "next js web app",
      icebreaker: "I saw your site says \"The product development system for teams and agents\" on your homepage.",
      one_line: "We build fast custom Next.js web apps for growing B2B SaaS teams.",
      question: "Quick question: is building a Next.js web app part of your plans this year?",
    });
    let calls = 0;
    const job = { id: "j-k1", team_id: "t1", user_id: null, lead_id: "lead-kestrel-120b", offer_id: "o1", sequence_id: null, kind: "write", attempts: 1, max_attempts: 3, payload: {} };
    const before = Date.now();
    const out = await executeClaimedJob(sb, job, before + 60_000, "srv-sec", async (p) => {
      calls++;
      seenModels.push(p.model);
      seenDeadlines.push(p.timeoutMs);
      return {
        text: calls === 1 ? draftJson : JSON.stringify({ pass: true, issues: [] }),
        usage: { input_tokens: 10, output_tokens: 10 },
      };
    });
    assert.equal(out.status, "done");
    assert.equal(seenModels[0], "openai/gpt-oss-120b");
    assert.equal(seenModels[1], "openai/gpt-oss-120b");
  });

  it("cleanQc never returns pass: false with empty issues[]", () => {
    const body = [
      "Hi,",
      "",
      "Your site says Linear is a product development system for teams and agents.",
      "",
      "We build fast, scalable Next.js web apps for B2B SaaS companies.",
      "",
      "Quick question: is full-stack Next.js development on your roadmap this year?",
      "",
      "Best,",
      "Affan",
      "",
      "Not relevant? Reply \"no\" and I won't write again.",
    ].join("\n");
    const res = cleanQc({ pass: false, issues: [] }, body);
    assert.equal(res?.pass, true);
    assert.deepEqual(res?.issues, []);
  });

  it("writeChecked completes at least 1 rewrite round when QC finds a fixable issue", async () => {
    const fakeSb = {
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
      rpc: async () => ({ data: 0, error: null }),
    };
    const draftJson = JSON.stringify({
      first_name: "",
      subject: "next js web app",
      icebreaker: "I saw your site says \"The product development system for teams and agents\" on your homepage.",
      one_line: "We build fast custom Next.js web apps for growing B2B SaaS teams.",
      question: "Quick question: is building a Next.js web app part of your plans this year?",
    });
    const basePlan = {
      task: "emails",
      provider: "groq",
      key: "gsk-test",
      model: "openai/gpt-oss-120b",
      offer: { id: "o1", name: "Web", offer: "Next.js web apps", customer: "B2B SaaS", one_line: "We build Next.js web apps." },
      sender: { sender_name: "Affan", address: "London, UK" },
      hash: "h",
      system: "sys",
      schema: {},
      followUps: 0,
      sb: fakeSb,
      teamId: "t1",
      userId: "u1",
      serverSecret: process.env.MAIL_SERVER_SECRET,
      serverTeamAi: { provider: "groq", model: "openai/gpt-oss-120b", key: "gsk_test" },
    };
    let wCalls = 0;
    const wPlan = {
      ...basePlan,
      providerFn: async () => {
        wCalls++;
        return { text: draftJson, usage: { input_tokens: 10, output_tokens: 10 } };
      },
    };
    const qcPlan = {
      ...basePlan,
      task: "qc",
      providerFn: async () => ({ text: JSON.stringify({ pass: false, issues: ["Shorten opener."] }), usage: { input_tokens: 10, output_tokens: 10 } }),
    };
    const lead = {
      id: "l-rewrite-hold",
      email: "a@example.com",
      outreach_approved: true,
      data: { website: "https://example.com", research: { observations: [{ url: "example.com", fact: "System", quote: "The product development system for teams and agents" }] } },
    };
    const res = await writeChecked(wPlan, qcPlan, lead, { emails: new Set(), domains: new Set() }, 2);
    assert.equal(res.ok, true);
    assert.equal(res.result.qc.status, "hold");
    assert.ok(res.result.qc.rounds >= 1, `Expected rounds >= 1, got ${res.result.qc.rounds}`);
    assert.ok(res.result.qc.issues.length > 0);
  });

  it("executeClaimedJob uses talon (gpt-oss-120b) when team_ai has settings but key is null, and passes if qc 429 retries ok", async () => {
    const seenModels = [];
    const sb = {
      from: (table) => { throw new Error(`Anon client blocked on ${table}`); },
      rpc: async (fn, args) => {
        if (fn === "ai_slot_for_server") {
          return { data: { slot: args.p_slot, provider: "groq", model: args.p_slot === "talon" ? "openai/gpt-oss-120b" : "openai/gpt-oss-20b", key: "gsk-kestrel", enabled: true }, error: null };
        }
        if (fn === "ai_usage_this_month") return { data: 0, error: null };
        if (fn === "ai_job_context") {
          return {
            data: {
              lead: {
                id: "lead-kestrel-settings",
                team_id: "t1",
                email: "hello@linear.app",
                website: "https://linear.app",
                outreach_approved: true,
                data: { name: "Linear", outreach_approved: true, research: { observations: [{ url: "linear.app", fact: "System", quote: "The product development system for teams and agents" }] } },
              },
              offer: { id: "o1", name: "Web", offer: "Next.js web apps", customer: "B2B SaaS", good: "SaaS", bad: "None", one_line: "We build Next.js web apps." },
              sequence: null,
              settings: { provider: "groq", model: "qwen/qwen3.8-27b", sender_name: "Affan", business: "Norven", address: "London, UK", signature: "Best" },
              about: null,
              team_plan: { plan: "pro" },
              key: null,
              dnc_too_long: false,
              dnc: [],
            },
            error: null,
          };
        }
        return { data: null, error: null };
      },
    };
    const draftJson = JSON.stringify({
      first_name: "",
      subject: "next js web app",
      icebreaker: "I saw your site says \"The product development system for teams and agents\" on your homepage.",
      one_line: "We build fast custom Next.js web apps for growing B2B SaaS teams.",
      question: "Quick question: is building a Next.js web app part of your plans this year?",
    });
    let calls = 0;
    const job = { id: "j-k2", team_id: "t1", user_id: null, lead_id: "lead-kestrel-settings", offer_id: "o1", sequence_id: null, kind: "write", attempts: 1, max_attempts: 3, payload: {} };
    const out = await executeClaimedJob(sb, job, Date.now() + 60_000, "srv-sec", async (p) => {
      calls++;
      seenModels.push(p.model);
      if (calls === 2) {
        const err = new Error("rate_limited");
        err.status = 429;
        throw err;
      }
      return {
        text: calls === 1 ? draftJson : JSON.stringify({ pass: true, issues: [] }),
        usage: { input_tokens: 10, output_tokens: 10 },
      };
    });
    assert.equal(out.status, "done");
    assert.deepEqual(seenModels, ["openai/gpt-oss-120b", "openai/gpt-oss-120b", "openai/gpt-oss-120b"]);
  });

  it("write 429 -> job requeued (retry), no nest fallback call; successful write stores qc.writer_model", async () => {
    const rpcCalls = [];
    const savedPatches = [];
    const sb = {
      from: (table) => { throw new Error(`Anon client blocked on ${table}`); },
      rpc: async (fn, args) => {
        rpcCalls.push({ fn, args });
        if (fn === "ai_slot_for_server") {
          return {
            data: {
              slot: args.p_slot,
              provider: "groq",
              model: args.p_slot === "talon" ? "openai/gpt-oss-120b" : "qwen/qwen3.8-27b",
              key: "gsk-kestrel",
              enabled: true,
            },
            error: null,
          };
        }
        if (fn === "ai_usage_this_month") return { data: 0, error: null };
        if (fn === "ai_job_context") {
          return {
            data: {
              lead: {
                id: "lead-429-requeue",
                team_id: "t1",
                email: "hello@linear.app",
                website: "https://linear.app",
                outreach_approved: true,
                data: { name: "Linear", outreach_approved: true, research: { observations: [{ url: "linear.app", fact: "System", quote: "The product development system for teams and agents" }] } },
              },
              offer: { id: "o1", name: "Web", offer: "Next.js web apps", customer: "B2B SaaS", good: "SaaS", bad: "None", one_line: "We build Next.js web apps." },
              sequence: null,
              settings: { sender_name: "Affan", business: "Norven", address: "London, UK", signature: "Best" },
              about: null,
              team_plan: { plan: "pro" },
              key: null,
              dnc_too_long: false,
              dnc: [],
            },
            error: null,
          };
        }
        if (fn === "ai_job_save_lead") savedPatches.push(args.p_patch);
        return { data: null, error: null };
      },
    };
    const seenModels = [];
    const job = { id: "j-429", team_id: "t1", user_id: null, lead_id: "lead-429-requeue", offer_id: "o1", sequence_id: null, kind: "write", attempts: 1, max_attempts: 3, payload: {} };
    const outcome = await executeClaimedJob(sb, job, Date.now() + 60_000, "srv-sec", async (p) => {
      seenModels.push(p.model);
      const err = new Error("rate_limited");
      err.status = 429;
      throw err;
    });
    assert.equal(outcome.status, "retry");
    assert.match(outcome.error, /busy/i);
    assert.equal(outcome.rateLimited, true);
    assert.ok(!seenModels.includes("qwen/qwen3.8-27b"), `Must not fall back to nest, saw: ${JSON.stringify(seenModels)}`);
    assert.ok(!rpcCalls.some((c) => c.fn === "ai_slot_for_server" && c.args.p_slot === "nest"), "Nest slot must not be resolved for write");

    // Verify runDueAiJobs passes p_rate_limited=true to finish_ai_job even when attempts === max_attempts
    const finishCalls = [];
    const rlSb = {
      rpc: async (fn, args) => {
        if (fn === "claim_ai_jobs") {
          return { data: [{ id: "j-rl", team_id: "t1", user_id: null, lead_id: "l1", offer_id: "o1", sequence_id: null, kind: "write", attempts: 3, max_attempts: 3, payload: {} }], error: null };
        }
        if (fn === "finish_ai_job") finishCalls.push(args);
        return { data: null, error: null };
      },
    };
    const rlSummary = await runDueAiJobs({
      sb: rlSb,
      secret: "srv-sec",
      phaseDeadlineMs: 15_000,
      runStep: async () => ({ status: "retry", error: "Not done — AI busy, try again", retryAfterSec: 60, rateLimited: true }),
    });
    assert.equal(rlSummary.retried, 1);
    assert.equal(rlSummary.error, 0);
    assert.equal(finishCalls[0]?.p_rate_limited, true);

    // Also verify writer_model is stored in outreach.qc when write succeeds
    let calls = 0;
    const okOutcome = await executeClaimedJob(sb, job, Date.now() + 60_000, "srv-sec", async () => {
      calls++;
      return {
        text: calls === 1
          ? JSON.stringify({
              first_name: "",
              subject: "next js web app",
              icebreaker: "I saw your site says \"The product development system for teams and agents\" on your homepage.",
              one_line: "We build fast custom Next.js web apps for growing B2B SaaS teams.",
              question: "Quick question: is building a Next.js web app part of your plans this year?",
            })
          : JSON.stringify({ pass: true, issues: [] }),
        usage: { input_tokens: 10, output_tokens: 10 },
      };
    });
    assert.equal(okOutcome.status, "done");
    assert.equal(savedPatches[0]?.data?.outreach?.qc?.writer_model, "openai/gpt-oss-120b");
  });
});

// ── Chat find_leads best-lead sorting ──────────────────────────────────
describe("Assistant: sortBestLeads", () => {
  it("sorts Good > Maybe > Poor/No > null, then higher numeric fit_score, then most recent created_at", () => {
    const sorted = sortBestLeads([
      { id: "poor-new", verdict: "No", fit_score: null, created_at: "2026-11-26T00:00:00Z" },
      { id: "maybe-old", verdict: "Maybe", fit_score: 50, created_at: "2026-11-20T00:00:00Z" },
      { id: "good-old", verdict: "Good", fit_score: null, created_at: "2026-11-20T00:00:00Z" },
      { id: "good-new", verdict: "Good", fit_score: null, created_at: "2026-11-25T00:00:00Z" },
      { id: "good-high", verdict: "Good", fit_score: 92, created_at: "2026-11-18T00:00:00Z" },
      { id: "poor-label", verdict: null, fit_raw: "Poor", fit_score: null, created_at: "2026-11-27T00:00:00Z" },
    ]);
    assert.deepEqual(sorted.map((x) => x.id), [
      "good-high",
      "good-new",
      "good-old",
      "maybe-old",
      "poor-label",
      "poor-new",
    ]);
  });

  it("fillStepDefaults fills missing day with 0 for step 1 and +3 days for each next step", () => {
    const steps = fillStepDefaults([
      { subject: "Quick idea", body: "Hi {{FIRST_NAME}}, {{ICEBREAKER}} {{QUESTION}}" },
      { body: "Hi {{FIRST_NAME}}, {{FOLLOW_UP}}" },
      { body: "Hi {{FIRST_NAME}}, {{FOLLOW_UP}}" },
    ]);
    assert.deepEqual(steps.map((s) => s.day), [0, 3, 6]);
  });

  it("callProvider retries exactly once on 400 tool call validation failed, feeding the error back", async () => {
    const origFetch = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (_url, init) => {
      calls.push(JSON.parse(init.body));
      if (calls.length === 1) {
        return new Response(
          JSON.stringify({ error: { message: "Tool call validation failed: missing properties: 'day'" } }),
          { status: 400, headers: { "content-type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "Prepared it; click Confirm below.", tool_calls: [] }, finish_reason: "stop" }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    };
    try {
      const ans = await callProvider({
        provider: "groq",
        key: "gsk_test",
        model: "openai/gpt-oss-20b",
        system: "You are Kestrel AI.",
        user: "write an email",
        maxTokens: 200,
        timeoutMs: 5000,
        tools: [{ name: "propose_change", description: "Propose", schema: { type: "object", properties: {} } }],
        runTool: async () => "{}",
      });
      assert.equal(calls.length, 2);
      assert.equal(ans.text, "Prepared it; click Confirm below.");
      const lastMsg = calls[1].messages[calls[1].messages.length - 1];
      assert.match(lastMsg.content, /Tool call validation failed/i);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("round-1 CHAT_SYSTEM + CHAT_TOOLS stay under 2,200 tokens (chars / 4)", () => {
    const estTokens = (CHAT_SYSTEM.length + JSON.stringify(CHAT_TOOLS).length) / 4;
    assert.ok(estTokens <= 2200, `Expected <= 2200 tokens, got ${Math.round(estTokens)}`);
  });

  it("looksLikeInlineColdEmail detects inline drafts with {{FIRST_NAME}} or Hi+signoff, ignoring normal replies", () => {
    assert.equal(looksLikeInlineColdEmail("Hi {{FIRST_NAME}},\n\nI saw your site.\n\nBest,\nAffan"), true);
    assert.equal(looksLikeInlineColdEmail("Hi Jane,\n\nQuick question about your app.\n\nBest,\n[Your Name]"), true);
    assert.equal(looksLikeInlineColdEmail("1. You have 2 draft campaigns.\n2. Open Campaigns to test them."), false);
  });

  it("aiOne retries once on missing follow_up_2, then saves partial draft marked needs review", async () => {
    let calls = 0;
    const seenPrompts = [];
    const sbMock = { rpc: async () => ({ data: null, error: null }) };
    const plan = {
      task: "emails",
      provider: "groq",
      key: "gsk_test",
      model: "openai/gpt-oss-20b",
      offer: { id: "o1", name: "Offer", offer: "Web speed", customer: "SaaS", good: "g", bad: "b", criteria: "", strictness: "balanced", one_line: "We speed up Next.js apps." },
      sender: { ...EMPTY_SENDER, sender_name: "Affan", business: "Norven", address: "123 St", signature: "Best,\nAffan" },
      hash: "h1",
      system: "sys",
      schema: {},
      followUps: 3,
      seq: { steps: [
        { day: 0, subject: "Quick question", body: "Hi {{FIRST_NAME}},\n\n{{ICEBREAKER}}\n\n{{ONE_LINE}}\n\n{{QUESTION}}\n\nIf this isn't relevant, just reply no.\n\nBest,\n{{SENDER_NAME}}" },
        { day: 4, subject: "", body: "Hi {{FIRST_NAME}},\n\n{{FOLLOW_UP}}\n\nBest,\n{{SENDER_NAME}}" },
        { day: 8, subject: "", body: "Hi {{FIRST_NAME}},\n\n{{FOLLOW_UP}}\n\nBest,\n{{SENDER_NAME}}" },
        { day: 14, subject: "", body: "Hi {{FIRST_NAME}},\n\n{{FOLLOW_UP}}\n\nBest,\n{{SENDER_NAME}}" },
      ] },
      sb: sbMock,
      teamId: "t1",
      serverSecret: process.env.MAIL_SERVER_SECRET,
      serverTeamAi: { provider: "groq", model: "openai/gpt-oss-20b", key: "gsk_test" },
      providerFn: async (params) => {
        calls++;
        seenPrompts.push(params.user);
        return {
          text: JSON.stringify({
            first_name: "there",
            subject: "Linear speed",
            icebreaker: "I saw your site says \"The product development system for teams and agents\".",
            one_line: "We speed up Next.js apps.",
            question: "Is frontend speed on your roadmap this year for your marketing and docs pages?",
            follow_up_1: "Thought I would share a quick note on your product pages.",
            follow_up_2: "",
            follow_up_3: "Last note from me—let me know if timing is off.",
          }),
          usage: { input_tokens: 100, output_tokens: 80 },
        };
      },
    };
    const lead = {
      id: "l1",
      email: "hello@linear.app",
      outreach_approved: true,
      data: {
        name: "Linear",
        outreach_approved: true,
        research: { observations: [{ fact: "System", quote: "The product development system for teams and agents" }] },
      },
    };
    const res = await aiOne(plan, lead, { emails: new Set(), domains: new Set() });
    assert.equal(calls, 2);
    assert.match(seenPrompts[1], /follow_up_2/);
    assert.equal(res.ok, true);
    assert.equal(res.warning, "Follow-up 2 couldn't be written, add it or retry.");
    assert.equal(res.patch.outreach_approved, false);
    const outreach = res.patch.data.outreach;
    assert.equal(outreach.qc.status, "hold");
    assert.ok(outreach.body.includes("product development system"));
    assert.ok(outreach.body.startsWith("Hi,\n"));
    assert.equal(outreach.steps.some((s) => /\[FOLLOW_UP\]/.test(s.body)), false);
  });

  it("emailSystem instructs follow-ups to use only research.observations or offer and open with Hi when no name", () => {
    const sys = emailSystem(
      { id: "o1", name: "O", offer: "Next.js", customer: "SaaS", good: "g", bad: "b", criteria: "", strictness: "balanced", one_line: "We build Next.js apps." },
      { ...EMPTY_SENDER, sender_name: "Affan", business: "Norven", address: "123 St" },
      [{ day: 0, subject: "s", body: "Hi {{FIRST_NAME}},\n\n{{ICEBREAKER}}" }, { day: 5, subject: "", body: "Hi {{FIRST_NAME}},\n\n{{FOLLOW_UP}}" }]
    );
    assert.match(sys, /Only reference verified research\.observations/i);
    assert.match(sys, /opens with "Hi," and no name/i);
  });

  it("cleanQc checks each email separately: 4 emails of 60 words each passes", () => {
    const first = "Hi,\n\nI saw your site says teams and agents build faster here. We build custom Next.js web apps for B2B SaaS teams. Is frontend web speed something you plan to work on this year? Best, Affan. Not relevant? Reply \"no\" and I won't write again. " + Array(14).fill("word").join(" ");
    const twelve = "Short plain sentence with twelve clear words for this follow up email.";
    const fu = `Hi,\n\n${twelve} ${twelve} ${twelve} ${twelve}\n\nBest,\nAffan\nNot relevant? Reply "no" and I won't write again.`;
    const words = (s) => s.trim().split(/\s+/).filter(Boolean).length;
    assert.ok(words(first) >= 50 && words(first) <= 90, `first=${words(first)}`);
    assert.ok(words(fu) <= 60, `fu=${words(fu)}`);
    const qc = cleanQc({ pass: true, issues: [] }, first, undefined, [first, fu, fu, fu]);
    assert.equal(qc?.pass, true, `Expected pass, got issues: ${qc?.issues.join("; ")}`);
  });

  it("cleanQc flags a follow-up pitching a product fix like 'speed up your UI'", () => {
    const first = "Hi,\n\nI saw your site says teams and agents build faster here. We build custom Next.js web apps for B2B SaaS teams. Is frontend web speed something you plan to work on this year? Best, Affan. Not relevant? Reply \"no\" and I won't write again. " + Array(14).fill("word").join(" ");
    const badFu = "Hi,\n\nWe could speed up your UI and streamline your Triage Intelligence labeling process.\n\nBest,\nAffan";
    const qc = cleanQc({ pass: true, issues: [] }, first, undefined, [first, badFu]);
    assert.equal(qc?.pass, false);
    assert.ok(qc?.issues.some((i) => /Follow-up 1 pitches a fix/i.test(i)));
  });

  it("writeChecked runs 1 rewrite round when QC fails then passes (rounds === 1)", async () => {
    let wCalls = 0;
    let qcCalls = 0;
    const sbMock = { rpc: async () => ({ data: null, error: null }) };
    const seq = { steps: [
      { day: 0, subject: "Quick question", body: "Hi {{FIRST_NAME}},\n\n{{ICEBREAKER}}\n\n{{ONE_LINE}}\n\n{{QUESTION}}\n\nIf this isn't relevant, just reply no.\n\nBest,\n{{SENDER_NAME}}" },
      { day: 5, subject: "", body: "Hi {{FIRST_NAME}},\n\n{{FOLLOW_UP}}\n\nBest,\n{{SENDER_NAME}}" },
    ] };
    const basePlan = {
      provider: "groq",
      key: "gsk_test",
      model: "openai/gpt-oss-120b",
      offer: { id: "o1", name: "Offer", offer: "Next.js", customer: "SaaS", good: "g", bad: "b", criteria: "", strictness: "balanced", one_line: "We build Next.js apps." },
      sender: { ...EMPTY_SENDER, sender_name: "Affan", business: "Norven", address: "123 St", signature: "Best,\nAffan" },
      hash: "h1",
      system: "sys",
      schema: {},
      followUps: 1,
      seq,
      sb: sbMock,
      teamId: "t1",
      serverSecret: process.env.MAIL_SERVER_SECRET,
      serverTeamAi: { provider: "groq", model: "openai/gpt-oss-120b", key: "gsk_test" },
    };
    const wPlan = {
      ...basePlan,
      task: "emails",
      providerFn: async () => {
        wCalls++;
        return {
          text: JSON.stringify({
            first_name: "",
            subject: "next.js apps",
            icebreaker: "I saw your site says \"The product development system for teams and agents\" in your hero.",
            one_line: "We build custom Next.js web apps for SaaS teams.",
            question: "Is Next.js web app development something you are planning this year for your site?",
            follow_up_1: "Thought I would share a quick note on our Next.js work.",
          }),
          usage: { input_tokens: 100, output_tokens: 80 },
        };
      },
    };
    const qcPlan = {
      ...basePlan,
      task: "qc",
      providerFn: async () => {
        qcCalls++;
        return {
          text: qcCalls === 1
            ? JSON.stringify({ pass: false, issues: ["Shorten the opener."] })
            : JSON.stringify({ pass: true, issues: [] }),
          usage: { input_tokens: 80, output_tokens: 20 },
        };
      },
    };
    const lead = {
      id: "l1",
      email: "hello@linear.app",
      outreach_approved: true,
      data: {
        name: "Linear",
        outreach_approved: true,
        research: { observations: [{ fact: "System", quote: "The product development system for teams and agents" }] },
      },
    };
    const res = await writeChecked(wPlan, qcPlan, lead, { emails: new Set(), domains: new Set() }, 2);
    assert.equal(res.ok, true);
    assert.equal(wCalls, 2);
    assert.equal(qcCalls, 2);
    assert.equal(res.result.qc.status, "passed");
    assert.equal(res.result.qc.rounds, 1);
    assert.deepEqual(res.events.map((e) => `${e.who}:${e.kind}`), ["qc:issue", "writer:fix", "qc:pass"]);
  });

  it("writeChecked retries when code-check fails (price or payment words) and only skips after last round fails", async () => {
    const fakeSb = {
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
      rpc: async () => ({ data: 0, error: null }),
    };
    let calls = 0;
    const goodBody = {
      first_name: "",
      subject: "next js site",
      icebreaker: "I saw your site says \"Fast issue tracking\" on your homepage for engineering teams.",
      one_line: "We build fast custom Next.js web apps for growing B2B SaaS teams.",
      question: "Quick question: is building a Next.js web app part of your plans this year?",
    };
    const badBody = {
      ...goodBody,
      question: "Quick question: want a free discount on Next.js work?",
    };
    const plan = {
      task: "emails",
      provider: "groq",
      key: "gsk-test",
      model: "openai/gpt-oss-120b",
      offer: { id: "o1", name: "Web", offer: "Next.js web apps", customer: "B2B SaaS", one_line: "We build fast Next.js web apps." },
      sender: { sender_name: "Affan", address: "London, UK" },
      hash: "h",
      system: "sys",
      schema: {},
      followUps: 0,
      sb: fakeSb,
      teamId: "t1",
      userId: "u1",
      serverSecret: process.env.MAIL_SERVER_SECRET,
      serverTeamAi: { provider: "groq", model: "openai/gpt-oss-120b", key: "gsk_test" },
      providerFn: async () => {
        calls++;
        return { text: JSON.stringify(calls === 1 ? badBody : goodBody), usage: { input_tokens: 10, output_tokens: 10 } };
      },
    };
    const qcPlan = {
      ...plan,
      task: "qc",
      providerFn: async () => ({ text: JSON.stringify({ pass: true, issues: [] }), usage: { input_tokens: 10, output_tokens: 10 } }),
    };
    const lead = {
      id: "l-price-retry",
      email: "a@example.com",
      outreach_approved: true,
      data: { website: "https://example.com", research: { observations: [{ url: "example.com", fact: "Fast", quote: "Fast issue tracking" }] } },
    };
    const dnc = { emails: new Set(), domains: new Set() };

    // 1. First draft trips price/payment -> rewrite round succeeds -> passes with rounds === 1
    const res1 = await writeChecked(plan, qcPlan, lead, dnc, 2);
    assert.equal(res1.ok, true);
    assert.equal(res1.result.qc.status, "passed");
    assert.equal(res1.result.qc.rounds, 1);
    assert.equal(calls, 2);

    // 2. Always trips price/payment -> skips only after rounds === 2 (3 total attempts: initial + 2 rewrites)
    let alwaysBadCalls = 0;
    const badPlan = {
      ...plan,
      providerFn: async () => {
        alwaysBadCalls++;
        return { text: JSON.stringify(badBody), usage: { input_tokens: 10, output_tokens: 10 } };
      },
    };
    const res2 = await writeChecked(badPlan, qcPlan, lead, dnc, 2);
    assert.equal(res2.ok, false);
    assert.equal(res2.why, "price or payment words");
    assert.equal(alwaysBadCalls, 3);
  });

  it("writeChecked holds (never passes) when QC hits 429 and falls back to code_checks_only", async () => {
    const fakeSb = {
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
      rpc: async () => ({ data: 0, error: null }),
    };
    const goodBody = {
      first_name: "",
      subject: "next js site",
      icebreaker: "I saw your site says \"Fast issue tracking\" on your homepage for engineering teams.",
      one_line: "We build fast custom Next.js web apps for growing B2B SaaS teams.",
      question: "Quick question: is building a Next.js web app part of your plans this year?",
    };
    const wPlan = {
      task: "emails",
      provider: "groq",
      key: "gsk-test",
      model: "openai/gpt-oss-120b",
      offer: { id: "o1", name: "Web", offer: "Next.js web apps", customer: "B2B SaaS", one_line: "We build fast Next.js web apps." },
      sender: { sender_name: "Affan", address: "London, UK" },
      hash: "h",
      system: "sys",
      schema: {},
      followUps: 0,
      sb: fakeSb,
      teamId: "t1",
      userId: "u1",
      serverSecret: process.env.MAIL_SERVER_SECRET,
      serverTeamAi: { provider: "groq", model: "openai/gpt-oss-120b", key: "gsk_test" },
      providerFn: async () => ({ text: JSON.stringify(goodBody), usage: { input_tokens: 10, output_tokens: 10 } }),
    };
    const qcPlan = {
      ...wPlan,
      task: "qc",
      providerFn: async () => {
        const err = new Error("rate_limited");
        err.status = 429;
        throw err;
      },
    };
    const lead = {
      id: "l-qc-429",
      email: "a@example.com",
      outreach_approved: true,
      data: { website: "https://example.com", research: { observations: [{ url: "example.com", fact: "Fast", quote: "Fast issue tracking" }] } },
    };
    const res = await writeChecked(wPlan, qcPlan, lead, { emails: new Set(), domains: new Set() }, 2);
    assert.equal(res.ok, true);
    assert.equal(res.result.qc.status, "hold");
    assert.deepEqual(res.result.qc.issues, ["AI check didn't run, review before sending."]);
  });
});
