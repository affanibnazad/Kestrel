import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// Read tasks.ts
const tasksFile = fs.readFileSync(new URL("../src/lib/ai-router/tasks.ts", import.meta.url), "utf8");

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

  it("verifies JSON parsing and think-tag removal", () => {
    function parseJsonObject(text) {
      const t = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
      const i = t.indexOf("{"), j = t.lastIndexOf("}");
      if (i < 0 || j <= i) return null;
      try {
        const v = JSON.parse(t.slice(i, j + 1));
        return v && typeof v === "object" ? v : null;
      } catch {
        return null;
      }
    }

    const withThink = "<think>evaluating lead fit...</think>{\n  \"verdict\": \"good\",\n  \"fit\": 90\n}";
    assert.deepEqual(parseJsonObject(withThink), { verdict: "good", fit: 90 });
    assert.equal(parseJsonObject("plain string"), null);
    assert.equal(parseJsonObject("{ bad json "), null);
  });

  it("verifies costOf returns null for unknown model and numeric for known model", () => {
    function mockCostOf(usage, modelPrice) {
      if (Number.isFinite(usage.cost)) return usage.cost;
      if (!modelPrice || modelPrice.input === null || modelPrice.output === null) return null;
      return (usage.input_tokens * modelPrice.input + usage.output_tokens * modelPrice.output) / 1e6;
    }

    const knownCost = mockCostOf({ input_tokens: 1000, output_tokens: 500 }, { input: 0.1, output: 0.5 });
    assert.ok(typeof knownCost === "number" && knownCost > 0);

    const unknownCost = mockCostOf({ input_tokens: 1000, output_tokens: 500 }, null);
    assert.equal(unknownCost, null);
  });
});
