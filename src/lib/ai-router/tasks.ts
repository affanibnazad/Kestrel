export type AiTaskName =
  | "research"
  | "explain"
  | "voice"
  | "score"
  | "write"
  | "qc"
  | "reply_suggest"
  | "reply_label"
  | "spam_fix"
  | "chat";

export type AiTier = "fast" | "strong";

export type TaskConfig = {
  tier: AiTier;
  timeoutMs: number;
  retries: number;
  fallback?: "skip" | "fast" | "code_checks_only";
  maxTokens: number;
  maxConcurrent?: number;
};

// ONE table: task -> tier, timeout, retries, fallback, maxTokens
// research: fast 20s r1 · explain: fast 10s r1 (fallback: skip) · voice: fast 20s r1 · score(fit): fast 20s r1 ·
// write: strong 40s r1 (fallback: fast) · qc: fast 15s r1 (fallback: code checks only) ·
// reply_suggest / reply_label / spam_fix: fast 20s r1 · chat: strong 40s r0 (fallback: fast)
export const AI_TASKS: Record<AiTaskName, TaskConfig> = {
  research: { tier: "fast", timeoutMs: 20_000, retries: 1, maxTokens: 800, maxConcurrent: 3 },
  explain: { tier: "fast", timeoutMs: 10_000, retries: 1, fallback: "skip", maxTokens: 500, maxConcurrent: 3 },
  voice: { tier: "fast", timeoutMs: 20_000, retries: 1, maxTokens: 800, maxConcurrent: 3 },
  score: { tier: "fast", timeoutMs: 20_000, retries: 1, maxTokens: 1500, maxConcurrent: 3 },
  write: { tier: "strong", timeoutMs: 40_000, retries: 1, fallback: "fast", maxTokens: 2500, maxConcurrent: 3 },
  qc: { tier: "fast", timeoutMs: 15_000, retries: 1, fallback: "code_checks_only", maxTokens: 700, maxConcurrent: 3 },
  reply_suggest: { tier: "fast", timeoutMs: 20_000, retries: 1, maxTokens: 900, maxConcurrent: 3 },
  reply_label: { tier: "fast", timeoutMs: 20_000, retries: 1, maxTokens: 300, maxConcurrent: 3 },
  spam_fix: { tier: "fast", timeoutMs: 20_000, retries: 1, maxTokens: 1000, maxConcurrent: 3 },
  chat: { tier: "strong", timeoutMs: 40_000, retries: 0, fallback: "fast", maxTokens: 4000, maxConcurrent: 3 },
};
