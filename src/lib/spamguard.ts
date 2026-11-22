// Kestrel Spam Guard, part A: one content score (0–100, grade A–F) for any email, like the spam scores in Instantly
// and Mailmeteor. Pure, so the App (Sequences, drafts, Replies, the Spam check panel, campaign start) and the server
// use the same rules. It builds on the spam-word list in sequence.ts. Content is only one part of inbox placement:
// reputation, warmup and the recipient's own behaviour matter too (plan 11).
import { spamCheck } from "./sequence";

export type Level = "red" | "orange" | "info";
export type Issue = { id: string; level: Level; title: string; fix: string; match?: string; points: number };
export type Score = { score: number; grade: "A" | "B" | "C" | "D" | "F"; issues: Issue[]; blocked: boolean; words: number };
export type Input = {
  subject: string;
  body: string;
  step?: number;          // 0 = first email; follow-ups may keep the thread's subject
  template?: boolean;     // a Sequences template: {{FIELDS}} are fine and the footer (address + opt-out) is added by Kestrel
  reply?: boolean;        // an answer in Replies: "Re:" and no opt-out line are normal
  paste?: boolean;        // pasted into the spam checker: campaigns add the opt-out themselves, so a missing one is only a warning
};

const SHORTENERS = /\b(bit\.ly|tinyurl\.com|t\.co|goo\.gl|ow\.ly|is\.gd|buff\.ly|rebrand\.ly|cutt\.ly|shorturl\.at|tiny\.cc|rb\.gy|lnkd\.in)\//i;
const PHISHING = /\b(verify your (account|identity|email)|confirm your (account|password|details)|your account (has been|will be) (suspended|closed|locked)|update your (payment|billing|bank)|wire transfer|bank details|login details|reset your password|unusual (sign-?in|activity))\b/i;
const OPT_OUT = /(not interested|reply (with )?["'“]?no\b|unsubscribe|opt[- ]?out|let me know if (you'?d|you would) rather not|won'?t (email|contact|write)( (to )?you)? again|remove you|no more emails)/i;
const PERSONAL = /\{\{\s*(ICEBREAKER|QUESTION|FIRST_NAME|COMPANY|NAME)\s*\}\}/i;

const clip = (s: string, n = 40) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function scoreEmail(x: Input): Score {
  const subject = String(x.subject || "").trim(), body = String(x.body || "").trim(), step = x.step ?? 0;
  const issues: Issue[] = [];
  const add = (i: Issue) => { if (!issues.some((o) => o.id === i.id)) issues.push(i); };

  // 1. Words and amounts that spam filters punish (the Sequences list): red = never send, orange = rewrite if you can.
  for (const h of spamCheck(`${subject}\n${body}`)) {
    if (!x.template && /^\{\{/.test(h.word)) continue;   // finished emails: reported once below as "not filled"
    add({ id: `w:${h.word}`, level: h.level === "block" ? "red" : "orange", title: h.level === "block" ? `“${clip(h.word)}”` : `“${clip(h.word)}”`, fix: h.why, match: h.word, points: h.level === "block" ? 25 : 7 });
  }

  // 2. Subject line.
  if (!subject && step === 0 && !x.reply) add({ id: "subj-empty", level: "red", title: "No subject", fix: "Write 3–6 lower-case words about them, for example “quick question about your reels”.", points: 20 });
  const subjText = subject.replace(/\{\{[^}]*\}\}/g, "").trim();   // {{FIELDS}} are filled in later
  if (subjText) {
    if (subject.length > 60) add({ id: "subj-long", level: "orange", title: `Subject is long (${subject.length} characters)`, fix: "Keep it under 60 characters; 3–6 words reads like a real person.", points: 6 });
    if (/!/.test(subject)) add({ id: "subj-bang", level: "orange", title: "“!” in the subject", fix: "Remove the exclamation mark; it looks like an advert.", points: 6 });
    if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(subject)) add({ id: "subj-emoji", level: "orange", title: "Emoji in the subject", fix: "Remove it; cold emails with emoji go to Promotions or spam more often.", points: 6 });
    if (subjText.length > 8 && subjText === subjText.toUpperCase() && /[A-Z]/.test(subjText)) add({ id: "subj-caps", level: "red", title: "Subject in capitals", fix: "Write the subject in normal lower case.", points: 15 });
    if (/^\s*(re|fwd?|fw)\s*:/i.test(subject) && step === 0 && !x.reply) add({ id: "subj-fake-re", level: "red", title: "Fake “Re:” or “Fwd:”", fix: "Remove it. Pretending to reply is a known spam trick and breaks trust.", points: 18 });
  }

  // 3. Length.
  const plain = body.replace(/\{\{[^}]*\}\}/g, "word").replace(/https?:\/\/\S+/g, "link");
  const words = (plain.match(/[\p{L}\p{N}'’-]+/gu) ?? []).length;
  const hasFields = /\{\{[^}]*\}\}/.test(body);
  if (words > 0 && words < 25 && !x.reply && !(x.template && hasFields)) add({ id: "short", level: "orange", title: `Very short (${words} words)`, fix: "Add one line about them and one clear question. 50–125 words works best.", points: 4 });
  if (words > 250) add({ id: "too-long", level: "red", title: `Too long (${words} words)`, fix: "Cut it to 50–125 words. Long cold emails get fewer replies and more spam flags.", points: 15 });
  else if (words > 150) add({ id: "long", level: "orange", title: `Long (${words} words)`, fix: "Aim for 50–125 words: one personal line, one sentence on what you do, one question.", points: 6 });

  // 4. Links, images and HTML.
  const links = body.match(/https?:\/\/\S+|www\.\S+/gi) ?? [];
  if (SHORTENERS.test(body)) add({ id: "shortener", level: "red", title: "Link shortener", fix: "Never use bit.ly and similar in cold email: spam filters block them. Use your own full link, or none.", points: 20 });
  if (links.some((l) => /\bhttp:\/\//i.test(l))) add({ id: "http", level: "orange", title: "Link without https", fix: "Use the https:// version of the link.", points: 4 });
  if (/<\s*(img|html|div|table|a\s+href)\b/i.test(body)) add({ id: "html", level: "orange", title: "HTML or images", fix: "Send plain text. Images and HTML look like marketing and land in Promotions.", points: 8 });
  if (/\b(attached|attachment|see the pdf|download (the|our))\b/i.test(body) && step === 0) add({ id: "attach", level: "orange", title: "Mentions an attachment or download", fix: "Never attach files to a first cold email. Offer to send it if they are interested.", points: 6 });

  // 5. Phishing look-alikes.
  const ph = body.match(PHISHING);
  if (ph) add({ id: "phishing", level: "red", title: `Looks like phishing: “${clip(ph[0])}”`, fix: "Remove account, password or bank wording; filters treat it as a scam.", match: ph[0], points: 25 });

  // 6. Personal touch and opt-out (the class rules).
  if (x.template && step === 0 && !PERSONAL.test(body)) add({ id: "not-personal", level: "orange", title: "Not personal", fix: "Use {{ICEBREAKER}} or {{QUESTION}} so each lead gets a line about their own business.", points: 8 });
  if (!x.template && !x.reply && (/\{\{|\}\}/.test(body) || /\[[A-Z][A-Z_]{2,}\]/.test(body))) add({ id: "unfilled", level: "red", title: "A merge field was not filled", fix: "Some text still shows {{…}}. Write this lead's email again, or fix the field.", points: 25 });
  if (!x.template && !x.reply && step >= 0 && !OPT_OUT.test(body)) add(x.paste
    ? { id: "no-opt-out", level: "info", title: "No opt-out line here", fix: "Fine for Kestrel campaigns: Kestrel adds your name, postal address and the opt-out line under every email. Add one only if you send this email by hand.", points: 0 }
    : { id: "no-opt-out", level: "red", title: "No opt-out line", fix: "Every cold email needs a way out, e.g. “If this isn't for you, just reply “no” and I won't email again.”", points: 15 });
  if (x.template && step === 0) add({ id: "footer-auto", level: "info", title: "Opt-out and address are added for you", fix: "Kestrel adds your name, postal address and the opt-out line under every step.", points: 0 });

  // 7. Shape: many "!" or "?" in the body, one big block.
  const bangs = (body.match(/!/g) ?? []).length;
  if (bangs > 2) add({ id: "bangs", level: "orange", title: `${bangs} exclamation marks`, fix: "Use at most one.", points: 4 });
  if (words > 80 && !/\n\s*\n/.test(body)) add({ id: "wall", level: "orange", title: "One long block of text", fix: "Split it into 2–4 short paragraphs.", points: 3 });

  const lost = issues.reduce((n, i) => n + i.points, 0);
  const score = Math.max(0, Math.min(100, 100 - lost));
  const blocked = issues.some((i) => i.level === "red");
  const grade = score >= 90 && !blocked ? "A" : score >= 80 && !blocked ? "B" : score >= 70 && !blocked ? "C" : score >= 55 ? "D" : "F";
  issues.sort((a, b) => (a.level === b.level ? b.points - a.points : a.level === "red" ? -1 : b.level === "red" ? 1 : a.level === "orange" ? -1 : 1));
  return { score, grade, issues, blocked, words };
}

// The worst score over several emails (a lead's whole sequence, or a campaign).
export function worstOf(scores: Score[]) {
  return scores.reduce<Score | null>((w, s) => (!w || s.score < w.score || (s.blocked && !w.blocked) ? s : w), null);
}
export const gradeTone = (g: Score["grade"]) => (g === "A" || g === "B" ? "good" : g === "C" || g === "D" ? "maybe" : "no");
