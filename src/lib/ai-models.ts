// Which Claude model does which job. "auto" lets Kestrel choose by how hard the job is:
//   judging leads      → Claude Haiku 5.5   (short yes/no choice, many leads, cheapest)
//   writing emails     → Claude Sonnet 5.5  (personal writing; follow-ups included)
//   Assistant, normal  → Claude Sonnet 5.5  (questions, look-ups, small changes)
//   Assistant, big     → Claude Opus 5.5    (plans, comparisons, reviews, long or many-step requests)
// A model a person chose on purpose is always used as it is. Prices per million tokens (in / out), Nov 2026:
// Haiku 5.5 $0.10 / $0.50, Sonnet 5.5 $2 / $10, Opus 5.5 $4 / $20. Pure functions: used by server and browser.

export const AUTO = "auto";
export const HAIKU = "claude-haiku-5-5", SONNET = "claude-sonnet-5-5", OPUS = "claude-opus-5-5";
export type Effort = "low" | "medium" | "high";
export type Pick = { model: string; effort: Effort };

// Score and write with the team's own key. Auto works for Claude only; other AI companies use the model the team typed.
export function modelForTask(provider: string, chosen: string, task: "score" | "emails"): Pick {
  const effort: Effort = task === "score" ? "low" : "medium";
  if (provider === "anthropic" && (!chosen || chosen === AUTO)) return { model: task === "score" ? HAIKU : SONNET, effort };
  // Other AI companies have no "auto": an empty model makes the App ask the team to choose one. A typed name is cleaned
  // ("models/gemini-…" → "gemini-…") and must look like a model id (no spaces), else the App asks to pick from the list.
  const m = String(chosen || "").trim().replace(/^models\//, "");
  return { model: m === AUTO || !/^[A-Za-z0-9._:/-]{1,120}$/.test(m) ? "" : m, effort };
}

// Words that usually mean a big task: a plan, an analysis or a rewrite across many records.
const BIG = /\b(plan|strategy|strategi[sz]e|analy[sz]e|analysis|compare|comparison|audit|review|diagnose|improve|optimi[sz]e|why (is|are|did|do|does|aren'?t|isn'?t)|what went wrong|rewrite|write (a|my|the|new) (sequence|campaign|email)|step by step|in detail|report|forecast|every (campaign|lead|account)|all (my )?(campaigns|leads|accounts))\b/i;

// Kestrel AI's model for one message. `setting` is the Owner panel choice; `question` is the newest user message;
// `turns` is how many messages the chat already has.
export function assistantModel(setting: string, question: string, turns: number): Pick {
  if (setting && setting !== AUTO) return { model: setting, effort: "low" };
  const q = String(question || "");
  const big = q.length > 600 || BIG.test(q) || (turns > 16 && q.length > 200);
  return big ? { model: OPUS, effort: "medium" } : { model: SONNET, effort: "low" };
}

// Models that "auto" may use, so a key test can check they are all available.
export const AUTO_ASSISTANT_MODELS = [SONNET, OPUS];
// Haiku has no server-side refusal fallback; Opus and Sonnet do.
export const hasFallback = (model: string) => /^claude-(opus|sonnet)/.test(model);
