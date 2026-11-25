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

export type AiSlot = "swift" | "talon" | "nest";

export type TaskConfig = {
  slot: "swift" | "talon";
  timeoutMs: number;
  retries: number;
  fallback?: "skip" | "nest" | "code_checks_only";
  maxTokens: number;
  maxConcurrent?: number;
};

// ONE table: task -> slot (swift | talon), timeout, retries, fallback, maxTokens
// swift (fast): research, score, explain, voice, qc, reply_label, spam_fix
// talon (strong): chat, write, reply_suggest
// nest (backup): automatic fallback when swift or talon fails / times out / 429
export const AI_TASKS: Record<AiTaskName, TaskConfig> = {
  research: { slot: "swift", timeoutMs: 20_000, retries: 1, fallback: "nest", maxTokens: 800, maxConcurrent: 3 },
  explain: { slot: "swift", timeoutMs: 10_000, retries: 1, fallback: "skip", maxTokens: 500, maxConcurrent: 3 },
  voice: { slot: "swift", timeoutMs: 20_000, retries: 1, fallback: "nest", maxTokens: 800, maxConcurrent: 3 },
  score: { slot: "swift", timeoutMs: 20_000, retries: 1, fallback: "nest", maxTokens: 1500, maxConcurrent: 3 },
  write: { slot: "talon", timeoutMs: 40_000, retries: 1, fallback: "nest", maxTokens: 2500, maxConcurrent: 3 },
  qc: { slot: "swift", timeoutMs: 15_000, retries: 1, fallback: "code_checks_only", maxTokens: 700, maxConcurrent: 3 },
  reply_suggest: { slot: "talon", timeoutMs: 20_000, retries: 1, fallback: "nest", maxTokens: 900, maxConcurrent: 3 },
  reply_label: { slot: "swift", timeoutMs: 20_000, retries: 1, fallback: "nest", maxTokens: 300, maxConcurrent: 3 },
  spam_fix: { slot: "swift", timeoutMs: 20_000, retries: 1, fallback: "nest", maxTokens: 1000, maxConcurrent: 3 },
  chat: { slot: "talon", timeoutMs: 40_000, retries: 0, fallback: "nest", maxTokens: 4000, maxConcurrent: 3 },
};
