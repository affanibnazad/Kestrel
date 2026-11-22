// The lead pipeline (Kestrel AI platform plan, Phase 1; Affan, 18 Nov 2026): every lead is in exactly one stage,
// worked out from what Kestrel already knows about it, so the stage is always right without anyone keeping it up to date.
// Only the end of the road (Meeting, Won, Lost) is saved by hand, on the lead (data.result, database 058), or comes from
// the reply status set in Replies (campaign_leads.stage).
//
//   To review → Needs email → Write emails → Ready to send → In outreach → Replied → Meeting → Won / Lost
//   (plus Not a fit and Removed, kept off the board)

export type StageId = "review" | "email" | "write" | "ready" | "outreach" | "replied" | "meeting" | "won" | "lost" | "nofit" | "removed";
export type MailState = "queued" | "emailed" | "replied";
export type ConvStage = "interested" | "meeting" | "not_now" | "not_interested" | "wrong_person" | "won" | "lost";
export type LeadResult = { stage: "meeting" | "won" | "lost"; value?: number | null; currency?: string | null; reason?: string | null; at?: string };

export type PipelineLead = {
  verdict: "Good" | "Maybe" | "No" | null; status?: "new" | "kept" | "removed";
  email: string | null; written?: boolean; result?: LeadResult | null;
};

// Columns in order, with what moving a lead INTO the column does ("drop").
//   verdict: set Good / No / back to review   result: save Meeting / Won / Lost   none: the App moves leads here by itself
export const STAGES: { id: StageId; name: string; help: string; drop: "review" | "good" | "nofit" | "result" | "none" }[] = [
  { id: "review", name: "To review", help: "New leads nobody has looked at yet, and leads marked Maybe. Drag a lead right to say it is a good fit.", drop: "review" },
  { id: "email", name: "Needs email", help: "Good leads without an email address. Find emails for them in Leads.", drop: "good" },
  { id: "write", name: "Write emails", help: "Good leads with an email but no written email yet. Write them in Kestrel AI → Score and write.", drop: "good" },
  { id: "ready", name: "Ready to send", help: "Good leads with an email and a written email, not in a campaign yet. Add them to a campaign.", drop: "good" },
  { id: "outreach", name: "In outreach", help: "In a campaign: waiting to send or already emailed, no answer yet. Leads arrive here when a campaign starts.", drop: "none" },
  { id: "replied", name: "Replied", help: "They answered. Set what happens next in Replies, or drag the lead to Meeting, Won or Lost.", drop: "none" },
  { id: "meeting", name: "Meeting", help: "Interested, or a meeting is booked.", drop: "result" },
  { id: "won", name: "Won", help: "They became a client. Kestrel asks the deal value.", drop: "result" },
  { id: "lost", name: "Lost", help: "Not now, not interested or wrong person. Kestrel asks why, so you learn from it.", drop: "result" },
];
export const OFF_BOARD: { id: StageId; name: string }[] = [{ id: "nofit", name: "Not a fit" }, { id: "removed", name: "Removed" }];

export const LOST_REASONS = ["Not interested", "Not now", "Wrong person", "Too expensive", "Chose someone else", "No answer", "Other"] as const;

const CONV_TO_STAGE: Record<ConvStage, StageId> = {
  interested: "meeting", meeting: "meeting", won: "won", lost: "lost", not_now: "lost", not_interested: "lost", wrong_person: "lost",
};

// The one stage of a lead. Later stages win: a result beats a reply, a reply beats being in a campaign, and so on.
export function leadStage(l: PipelineLead, mail?: MailState | null, conv?: ConvStage | null): StageId {
  if (l.status === "removed") return "removed";
  if (l.result?.stage) return l.result.stage;
  if (conv && CONV_TO_STAGE[conv]) return CONV_TO_STAGE[conv];
  if (mail === "replied") return "replied";
  if (mail === "queued" || mail === "emailed") return "outreach";
  if (l.verdict === "No") return "nofit";
  const good = l.verdict === "Good" || (l.status === "kept" && l.verdict !== "Maybe");
  if (!good) return "review";
  if (!l.email) return "email";
  if (!l.written) return "write";
  return "ready";
}

// Reading the saved result safely (it comes from the database as JSON).
export function readResult(v: unknown): LeadResult | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  if (r.stage !== "meeting" && r.stage !== "won" && r.stage !== "lost") return null;
  const value = typeof r.value === "number" && Number.isFinite(r.value) ? r.value : null;
  return { stage: r.stage, value, currency: typeof r.currency === "string" ? r.currency : null, reason: typeof r.reason === "string" ? r.reason : null, at: typeof r.at === "string" ? r.at : undefined };
}

// "1,200" / "$1.2k" / "1200 usd" → 1200; empty → null; anything else → NaN (ask again).
export function parseMoney(text: string): number | null {
  const t = text.trim().toLowerCase().replace(/[,\s$€£]|usd|eur|gbp/g, "");
  if (!t) return null;
  const m = t.match(/^(\d+(?:\.\d+)?)(k)?$/);
  if (!m) return NaN;
  const n = Number(m[1]) * (m[2] ? 1000 : 1);
  return n >= 0 && n <= 100_000_000 ? Math.round(n * 100) / 100 : NaN;
}
