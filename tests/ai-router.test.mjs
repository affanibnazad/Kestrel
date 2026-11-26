import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";

// Import REAL source modules using tsx TypeScript & @/ alias support
import { aiLeadError, aiAnswer, aiOne, NEEDS_RESEARCH } from "@/lib/lead-steps";
import { runAiTask, AI_TASKS } from "@/lib/ai-router";
import { callProvider, ProviderCallError, costOf } from "@/lib/ai-router/providers";
import { readJson, EMPTY_SENDER, assemble, emailSystem, emailPayload, qcSystem, cleanParts, cleanQc, hasObservations, cleanResearch, numbersNotInQuote } from "@/lib/ai";
import { trustedFirstName } from "@/lib/email-check";

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
    assert.equal(AI_TASKS.write.fallback, "nest");

    assert.equal(AI_TASKS.qc.slot, "swift");
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

  it("write on Kestrel -> uses Swift slot model, not Talon/Sonnet", async () => {
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
            return { data: { slot: "talon", provider: "anthropic", model: "claude-sonnet-5-5", key: "kestrel-talon-key", enabled: true }, error: null };
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
    assert.equal(res.slot, "swift");
    assert.equal(requestedSlots[0], "swift");
    assert.equal(requestedSlots.includes("talon"), false);
    assert.equal(calledModel, "llama-swift-fast");
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


// ── Research contact first names ────────────────────────────────────
describe("Research: verified contact names", () => {
  it("cleanResearch keeps contacts from an about/team/leadership page on the lead's own domain, and drops others", () => {
    const site = "Home page.\n--- /about ---\nAbout Acme. Leadership: Jane Doe, Co-Founder & CEO leads product. Built for fast teams.";
    const r = cleanResearch({
      observations: [{ fact: "Built for fast teams", quote: "Built for fast teams." }],
      contacts: [
        { name: "Jane Doe", role: "Co-Founder & CEO", quote: "Jane Doe, Co-Founder & CEO leads product", url: "https://acme.com/about" },
        { name: "Bob Smith", role: "CTO", quote: "Bob Smith, CTO runs infra", url: "https://acme.com/about" },
        { name: "Support Team", role: "Support", quote: "Jane Doe, Co-Founder & CEO leads product", url: "https://acme.com/about" },
      ],
      hypotheses: [],
      unknowns: [],
      problem: "",
      how: "",
      detail: "",
      sure: "high",
    }, site, "acme.com", "Acme");
    assert.ok(r);
    assert.equal(r.contacts?.length, 1);
    assert.equal(r.contacts?.[0].name, "Jane Doe");
    assert.equal(r.contacts?.[0].role, "Co-Founder & CEO");
  });

  it("cleanResearch rejects a testimonial on the homepage (not on an about/team/leadership page)", () => {
    const site = 'Home page. "Jane Doe, Founder & CEO loves this product!"\n--- /team ---\nLeadership: Alice Brown, CTO at Acme.';
    const r = cleanResearch({
      observations: [{ fact: "Trusted by teams", quote: "loves this product" }],
      contacts: [
        { name: "Jane Doe", role: "Founder & CEO", quote: "Jane Doe, Founder & CEO loves this product" },
        { name: "Alice Brown", role: "CTO", quote: "Alice Brown, CTO at Acme", url: "https://acme.com/team" },
      ],
      hypotheses: [],
      unknowns: [],
      problem: "",
      how: "",
      detail: "",
      sure: "high",
    }, site, "acme.com", "Acme");
    assert.ok(r);
    assert.equal(r.contacts?.length, 1);
    assert.equal(r.contacts?.[0].name, "Alice Brown");
  });

  it("cleanResearch rejects a quote that names another company ('of X' or 'at X'), even on /about", () => {
    const site = "Home page.\n--- /about ---\nJohn Smith, CEO of OtherCorp says great work. Sarah Lee, VP at Rival Inc. Jane Doe, VP of Engineering at Acme.";
    const r = cleanResearch({
      observations: [{ fact: "Great work", quote: "says great work" }],
      contacts: [
        { name: "John Smith", role: "CEO", quote: "John Smith, CEO of OtherCorp", url: "https://acme.com/about" },
        { name: "Sarah Lee", role: "VP", quote: "Sarah Lee, VP at Rival Inc", url: "https://acme.com/about" },
        { name: "Jane Doe", role: "VP of Engineering", quote: "Jane Doe, VP of Engineering at Acme", url: "https://acme.com/about" },
      ],
      hypotheses: [],
      unknowns: [],
      problem: "",
      how: "",
      detail: "",
      sure: "high",
    }, site, "acme.com", "Acme");
    assert.ok(r);
    assert.equal(r.contacts?.length, 1);
    assert.equal(r.contacts?.[0].name, "Jane Doe");
  });

  it("emailPayload and trustedFirstName greet by name ONLY when send-to email is that person's own address, never team@/support@/hello@", () => {
    const researchContacts = [{ name: "Jane Doe", role: "CEO", quote: "Jane Doe, CEO" }];

    // Generic inboxes (team@, support@, hello@) -> NEVER greet by name
    for (const genericEmail of ["team@acme.com", "support@acme.com", "hello@acme.com"]) {
      const genericLead = { name: "Acme", email: genericEmail, research: { observations: [{ fact: "x", quote: "y" }], contacts: researchContacts } };
      const p = emailPayload(genericLead);
      assert.equal(p.contact_name, "");
      assert.equal(trustedFirstName("Jane", { name: "Acme", email: genericEmail, researchContacts }), "there");
    }

    // Personal email matching contact -> greets by name
    const janeLead = { name: "Acme", email: "jane@acme.com", research: { observations: [{ fact: "x", quote: "y" }], contacts: researchContacts } };
    const pj = emailPayload(janeLead);
    assert.equal(pj.contact_name, "Jane Doe");
    assert.equal(trustedFirstName("Jane", { name: "Acme", email: "jane@acme.com", researchContacts }), "Jane");

    // Personal email alice@ -> keeps Alice, rejects Jane
    const personalLead = { name: "Acme", email: "alice@acme.com", research: { observations: [{ fact: "x", quote: "y" }], contacts: researchContacts } };
    const p2 = emailPayload(personalLead);
    assert.equal(p2.contact_name, "");
    assert.equal(p2.name_from_email, "Alice");
    assert.equal(trustedFirstName("Jane", { name: "Acme", email: "alice@acme.com", researchContacts }), "there");
    assert.equal(trustedFirstName("Alice", { name: "Acme", email: "alice@acme.com", researchContacts }), "Alice");

    // No contacts anywhere -> "there"
    assert.equal(trustedFirstName("Jane", { name: "Acme", email: "team@acme.com", researchContacts: [] }), "there");
  });
});
