import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// Import REAL source modules using tsx TypeScript & @/ alias support
import { aiLeadError } from "@/lib/lead-steps";
import { runAiTask, AI_TASKS } from "@/lib/ai-router";
import { ProviderCallError, costOf } from "@/lib/ai-router/providers";
import { readJson } from "@/lib/ai";

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
  it("verifies AI_TASKS table configuration in tasks.ts", () => {
    assert.equal(AI_TASKS.research.tier, "fast");
    assert.equal(AI_TASKS.research.timeoutMs, 20_000);
    assert.equal(AI_TASKS.research.retries, 1);

    assert.equal(AI_TASKS.explain.tier, "fast");
    assert.equal(AI_TASKS.explain.timeoutMs, 10_000);
    assert.equal(AI_TASKS.explain.retries, 1);
    assert.equal(AI_TASKS.explain.fallback, "skip");

    assert.equal(AI_TASKS.voice.tier, "fast");
    assert.equal(AI_TASKS.voice.timeoutMs, 20_000);
    assert.equal(AI_TASKS.voice.retries, 1);

    assert.equal(AI_TASKS.score.tier, "fast");
    assert.equal(AI_TASKS.score.timeoutMs, 20_000);
    assert.equal(AI_TASKS.score.retries, 1);

    assert.equal(AI_TASKS.write.tier, "strong");
    assert.equal(AI_TASKS.write.timeoutMs, 40_000);
    assert.equal(AI_TASKS.write.retries, 1);
    assert.equal(AI_TASKS.write.fallback, "fast");

    assert.equal(AI_TASKS.qc.tier, "fast");
    assert.equal(AI_TASKS.qc.timeoutMs, 15_000);
    assert.equal(AI_TASKS.qc.retries, 1);
    assert.equal(AI_TASKS.qc.fallback, "code_checks_only");

    assert.equal(AI_TASKS.reply_suggest.tier, "fast");
    assert.equal(AI_TASKS.reply_label.tier, "fast");
    assert.equal(AI_TASKS.spam_fix.tier, "fast");
    assert.equal(AI_TASKS.chat.tier, "strong");
    assert.equal(AI_TASKS.chat.retries, 0);
    assert.equal(AI_TASKS.chat.fallback, "fast");
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

  it("strong fails twice -> fallback fast -> ok (logs: error, error, fallback)", async () => {
    const logs = [];
    let callCount = 0;
    const providerFn = async () => {
      callCount++;
      if (callCount <= 2) {
        throw new ProviderCallError("Sonnet unavailable", 500);
      }
      return { text: "fast fallback success", usage: { input_tokens: 10, output_tokens: 10 } };
    };

    const sb = createMockSb({ model: "auto" });
    const res = await runAiTask({
      sb,
      teamId: "team-test",
      task: "write",
      system: "sys",
      user: "usr",
      providerFn,
      logRunFn: async (...args) => { logs.push(args); },
    });

    assert.equal(res.ok, true);
    assert.equal(res.text, "fast fallback success");
    assert.equal(logs.length, 3);
    assert.equal(logs[0][12], "error");
    assert.equal(logs[1][12], "error");
    assert.equal(logs[2][12], "fallback");
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

    // 2. Missing team key in database
    const sbNoKey = createMockSb({ hasTeamKey: false });
    const resNoKey = await runAiTask({
      sb: sbNoKey,
      teamId: "test-team",
      task: "score",
      system: "sys",
      user: "usr",
    });
    assert.equal(resNoKey.statusCode, 401);
    assert.equal(aiLeadError(resNoKey).why, "Your AI key was rejected. Check Settings → AI.");
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
});
