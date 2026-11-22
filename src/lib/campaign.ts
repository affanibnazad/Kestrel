// Kestrel Mail, phase 3: campaigns. Shared types and the pure helpers the sending server and the App both use.

import { SITE } from "./site";

export type CampaignStatus = "draft" | "running" | "paused" | "stopped" | "done";
export type Campaign = {
  id: string; team_id: string; name: string; sequence_id: string | null; mailbox_ids: string[]; status: CampaignStatus;
  time_zone: string; window_start: number; window_end: number; weekdays_only: boolean; track_opens: boolean; verify_emails: boolean; lead_time_zone?: boolean; stop_company?: boolean; paused_reason: string | null; tested_at: string | null; started_at: string | null; created_at: string;
  stopped_at?: string | null; skipped?: SkippedLead[] | null;
};
export type SkippedLead = { lead_id: string; name: string | null; email: string | null; reason: string };
export const CAMPAIGN_COLUMNS = "id,team_id,name,sequence_id,mailbox_ids,status,time_zone,window_start,window_end,weekdays_only,track_opens,verify_emails,paused_reason,tested_at,started_at,created_at";
// With the M2 sending options (database 026). Before 026 the App uses CAMPAIGN_COLUMNS.
export const CAMPAIGN_COLUMNS_M2 = `${CAMPAIGN_COLUMNS},lead_time_zone,stop_company`;
// With who/when stopped and the skipped leads (database 051). Before 051 the App falls back to M2.
export const CAMPAIGN_COLUMNS_M3 = `${CAMPAIGN_COLUMNS_M2},stopped_at,skipped`;
export type CampaignLeadStatus = "active" | "done" | "replied" | "unsubscribed" | "blocked" | "failed" | "stopped" | "bounced";

// One email the timer asked the server to send (from mail_due).
export type DueEmail = {
  id: string; step: number; steps_total: number; to: string; subject: string; body: string;
  thread_id: string | null; first_sent_at: string | null; unsub_token: string; track?: { domain: string; token: string } | null; verify_key?: string | null;
  box: { id: string; email: string; from_name: string; smtp_host: string; smtp_port: number; imap_host: string | null; imap_port: number | null; username: string; password: string };
};

export const unsubscribeUrl = (token: string, origin = SITE.url) => `${origin}/api/mail/unsubscribe?t=${encodeURIComponent(token)}`;

// Headers every campaign email gets: one-click unsubscribe (RFC 8058, what Gmail and Yahoo ask bulk senders for),
// and for follow-ups the first email's Message-ID so they stay in the same thread.
export function campaignHeaders(e: Pick<DueEmail, "unsub_token" | "thread_id" | "step" | "box">, origin = SITE.url) {
  const h: Record<string, string> = {
    "List-Unsubscribe": `<${unsubscribeUrl(e.unsub_token, origin)}>, <mailto:${e.box.email}?subject=unsubscribe>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
  if (e.step > 0 && e.thread_id) { h["In-Reply-To"] = e.thread_id; h["References"] = e.thread_id; }
  return h;
}

// "Name" <email>, with quotes removed from the name so the header stays valid.
export const fromHeader = (name: string, email: string) => (name.trim() ? `"${name.replace(/["\r\n]/g, "").trim()}" <${email}>` : email);

// Sign-in problems mean the mailbox itself is broken (stop using it); anything else is retried later.
export const isLoginError = (message: string) => /auth|535|534|credentials|invalid login|username and password|EAUTH/i.test(message);

// Common time zones for the picker (any IANA name works).
export const TIME_ZONES = ["Europe/London", "Europe/Dublin", "Europe/Berlin", "Europe/Paris", "America/New_York", "America/Chicago", "America/Los_Angeles",
  "Asia/Dhaka", "Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Australia/Sydney"];

// A lead is ready for a campaign when it has an email and a written first email (with or without follow-ups).
export type ReadyLead = { id: string; email: string | null; outreach?: { body?: string; steps?: { day: number; subject: string; body: string }[]; qc?: { status?: string; issues?: string[] } } | null };
// Phase 4C (database 068): an email the QC bot held is left out of campaigns until someone approves it.
export const isHeld = (o: ReadyLead["outreach"]) => o?.qc?.status === "hold";
export const stepsOf = (o: ReadyLead["outreach"]) => (o?.steps?.length ? o.steps : o?.body ? [{ day: 0, subject: "", body: o.body }] : []);
export const isReady = (l: ReadyLead) => Boolean(l.email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(l.email) && stepsOf(l.outreach).length);

export const STATUS_NAMES: Record<CampaignStatus, string> = { draft: "Not started", running: "Sending", paused: "Paused", stopped: "Stopped", done: "Finished" };

// ---------- Mail phase 4: reading what comes back (pure, so it can be tested)
export type InboxKind = "reply" | "remove" | "bounce" | "auto";
export type InboxItem = { uid: number; from: string; subject: string; snippet: string; body?: string; message_id?: string; date: string | null; kind: InboxKind; bounced_to?: string; refs?: string[] };

// The readable part of an email: headers dropped, quoted earlier messages ("> …", "On … wrote:") cut, HTML tags removed.
export function readableText(source: string) {
  const raw = String(source || "");
  const split = raw.search(/\r?\n\r?\n/);
  let body = split >= 0 ? raw.slice(split).trim() : raw;
  // A message with several parts (plain text + HTML): keep only the plain-text part, decoded.
  const part = /Content-Type:\s*text\/plain[^\n]*\n((?:[ \t]*[^\s][^\n]*\n)*?)\r?\n([\s\S]*?)(?=\r?\n--[^\n]+|$)/i.exec(raw);
  if (part && /multipart\//i.test(raw.slice(0, split >= 0 ? split : raw.length))) {
    body = part[2];
    if (/Content-Transfer-Encoding:\s*base64/i.test(part[1])) { try { body = Buffer.from(body.replace(/\s+/g, ""), "base64").toString("utf8"); } catch { /* keep as is */ } }
  }
  body = body.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));   // quoted-printable
  body = body.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
  const lines: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    const t = line.trim();
    if (/^(On .+wrote:|-----Original Message-----|From: .+@)/i.test(t)) break;
    // Gmail sometimes wraps "On … <name@x.com> wrote:" onto two lines.
    if (/^wrote:$/i.test(t) && lines.length && /^On /i.test(lines[lines.length - 1])) { lines.pop(); break; }
    if (t.startsWith(">") || /^--[0-9A-Za-z_=.-]{6,}/.test(t) || /^Content-(Type|Transfer-Encoding|Disposition):/i.test(t)) continue;
    lines.push(t);
  }
  return lines.join(" ").replace(/\s+/g, " ").trim();
}

// "Remove me", "unsubscribe", "stop emailing me", "not interested, take me off", a bare "no" (the opt-out line asks for it).
export function isRemoveRequest(text: string) {
  const t = ` ${String(text || "").toLowerCase().replace(/[^a-z' ]+/g, " ").replace(/\s+/g, " ").trim()} `;
  if (/^ (no|nope|no thanks|no thank you|stop|remove|unsubscribe) $/.test(t)) return true;
  // The same short answer with a sign-off after it: "No. Regards, Sam", "no thanks, best John", "Nope / Sent from my iPhone".
  // At most two words after the sign-off (a name, "iPhone"), so "No. Best time is Tuesday" stays a normal reply.
  const core = t.replace(/ (sent from my|get outlook for|kind regards|best regards|warm regards|best wishes|regards|best|thanks|thank you|cheers|sincerely)( [a-z']+){0,2} $/, " ");
  if (/^ (no|nope|no thanks|no thank you|stop|remove|unsubscribe) $/.test(core)) return true;
  return /\b(remove me|unsubscribe|take me off|stop (emailing|e mailing|contacting|sending)|don't (email|contact) me|do not (email|contact) me|opt me out|opt out|remove (my|this) (email|address)|not interested please remove)\b/.test(t);
}

// Decides what a message in the mailbox is. headers: the raw header block (lower-case names fine).
// text: the readable reply; raw: the whole message (bounce reports keep the failed address in a part readableText drops).
export function classifyMessage(m: { from: string; subject: string; headers: string; text: string; raw?: string; mailbox: string }): { kind: InboxKind; bounced_to?: string; refs?: string[] } | null {
  const from = m.from.toLowerCase(), subject = m.subject || "", headers = m.headers || "", text = m.text || "", raw = m.raw || text;
  if (!from || from === m.mailbox.toLowerCase()) return null;
  // Bounces: only a real delivery-status report from the mail system. Anyone can send an email that *looks* like a bounce,
  // so the database also checks that the report quotes the Message-ID of an email this mailbox really sent (refs).
  const fromSystem = /^(mailer-daemon|postmaster|mail-daemon)@/.test(from);
  const isReport = /content-type:\s*multipart\/report/i.test(headers) && /report-type=\"?delivery-status/i.test(headers);
  if (fromSystem || isReport) {
    if (!(fromSystem && isReport)) return null;   // looks like a bounce but is not a real one: ignore it
    const fr = /(?:Final|Original)-Recipient:\s*rfc822;\s*<?([^\s>;]+@[^\s>;]+)/i.exec(raw);
    const refs = [...new Set([...raw.matchAll(/^(?:Message-ID|In-Reply-To|References):\s*(<[^>\s]+>)/gim)].map((x) => x[1]))].slice(0, 20);
    return fr && refs.length ? { kind: "bounce", bounced_to: fr[1].toLowerCase(), refs } : null;
  }
  // Out of office and other automatic answers do not stop follow-ups.
  if (/^auto-submitted:\s*auto-(replied|generated)/im.test(headers) || /^x-autoreply:/im.test(headers) || /^x-autorespond:/im.test(headers)
    || /^precedence:\s*(auto_reply|bulk|junk)/im.test(headers)
    || /^(automatic reply|auto(matic)?[- ]?reply|out of (the )?office|ooo\b|abwesenheitsnotiz|réponse automatique)/i.test(subject)) return { kind: "auto" };
  // The List-Unsubscribe mailto sends the subject "unsubscribe" (body empty or written by the mail app).
  const bareSubject = subject.replace(/^((re|aw|fw|fwd|sv)\s*:\s*)+/i, "").trim().toLowerCase();
  if (/^(unsubscribe|remove me|remove|opt out|opt-out|stop)$/.test(bareSubject)) return { kind: "remove" };
  return { kind: isRemoveRequest(text.slice(0, 400)) ? "remove" : "reply" };
}

// The HTML copy of a plain-text email for open tracking: the same words (escaped, line breaks kept), no links added,
// and a 1×1 image at the end. Only used with the team's own tracking domain.
export function trackedHtml(text: string, pixelUrl: string) {
  const esc = String(text || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const body = esc.split(/\n{2,}/).map((p) => `<p style="margin:0 0 14px">${p.replace(/\n/g, "<br>")}</p>`).join("");
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#111">${body}</div><img src="${pixelUrl.replace(/"/g, "%22")}" width="1" height="1" alt="" style="display:block;border:0;width:1px;height:1px">`;
}

// Hunter's email verifier: "invalid" and "disposable" addresses are never sent to. Other answers (valid, accept_all,
// webmail, unknown) are sent. If Hunter cannot answer (no credits, network), the email is sent as before.
export function verdictOf(hunter: unknown): "send" | "invalid" {
  const st = String((hunter as { data?: { status?: string } })?.data?.status || "");
  return st === "invalid" || st === "disposable" ? "invalid" : "send";
}

// ---------- Replies lead status (database 020), like the leading tools' "Interested / Meeting booked / …" labels.
export type Stage = "interested" | "meeting" | "not_now" | "not_interested" | "wrong_person" | "won" | "lost";
export const STAGES: [Stage, string, string][] = [
  ["interested", "Interested", "good"], ["meeting", "Meeting booked", "good"], ["not_now", "Not now", "maybe"],
  ["not_interested", "Not interested", "no"], ["wrong_person", "Wrong person", "maybe"], ["won", "Won", "good"], ["lost", "Lost", "dnc"],
];
export const stageName = (s: string | null | undefined) => STAGES.find((x) => x[0] === s)?.[1] ?? "";
export const LEAD_STATUS: Record<CampaignLeadStatus, string> = { active: "Sending", done: "All steps sent", replied: "Replied", unsubscribed: "Unsubscribed", bounced: "Bounced", blocked: "Do-not-contact", failed: "Failed", stopped: "Stopped" };

// Per-step numbers for a campaign (campaign_step_stats, database 020).
export type StepStat = { step: number; sent: number; replies: number; bounced: number; unsubscribed: number; opened: number };
export const rate = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : "0%");

// ---- UX audit fixes (17 Nov 2026)
// Same set of email accounts (order does not matter).
export const sameBoxes = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join();
// A test counts for a campaign when it has its own, or another campaign with the same sequence and the same email
// accounts was tested in the last 30 days (the database checks the same in start_campaign, 051).
export function testOk(c: Pick<Campaign, "id" | "sequence_id" | "mailbox_ids" | "tested_at">, all: Pick<Campaign, "id" | "sequence_id" | "mailbox_ids" | "tested_at">[], now: number) {
  if (c.tested_at) return true;
  return Boolean(c.sequence_id) && all.some((o) => o.id !== c.id && o.sequence_id === c.sequence_id && o.tested_at && now - Date.parse(o.tested_at) < 30 * 864e5 && sameBoxes(o.mailbox_ids, c.mailbox_ids));
}
// How many sending days the first emails take, using each account's limit today and the slow start (+2 a day up to its
// daily limit), weekends skipped when the campaign sends on weekdays only. Returns the days and the last sending date.
export type BoxToday = { daily_limit: number; limit_today?: number | null; ramp_up?: boolean | null };
// The first emails day by day: how many go out on each sending day (slow start included). An estimate: the
// sender also keeps to 2 first emails a day per company domain and to the sending window.
export function firstEmailPlan(n: number, boxes: BoxToday[], weekdaysOnly: boolean, from = new Date()) {
  const plan: { date: Date; count: number }[] = [];
  if (n <= 0 || !boxes.length) return plan;
  const d = new Date(from); let left = n, step = 0;
  while (left > 0 && plan.length < 3650) {
    const wd = d.getDay();
    if (!(weekdaysOnly && (wd === 0 || wd === 6))) {
      const can = boxes.reduce((sum, b) => {
        const max = Math.min(b.daily_limit || 25, 200), today = b.limit_today ?? max;
        return sum + (b.ramp_up === false ? max : Math.min(max, today + 2 * step));
      }, 0);
      if (can <= 0) break;
      plan.push({ date: new Date(d), count: Math.min(can, left) });
      left -= can; step++;
    }
    d.setDate(d.getDate() + 1);
  }
  return plan;
}
export function firstEmailDays(n: number, boxes: BoxToday[], weekdaysOnly: boolean, from = new Date()) {
  const plan = firstEmailPlan(n, boxes, weekdaysOnly, from);
  return { days: plan.length, until: plan.length ? plan[plan.length - 1].date : null as Date | null };
}
// Which sending day (0 = the first) the lead at position i (0-based) in the send order falls on.
export function dayOfLead(i: number, plan: { count: number }[]) {
  let seen = 0;
  for (let k = 0; k < plan.length; k++) { seen += plan[k].count; if (i < seen) return k; }
  return Math.max(0, plan.length - 1);
}
// Merge fields only AI can fill. A sequence without them can be sent as written (filled from lead data).
export const AI_FIELDS = ["SUBJECT", "ICEBREAKER", "QUESTION", "FOLLOW_UP"];
// A company name as people say it ("Harbour Social Ltd" → "Harbour Social").
export const plainName = (name: string | null | undefined) => String(name || "").replace(/\s*[,(].*$/, "").replace(/\s+(ltd|limited|llc|inc|gmbh|plc|co)\.?$/i, "").trim();
