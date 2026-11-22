import "server-only";
import { fromHeader } from "./campaign";
import { teamDnc } from "./dnc-server";
import { dncBlocks } from "./dnc";
import type { supabaseServer } from "./supabase/server";
import { ATTACH_MAX_BYTES, REPLY_ALIGNS, REPLY_SIZES, attachmentProblem, parseEmails, replyHtml, replyPlain, safeFileName, type ReplyAlign, type ReplySize } from "./reply-format";

// One answer to a lead's reply, as the answer box sends it: checked text, Cc / Bcc, size, alignment and attachments.
// Shared by "Send" (/api/mail/reply), "Send later" (/api/mail/schedule) and the mail timer that sends scheduled
// answers (/api/mail/tick), so all three build exactly the same email.
export type AnswerFile = { name: string; type: string; data: string };   // data = base64
export type Answer = { text: string; cc: string[]; bcc: string[]; size: ReplySize; align: ReplyAlign; files: AnswerFile[] };

export function readAnswer(body: Record<string, unknown>): Answer | { error: string } {
  const text = typeof body.text === "string" ? body.text.replace(/\r/g, "").trim().slice(0, 5000) : "";
  if (text.length < 2) return { error: "Write your answer first." };
  const cc = parseEmails(typeof body.cc === "string" ? body.cc : Array.isArray(body.cc) ? body.cc.join(",") : "");
  const bcc = parseEmails(typeof body.bcc === "string" ? body.bcc : Array.isArray(body.bcc) ? body.bcc.join(",") : "");
  if (cc.bad.length || bcc.bad.length) return { error: `Check these addresses: ${[...cc.bad, ...bcc.bad].slice(0, 3).join(", ")}` };
  if (cc.tooMany || bcc.tooMany) return { error: "Cc and Bcc can have 5 addresses each." };
  const size: ReplySize = REPLY_SIZES.includes(body.size as ReplySize) ? (body.size as ReplySize) : "normal";
  const align: ReplyAlign = REPLY_ALIGNS.includes(body.align as ReplyAlign) ? (body.align as ReplyAlign) : "left";
  const raw = Array.isArray(body.files) ? body.files.slice(0, 4) : [];
  const files = raw.map((f) => {
    const x = f as { name?: unknown; type?: unknown; data?: unknown };
    const data = typeof x.data === "string" && /^[A-Za-z0-9+/=]*$/.test(x.data) ? x.data : "";
    return { name: safeFileName(String(x.name ?? "file")), type: typeof x.type === "string" && /^[\w.+-]+\/[\w.+-]+$/.test(x.type) ? x.type : "application/octet-stream", data };
  });
  const sized = files.map((f) => ({ ...f, size: Buffer.byteLength(f.data, "base64") }));
  const problem = attachmentProblem(sized) || (sized.some((f) => !f.size) ? "An attachment is empty." : "") || (sized.reduce((a, f) => a + f.size, 0) > ATTACH_MAX_BYTES ? "Attachments can be 3 MB in all." : "");
  if (problem) return { error: problem };
  return { text, cc: cc.ok, bcc: bcc.ok, size, align, files };
}

type Box = { email: string; from_name: string; signature?: string | null };
// The email itself: same thread as the lead's reply, plain text + formatted HTML, the mailbox's signature.
export function answerMessage(box: Box, to: string, subject: string | null, inReplyTo: string | null, a: Answer) {
  const sig = box.signature ? `\n\n${box.signature}` : "";
  const others = (list: string[]) => { const l = list.filter((e) => e !== to.toLowerCase()); return l.length ? l : undefined; };
  return {
    from: fromHeader(box.from_name, box.email), to,
    subject: subject ? (/^re:/i.test(subject) ? subject : `Re: ${subject}`) : "Re:",
    cc: others(a.cc), bcc: others(a.bcc),
    text: `${replyPlain(a.text)}${sig}`, html: replyHtml(`${a.text}${sig}`, { size: a.size, align: a.align }),
    attachments: a.files.length ? a.files.map((f) => ({ filename: f.name, content: Buffer.from(f.data, "base64"), contentType: f.type })) : undefined,
    headers: inReplyTo ? { "In-Reply-To": inReplyTo, References: inReplyTo } : undefined,
  };
}

// Cc / Bcc on the team's Do-not-contact list (address or company domain): nobody on it is ever emailed. Also used by
// /api/mail/schedule, so a scheduled answer is refused at once (and checked again by the timer before it is sent).
export async function blockedExtras(sb: Awaited<ReturnType<typeof supabaseServer>>, team: string, to: string, a: Answer) {
  const extra = [...a.cc, ...a.bcc].filter((e) => e !== to.toLowerCase());
  if (!extra.length) return null;
  try {
    const dnc = await teamDnc(sb, team, extra.map((e) => ({ email: e })));
    const blocked = extra.filter((e) => dncBlocks({ email: e }, dnc));
    return blocked.length ? { error: `On your Do-not-contact list, so not sent: ${blocked.slice(0, 3).join(", ")}`, status: 400 } : null;
  } catch { return { error: "Could not check your Do-not-contact list just now. Try again in a minute.", status: 503 }; }
}
