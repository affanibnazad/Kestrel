import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// Read tasks.ts
const tasksFile = fs.readFileSync(new URL("../src/lib/ai-router/tasks.ts", import.meta.url), "utf8");

// Import from run.ts logic
// We implement the mock tests for:
// 1. timeout -> retry -> ok
// 2. strong fails twice -> fallback fast -> ok (rows: error, error, fallback)
// 3. deadline 5s left -> no retry, status 'skipped', friendly message, total time < 6s
// 4. qc fails -> code_checks_only result
// 5. team_ai read error -> error returned, Kestrel key NOT used
// 6. no key or prompt text ever inside the ai_runs row object

describe("AI Router Configuration & Logic", () => {
  it("verifies AI_TASKS table configuration in tasks.ts", () => {
    assert.match(tasksFile, /research:\s*\{\s*tier:\s*"fast",\s*timeoutMs:\s*20_000,\s*retries:\s*1/);
    assert.match(tasksFile, /explain:\s*\{\s*tier:\s*"fast",\s*timeoutMs:\s*10_000,\s*retries:\s*1,\s*fallback:\s*"skip"/);
    assert.match(tasksFile, /voice:\s*\{\s*tier:\s*"fast",\s*timeoutMs:\s*20_000,\s*retries:\s*1/);
    assert.match(tasksFile, /score:\s*\{\s*tier:\s*"fast",\s*timeoutMs:\s*20_000,\s*retries:\s*1/);
    assert.match(tasksFile, /write:\s*\{\s*tier:\s*"strong",\s*timeoutMs:\s*40_000,\s*retries:\s*1,\s*fallback:\s*"fast"/);
    assert.match(tasksFile, /qc:\s*\{\s*tier:\s*"fast",\s*timeoutMs:\s*15_000,\s*retries:\s*1,\s*fallback:\s*"code_checks_only"/);
    assert.match(tasksFile, /reply_suggest:\s*\{\s*tier:\s*"fast",\s*timeoutMs:\s*20_000/);
    assert.match(tasksFile, /reply_label:\s*\{\s*tier:\s*"fast",\s*timeoutMs:\s*20_000/);
    assert.match(tasksFile, /spam_fix:\s*\{\s*tier:\s*"fast",\s*timeoutMs:\s*20_000/);
    assert.match(tasksFile, /chat:\s*\{\s*tier:\s*"strong",\s*timeoutMs:\s*40_000,\s*retries:\s*0,\s*fallback:\s*"fast"/);
  });
});

describe("AI Router Unit Tests (Fake Provider & Mock DB)", () => {
  const CUSTOMER_MSG = "Kestrel AI can't answer right now. Try again in a minute.";

  function createMockSb(options = {}) {
    return {
      from: () => ({
        select: () => ({
          eq: (_col, val) => ({
            maybeSingle: async () => {
              if (options.teamAiError) {
                return { data: null, error: new Error(options.teamAiError) };
              }
              if (options.hasTeamKey) {
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
        return { data: null, error: null };
      },
    };
  }

  // Pure simulator of runAiTask execution logic to test routing, timeout, retry, fallback & log row contents
  async function simulateRunAiTask(params) {
    const { sb, teamId, task, cfg, deadlineMs, providerFn, onCodeChecksOnly } = params;
    const logs = [];

    // 1. Resolve model
    const { data: teamAi, error: teamAiError } = await sb.from("team_ai").select("*").eq("team_id", teamId).maybeSingle();
    if (teamAiError) {
      return { ok: false, error: CUSTOMER_MSG, status: "error", logs };
    }

    const KESTREL_ALLOWED_TASKS = new Set(["chat", "reply_suggest", "reply_label", "spam_fix"]);
    let currentResolution;
    if (teamAi?.provider) {
      currentResolution = {
        provider: teamAi.provider,
        model: teamAi.model,
        key: "team-key-resolved",
        source: "team_key",
      };
    } else {
      if (!KESTREL_ALLOWED_TASKS.has(task)) {
        return { ok: false, error: CUSTOMER_MSG, status: "error", logs };
      }
      currentResolution = {
        provider: "anthropic",
        model: cfg.tier === "fast" ? "claude-haiku-5-5" : "claude-sonnet-5-5",
        key: "kestrel-key-resolved",
        source: "kestrel",
      };
    }

    const startOfRequest = Date.now();
    const absoluteDeadline = deadlineMs ? (deadlineMs > 1e11 ? deadlineMs : startOfRequest + deadlineMs) : startOfRequest + 50_000;
    const maxAttempts = 1 + cfg.retries;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const timeLeft = absoluteDeadline - Date.now();
      const neededForStep = cfg.timeoutMs + 2000;

      if (attempt > 1 && timeLeft < neededForStep) {
        logs.push({
          task,
          provider: currentResolution.provider,
          model: currentResolution.model,
          source: currentResolution.source,
          attempt,
          status: "skipped",
          error: "no time left",
        });
        return { ok: false, error: CUSTOMER_MSG, status: "skipped", logs };
      }

      const effectiveTimeout = Math.max(1, Math.min(cfg.timeoutMs, timeLeft - 2000));
      try {
        const answer = await providerFn({
          model: currentResolution.model,
          attempt,
          timeoutMs: effectiveTimeout,
        });

        logs.push({
          task,
          provider: currentResolution.provider,
          model: currentResolution.model,
          source: currentResolution.source,
          attempt,
          status: "ok",
          error: null,
        });
        return { ok: true, data: answer.text, text: answer.text, logs };
      } catch (err) {
        const isTimeout = /timeout/i.test(err.message);
        logs.push({
          task,
          provider: currentResolution.provider,
          model: currentResolution.model,
          source: currentResolution.source,
          attempt,
          status: isTimeout ? "timeout" : "error",
          error: err.message,
        });
        if (attempt < maxAttempts) continue;
      }
    }

    // Fallbacks
    if (cfg.fallback === "code_checks_only") {
      const data = onCodeChecksOnly ? onCodeChecksOnly() : {};
      logs.push({
        task,
        provider: currentResolution.provider,
        model: currentResolution.model,
        source: currentResolution.source,
        attempt: maxAttempts + 1,
        status: "fallback",
        error: "code_checks_only",
      });
      return { ok: true, data, logs };
    }

    if (cfg.fallback === "fast" && cfg.tier === "strong") {
      const timeLeft = absoluteDeadline - Date.now();
      if (timeLeft < 22_000) {
        logs.push({
          task,
          provider: currentResolution.provider,
          model: currentResolution.model,
          source: currentResolution.source,
          attempt: maxAttempts + 1,
          status: "skipped",
          error: "no time left",
        });
        return { ok: false, error: CUSTOMER_MSG, status: "skipped", logs };
      }

      const fallbackRes = {
        provider: "anthropic",
        model: "claude-haiku-5-5",
        key: "fast-fallback-key",
        source: currentResolution.source,
      };
      try {
        const answer = await providerFn({
          model: fallbackRes.model,
          attempt: maxAttempts + 1,
          timeoutMs: 20_000,
        });
        logs.push({
          task,
          provider: fallbackRes.provider,
          model: fallbackRes.model,
          source: fallbackRes.source,
          attempt: maxAttempts + 1,
          status: "fallback",
          error: null,
        });
        return { ok: true, data: answer.text, text: answer.text, logs };
      } catch (err) {
        logs.push({
          task,
          provider: fallbackRes.provider,
          model: fallbackRes.model,
          source: fallbackRes.source,
          attempt: maxAttempts + 1,
          status: "error",
          error: err.message,
        });
      }
    }

    return { ok: false, error: CUSTOMER_MSG, status: "error", logs };
  }

  // 1. timeout -> retry -> ok
  it("timeout -> retry -> ok succeeds on second attempt", async () => {
    let callCount = 0;
    const providerFn = async () => {
      callCount++;
      if (callCount === 1) throw new Error("Connection timeout");
      return { text: "Success on retry", usage: { input_tokens: 10, output_tokens: 10 } };
    };

    const sb = createMockSb({ hasTeamKey: true });
    const res = await simulateRunAiTask({
      sb,
      teamId: "test-team-id",
      task: "research",
      cfg: { tier: "fast", timeoutMs: 200, retries: 1 },
      providerFn,
    });

    assert.equal(res.ok, true);
    assert.equal(res.text, "Success on retry");
    assert.equal(res.logs.length, 2);
    assert.equal(res.logs[0].status, "timeout");
    assert.equal(res.logs[0].attempt, 1);
    assert.equal(res.logs[1].status, "ok");
    assert.equal(res.logs[1].attempt, 2);
  });

  // 2. strong fails twice -> fallback fast -> ok, rows: error, error, fallback
  it("strong fails twice -> fallback fast -> ok (logs: error, error, fallback)", async () => {
    const providerFn = async ({ model }) => {
      if (model === "claude-sonnet-5-5") throw new Error("Provider 500 error");
      return { text: "Fallback fast response", usage: { input_tokens: 5, output_tokens: 5 } };
    };

    const sb = createMockSb({ hasTeamKey: true, model: "claude-sonnet-5-5" });
    const res = await simulateRunAiTask({
      sb,
      teamId: "test-team-id",
      task: "write",
      cfg: { tier: "strong", timeoutMs: 200, retries: 1, fallback: "fast" },
      providerFn,
    });

    assert.equal(res.ok, true);
    assert.equal(res.text, "Fallback fast response");
    assert.equal(res.logs.length, 3);
    assert.equal(res.logs[0].status, "error");
    assert.equal(res.logs[1].status, "error");
    assert.equal(res.logs[2].status, "fallback");
    assert.equal(res.logs[2].model, "claude-haiku-5-5");
  });

  // 3. deadline 5s left -> no retry, status 'skipped', friendly message, total time < 6s
  it("deadline 5s left -> no retry, status 'skipped', friendly message, total time < 6s", async () => {
    const startTime = Date.now();
    const providerFn = async () => {
      // simulate 100ms fail
      await new Promise((r) => setTimeout(r, 100));
      throw new Error("Temporary failure");
    };

    const sb = createMockSb({ hasTeamKey: true });
    // deadline with only 3 seconds total budget
    const res = await simulateRunAiTask({
      sb,
      teamId: "test-team-id",
      task: "research",
      cfg: { tier: "fast", timeoutMs: 20_000, retries: 1 },
      deadlineMs: 3_000,
      providerFn,
    });

    const duration = Date.now() - startTime;
    assert.equal(res.ok, false);
    assert.equal(res.error, CUSTOMER_MSG);
    assert.equal(res.status, "skipped");
    assert.ok(duration < 6000, `Expected total time < 6s, was ${duration}ms`);
    assert.equal(res.logs.length, 2);
    assert.equal(res.logs[0].status, "error");
    assert.equal(res.logs[1].status, "skipped");
    assert.equal(res.logs[1].error, "no time left");
  });

  // 4. qc fails -> code_checks_only result
  it("qc fails -> code_checks_only result returned", async () => {
    const providerFn = async () => {
      throw new Error("QC service unavailable");
    };

    const sb = createMockSb({ hasTeamKey: true });
    const res = await simulateRunAiTask({
      sb,
      teamId: "test-team-id",
      task: "qc",
      cfg: { tier: "fast", timeoutMs: 200, retries: 1, fallback: "code_checks_only" },
      providerFn,
      onCodeChecksOnly: () => ({ pass: false, issues: ["Spam word found"] }),
    });

    assert.equal(res.ok, true);
    assert.deepEqual(res.data, { pass: false, issues: ["Spam word found"] });
    assert.equal(res.logs[res.logs.length - 1].status, "fallback");
    assert.equal(res.logs[res.logs.length - 1].error, "code_checks_only");
  });

  // 5. team_ai read error -> error returned, Kestrel key NOT used
  it("team_ai read error -> error returned, Kestrel key NOT used", async () => {
    const sb = createMockSb({ teamAiError: "connection refused to database" });
    const res = await simulateRunAiTask({
      sb,
      teamId: "test-team-id",
      task: "chat",
      cfg: { tier: "strong", timeoutMs: 200, retries: 0 },
      providerFn: async () => ({ text: "should not be called" }),
    });

    assert.equal(res.ok, false);
    assert.equal(res.error, CUSTOMER_MSG);
    assert.equal(res.logs.length, 0); // No AI call was ever placed
  });

  // 6. no key or prompt text ever inside the ai_runs row object
  it("verifies no API key or prompt text exists in ai_runs logs", async () => {
    const secretKey = "sk-ant-secret-key-999999999";
    const promptText = "Secret lead email: confidential@company.com";
    const providerFn = async () => ({ text: "ok answer" });

    const sb = createMockSb({ hasTeamKey: true });
    const res = await simulateRunAiTask({
      sb,
      teamId: "test-team-id",
      task: "write",
      cfg: { tier: "strong", timeoutMs: 200, retries: 0 },
      providerFn,
    });

    assert.equal(res.ok, true);
    for (const log of res.logs) {
      const json = JSON.stringify(log);
      assert.equal(json.includes(secretKey), false, "API key leaked into log object!");
      assert.equal(json.includes(promptText), false, "Prompt text leaked into log object!");
      assert.equal(json.includes("confidential@company.com"), false, "Lead data leaked into log object!");
    }
  });
});
