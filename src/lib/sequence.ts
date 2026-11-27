// Kestrel Mail, phase 2: sequences (the first email and up to 3 follow-ups), merge fields, the footer every step gets,
// and the spam-word check. Pure functions: used by the App's server, the browser and the job files.
// Nothing here sends email. Sending is phase 3.
import { greetName } from "./email-check";

// variants: up to 2 more subject lines for an A/B/C test (subject is variant A). Each lead gets one variant for all steps.
// kind: "email" (default) or a manual task for a person (database 038): a LinkedIn message, a call or any other task.
// A task step is never sent: on its day it becomes a task on the Tasks page and the sequence goes on.
export type StepKind = "email" | "linkedin" | "call" | "task";
export const STEP_KINDS: [StepKind, string][] = [["email", "Email"], ["linkedin", "LinkedIn task"], ["call", "Call task"], ["task", "Other task"]];
export const isTaskStep = (s: { kind?: string } | null | undefined) => Boolean(s?.kind && s.kind !== "email");
export type Step = { day: number; subject: string; body: string; variants?: string[]; kind?: StepKind };
export type Sequence = { id?: string; name: string; offer_id: string | null; steps: Step[]; stop_on_reply: boolean; weekdays_only: boolean };
// What the AI wrote for one lead: the first email's parts and one personal text per follow-up.
export type SequenceParts = { first_name: string; subject: string; icebreaker: string; question: string; follow_ups: string[]; one_line?: string };
export type SenderBits = { sender_name: string; business: string; address: string; signature: string; booking_link?: string };
export type Rendered = { step: number; day: number; subject: string; body: string; missing: string[]; variant?: string; kind?: StepKind };
export const VARIANT_LETTERS = ["A", "B", "C"] as const;
export const MAX_VARIANTS = 3;
// How many variants a sequence tests (1 = no test): the most any step has.
export const variantCount = (steps: Step[]) => Math.min(MAX_VARIANTS, Math.max(1, ...steps.map((s) => 1 + (s.variants ?? []).filter((v) => v.trim()).length)));
// The lead's variant: a stable, even split from its id (the same lead always gets the same variant).
export function variantFor(seed: string, count: number) {
  if (count <= 1 || !seed) return 0;
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) % count;
}

// The class: first email, then follow-ups after 5, 10 and 15 days, only to people who did not reply.
// An empty follow-up subject means "same thread" (Re: the first subject).
export const DEFAULT_STEPS: Step[] = [
  { day: 0, subject: "{{SUBJECT}}", body: "Hi {{FIRST_NAME}},\n\n{{ICEBREAKER}}\n\n{{ONE_LINE}}\n\n{{QUESTION}}" },
  { day: 5, subject: "", body: "Hi {{FIRST_NAME}},\n\n{{FOLLOW_UP}}" },
  { day: 10, subject: "", body: "Hi {{FIRST_NAME}},\n\n{{FOLLOW_UP}}" },
  { day: 15, subject: "", body: "Hi {{FIRST_NAME}},\n\n{{FOLLOW_UP}}" },
];
export const EMPTY_SEQUENCE: Sequence = { name: "", offer_id: null, steps: DEFAULT_STEPS, stop_on_reply: true, weekdays_only: true };
export const MAX_STEPS = 4;
export const OPT_OUT = "Not relevant? Reply \"no\" and I won't write again.";

// Merge fields people can use in a step. FOLLOW_UP is the AI's text for that follow-up.
export const MERGE_FIELDS: Record<string, string> = {
  FIRST_NAME: "The person's first name, or “there” when no person is known (Hi there,)",
  SUBJECT: "The subject the AI wrote for this lead",
  ICEBREAKER: "The personal first line the AI wrote",
  QUESTION: "The question the AI wrote about their work",
  ONE_LINE: "Your one line on what you do, reworded by the AI for each email",
  FOLLOW_UP: "The AI's personal text for this follow-up",
  SENDER_NAME: "Your sender name",
  BUSINESS: "Your business name",
  BOOKING_LINK: "Your booking link (Calendly, Cal.com…), from AI → Emails come from",
};
const FIELD_RE = /\{\{\s*([A-Za-z_]+)\s*\}\}/g;
export const fieldsIn = (text: string) => [...String(text || "").matchAll(FIELD_RE)].map((m) => m[1].toUpperCase());
export const unknownFields = (text: string) => [...new Set(fieldsIn(text).filter((f) => !(f in MERGE_FIELDS)))];

// How many follow-ups the AI has to write for this sequence: one per follow-up step.
// Follow-ups are the email steps after the first; task steps (call, LinkedIn, other) are never sent, so they get no AI text.
export const followUpSteps = (steps: Step[]) => steps.slice(1, MAX_STEPS).filter((s) => !isTaskStep(s));
export const followUpCount = (steps: Step[]) => followUpSteps(steps).length;
// The first step plus the first n follow-ups (and the task steps before the next follow-up), e.g. for a results file
// that has only n follow-up texts.
export function stepsForFollowUps(steps: Step[], n: number) {
  const out: Step[] = [];
  let seen = 0;
  for (const [i, s] of steps.slice(0, MAX_STEPS).entries()) {
    if (i > 0 && !isTaskStep(s)) { if (seen >= n) break; seen++; }
    out.push(s);
  }
  return out;
}

// The job of each follow-up, from the class (Topics 8 and 10): soft check-in, a concrete way to help, polite close-out.
const PURPOSE = {
  checkin: "a soft check-in with one new, simple question about their own work. Do not repeat the first email's question or icebreaker.",
  help: "one concrete, honest way the sender could help with something from this lead's own data, then ask if it is worth a short talk. Never promise results or free work.",
  close: "a polite close-out: say you will stop writing so you don't fill their inbox, and leave the door open if it is ever useful.",
};
export function followUpPurposes(n: number) {
  return n <= 0 ? [] : n === 1 ? [PURPOSE.close] : n === 2 ? [PURPOSE.checkin, PURPOSE.close] : [PURPOSE.checkin, PURPOSE.help, PURPOSE.close];
}

// The footer every step gets: sender (or signature), postal address and the opt-out line.
export function footer(s: SenderBits) {
  const sign = String(s.signature || "").trim() || [s.sender_name, s.business].map((x) => String(x || "").trim()).filter(Boolean).join(", ");
  return [[sign, String(s.address || "").trim()].filter(Boolean).join("\n"), OPT_OUT].filter(Boolean).join("\n\n");
}

const tidy = (text: string) => text.replace(/\b(Hi|Hey|Hello)\s+,/gi, "$1,").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

// One step with the merge fields filled. Fields with no value stay visible as [FIELD] and are listed in `missing`.
export function renderStep(step: Step, index: number, parts: Partial<SequenceParts>, oneLine: string, s: SenderBits, threadSubject = "", variant = 0): Rendered {
  const rawFirst = greetName(parts.first_name);
  const firstVal = rawFirst && rawFirst.toLowerCase() !== "there" ? rawFirst : "";
  const values: Record<string, string> = {
    FIRST_NAME: firstVal, SUBJECT: parts.subject || "", ICEBREAKER: parts.icebreaker || "", QUESTION: parts.question || "",
    // ONE_LINE: the AI's new wording for this email, else the offer's line. (19 Nov 2026: FOLLOW_UP had been lost behind
    // this comment on the same line, so every follow-up showed "[FOLLOW_UP]" and writing with a sequence failed.)
    ONE_LINE: String(parts.one_line || oneLine || "").trim(),
    FOLLOW_UP: index > 0 ? (parts.follow_ups?.[index - 1] || "") : "",
    SENDER_NAME: String(s.sender_name || "").trim(), BUSINESS: String(s.business || "").trim(), BOOKING_LINK: String(s.booking_link || "").trim(),
  };
  const missing = new Set<string>();
  const fill = (text: string) => String(text || "").replace(FIELD_RE, (_m, f: string) => {
    const k = f.toUpperCase();
    if (k === "FIRST_NAME") return values.FIRST_NAME;
    if (values[k]) return values[k];
    if (k in values) missing.add(k); // unknown fields are flagged by the spam check instead
    return `[${k}]`;
  });
  // A/B/C: this lead's variant subject when the step has one (otherwise subject A).
  // A follow-up without its own subject stays in the thread, so it never takes a variant subject.
  // A task step: only its instruction, filled in (no subject, no footer, never sent).
  if (isTaskStep(step)) return { step: index, day: step.day, subject: "", body: tidy(fill(step.body)), missing: [...missing], kind: step.kind };
  const usesAiSubject = /\{\{SUBJECT\}\}/i.test(step.subject);
  const alts = usesAiSubject || (index > 0 && !step.subject.trim()) ? [] : (step.variants ?? []).filter((v) => v.trim());
  const own = variant > 0 && alts[variant - 1] ? alts[variant - 1] : step.subject;
  // A follow-up with no subject of its own stays in the same thread: "Re: " + the first email's subject.
  const subject = index === 0 || own.trim() ? fill(own) : `Re: ${threadSubject}`.trim();
  const body = tidy(`${fill(step.body)}\n\n${footer(s)}`);
  return { step: index, day: step.day, subject, body, missing: [...missing], ...(alts.length ? { variant: VARIANT_LETTERS[variant > alts.length ? 0 : variant] } : {}) };
}
export function renderAll(steps: Step[], parts: Partial<SequenceParts>, oneLine: string, s: SenderBits, variant = 0) {
  const list = steps.slice(0, MAX_STEPS);
  // follow_ups[k] is the AI text for the k-th email follow-up: give each step index its own, skipping task steps.
  let k = 0;
  const own = list.map((st, i) => (i > 0 && !isTaskStep(st) ? parts.follow_ups?.[k++] ?? "" : ""));
  parts = { ...parts, follow_ups: own.slice(1) };
  const first = list[0] ? renderStep(list[0], 0, parts, oneLine, s, "", variant) : null;
  return list.map((st, i) => (i === 0 && first ? first : renderStep(st, i, parts, oneLine, s, first?.subject ?? "", variant)));
}

// ---- Spam-word check, like Manyreach's "Check Spam". Each hit says why and what to do.
// "block" = must change before the sequence can be used (prices, payment, unknown merge fields, phishing).
// "warn"  = risky with spam filters or sounds like AI; change it if you can.
export type SpamHit = { word: string; level: "block" | "warn"; why: string };
const LISTS: { level: SpamHit["level"]; why: string; words: string[] }[] = [
  { level: "block", why: "Price or payment: keep every step a conversation, never money.", words: ["price", "prices", "pricing", "priced", "fee", "fees", "rate card", "invoice", "payment", "payments", "discount", "% off", "cheap", "cheapest", "affordable", "trial", "free trial",
    "for free", "free work", "free sample", "free test", "no charge", "money back", "refund"] },
  // "per month" alone is not a price ("How many videos do you edit per month?"); with an amount it is blocked above.
  { level: "warn", why: "Can read as money talk. Keep the first emails about their work, not cost.", words: ["per hour", "per month", "per video", "per minute", "free", "cost", "costs", "budget", "quote", "package", "packages", "deal", "bargain", "save money", "lowest", "pay"] },
  { level: "block", why: "Looks like phishing.", words: ["verify your account", "password", "login", "log in", "confirm your details", "account suspended", "bank details", "wire transfer", "click to verify"] },
  { level: "warn", why: "Common spam-filter trigger.", words: ["guarantee", "guaranteed", "act now", "limited time", "urgent", "100%", "risk-free", "no obligation", "click here", "click below",
    "winner", "congratulations", "cash", "$$$", "offer expires", "earn", "income", "double your", "increase sales", "buy now", "order now", "special promotion", "exclusive deal",
    "once in a lifetime", "don't miss", "amazing", "incredible", "miracle", "best price", "lowest price", "100% free", "no cost", "apply now", "call now", "sign up free",
    "dear friend", "hello dear", "this isn't spam", "not spam", "unsubscribe here", "opportunity"] },
  { level: "warn", why: "Sounds like AI writing.", words: ["leverage", "elevate", "seamless", "seamlessly", "unlock", "tailored", "synergy", "game-changer", "game changer", "cutting-edge",
    "revolutionize", "revolutionise", "supercharge", "skyrocket", "delve", "robust", "holistic", "empower", "unparalleled", "world-class", "best-in-class", "transformative",
    "in today's fast-paced", "streamline", "harness", "navigate the", "landscape", "ever-evolving", "i hope this email finds you well", "i hope this finds you well", "just following up",
    "just checking in", "bumping this", "circling back", "touch base"] },
];
const esc = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const RES = LISTS.flatMap((l) => l.words.map((w) => ({ word: w, level: l.level, why: l.why, // Word edges only where the word starts or ends with a letter or digit, so "% off" in "20% off" still matches.
  re: new RegExp(`${/^[a-z0-9]/i.test(w) ? "(^|[^a-z0-9])" : ""}${esc(w)}${/[a-z0-9]$/i.test(w) ? "([^a-z0-9]|$)" : ""}`, "i") })));

export function spamCheck(text: string): SpamHit[] {
  // "feel free to", "free to call", "hands-free": everyday phrases, not money talk (UX audit row 16).
  const t = String(text || "").replace(FIELD_RE, " ").replace(/\b(feel free|free to|hands-free|stress-free|free time|free up)\b/gi, " ");
  const hits = new Map<string, SpamHit>();
  for (const r of RES) if (r.re.test(` ${t} `)) hits.set(r.word, { word: r.word, level: r.level, why: r.why });
  // Money amounts in any form: $50, £1,200, 30 USD, €9.
  for (const m of t.matchAll(/(?:[$£€¥₹৳]\s?\d(?:[\d,.]*\d)?k?|\b\d(?:[\d,.]*\d)?\s?(?:usd|gbp|eur|dollars?|pounds?|euros?|bdt|taka)\b)/gi)) {
    hits.set(m[0], { word: m[0], level: "block", why: "A price or amount of money. Never put prices in any step." });
  }
  const shouting = t.match(/\b[A-Z]{4,}\b/g)?.filter((w) => !["HTML", "HTTP", "HTTPS"].includes(w)) ?? [];
  if (shouting.length) hits.set("CAPS", { word: shouting.slice(0, 3).join(", "), level: "warn", why: "Words in capitals look like shouting to spam filters." });
  if (/!{2,}|\?{2,}/.test(t)) hits.set("!!", { word: "!! or ??", level: "warn", why: "Repeated ! or ? looks like spam." });
  const links = t.match(/https?:\/\/|www\./gi)?.length ?? 0;
  if (links > 1) hits.set("links", { word: `${links} links`, level: "warn", why: "Cold emails do best with no links, at most one." });
  for (const f of unknownFields(text)) hits.set(`{{${f}}}`, { word: `{{${f}}}`, level: "block", why: "Unknown merge field. Use one from the list." });
  return [...hits.values()].sort((a, b) => (a.level === b.level ? 0 : a.level === "block" ? -1 : 1));
}
// Checks a whole sequence: every step's subject and body, plus the shape rules from the class.
export function checkSequence(steps: Step[]) {
  const out: { step: number; hits: SpamHit[] }[] = steps.map((s, i) => ({ step: i, hits: isTaskStep(s) ? [] : spamCheck(`${s.subject}\n${(s.variants ?? []).join("\n")}\n${s.body}`) }));
  const problems: string[] = [];
  if (!steps.length) problems.push("Add the first email.");
  if (steps.length > MAX_STEPS) problems.push(`At most ${MAX_STEPS} steps: the first email and 3 follow-ups.`);
  if (steps[0] && isTaskStep(steps[0])) problems.push("The first step must be an email.");
  if (steps[0] && !steps[0].subject.trim()) problems.push("The first email needs a subject.");
  steps.forEach((s, i) => {
    if (!s.body.trim()) problems.push(`Step ${i + 1} has no text.`);
    if (i > 0 && !(s.day > steps[i - 1].day)) problems.push(`Follow-up ${i} must come after the step before it.`);
    if (s.day > 90) problems.push(`Follow-up ${i} is too late (90 days at most).`);
  });
  if (steps[0] && !/\{\{\s*(ICEBREAKER|QUESTION)\s*\}\}/i.test(steps[0].body)) problems.push("The first email should use {{ICEBREAKER}} or {{QUESTION}} so it is personal.");
  return { steps: out, problems, blocked: problems.length > 0 || out.some((s) => s.hits.some((h) => h.level === "block")) };
}

// Cleans steps typed in the App or read from the database.
export function cleanSteps(raw: unknown): Step[] {
  if (!Array.isArray(raw)) return DEFAULT_STEPS;
  const steps = raw.slice(0, MAX_STEPS).flatMap((x, i) => {
    const s = x as Record<string, unknown>;
    if (!s || typeof s !== "object") return [];
    const day = Math.max(0, Math.min(90, Math.round(Number(s.day) || 0)));
    const variants = (Array.isArray(s.variants) ? s.variants : []).map((v) => String(v ?? "").slice(0, 200)).filter((v) => v.trim()).slice(0, MAX_VARIANTS - 1);
    // The first step is always an email, so a task kind there is ignored.
    const kind = i > 0 && ["linkedin", "call", "task"].includes(String(s.kind)) ? (String(s.kind) as StepKind) : undefined;
    return [{ day, subject: kind ? "" : String(s.subject ?? "").slice(0, 200), body: String(s.body ?? "").slice(0, 4000), ...(variants.length && !kind ? { variants } : {}), ...(kind ? { kind } : {}) }];
  });
  if (!steps.length) return DEFAULT_STEPS;
  steps[0].day = 0;
  return steps;
}

// The same check the database runs on every email before it joins a campaign (email_steps_problem, 039 → 054), so the
// App and the connector can say it when emails are saved, not only at Start (Batch 001 feedback #4). Keep in step with SQL.
const OPT_OUT_RE = /(not interested|reply (with )?["'“]?no\b|unsubscribe|opt[- ]?out|rather not|won'?t (email|contact|write)|remove you|no more emails)/i;
const MONEY_RE = /[$€£¥]\s?[0-9]|\b[0-9]+([.,][0-9]+)?\s?(usd|eur|gbp|dollars?|euros?|pounds?)\b/i;
const PRICE_RE = /\b(price|prices|pricing|priced|fee|fees|rate card|invoice|payment|payments|discount|cheap|cheapest|affordable|trial|free trial|for free|free work|free sample|free test|no charge|money back|refund)\b|% off/i;
export function emailStepsProblem(steps: { subject?: string; body?: string; kind?: string }[] | null | undefined): string | null {
  if (!Array.isArray(steps)) return null;
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if ((s.kind ?? "email") !== "email") continue;
    const txt = `${s.subject ?? ""}\n${s.body ?? ""}`;
    if (!OPT_OUT_RE.test(txt)) return `email ${i + 1} has no opt-out line`;
    if (/\[[A-Z][A-Z_]{2,}\]/.test(txt) || /\{\{|\}\}/.test(txt)) return `email ${i + 1} still has an empty merge field`;
    if (MONEY_RE.test(txt)) return `email ${i + 1} mentions a money amount`;
    if (PRICE_RE.test(txt)) return `email ${i + 1} has price or payment words`;
  }
  return null;
}
