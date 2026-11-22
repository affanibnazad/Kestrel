import { NextResponse } from "next/server";
import { smtpTransport } from "@/lib/mail-connect";
import { currentUser, supabaseServer } from "@/lib/supabase/server";
import { replyPlain } from "@/lib/reply-format";
import { answerMessage, blockedExtras, readAnswer } from "@/lib/answer-mail";

// Answer a lead's reply from Kestrel's Inbox: sent through the same mailbox, in the same email thread, to the person who
// wrote. Owners and managers only (they are the ones who may use the mailbox login). Counted in the mailbox's daily limit.
// The answer box (lib/reply-format.ts) may add: simple formatting (sent as HTML + plain text), Cc / Bcc (each checked
// against the team's Do-not-contact list; nobody on it is ever emailed) and up to 3 small attachments.
export const maxDuration = 60;
const plain = (e: unknown) => String((e as { response?: string; message?: string })?.response || (e as Error)?.message || e || "").replace(/\s+/g, " ").slice(0, 300);
type Login = { email: string; from_name: string; smtp_host: string; smtp_port: number; username: string; password: string; signature: string };

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  const secret = process.env.MAIL_SERVER_SECRET || "";
  if (secret.length < 32) return NextResponse.json({ error: "Mail is not set up on the server yet." }, { status: 503 });
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const id = typeof body.reply === "string" && /^[0-9a-f-]{36}$/i.test(body.reply) ? body.reply : "";
  if (!id) return NextResponse.json({ error: "Write your answer first." }, { status: 400 });
  const ans = readAnswer(body);
  if ("error" in ans) return NextResponse.json({ error: ans.error }, { status: 400 });

  const sb = await supabaseServer();
  const { data: r } = await sb.from("mail_replies").select("id,team_id,mailbox_id,from_email,lead_email,subject,message_id,kind").eq("id", id).maybeSingle();
  if (!r || !r.mailbox_id) return NextResponse.json({ error: "Reply not found." }, { status: 404 });
  // Same gates as campaign sending, checked in the database: role, active plan, mailbox ready and under its limit, Do-not-contact.
  const { data: checked, error: gate } = await sb.rpc("mail_answer_check", { server_secret: secret, reply_id: id });
  if (gate || typeof checked !== "string") return NextResponse.json({ error: gate?.message?.replace(/^.*?: /, "") || "This answer cannot be sent." }, { status: 400 });
  const to = checked;
  // Cc / Bcc: the same Do-not-contact rule as campaigns (address or its company domain). If the check fails, nothing is sent.
  const blocked = await blockedExtras(sb, r.team_id as string, to, ans);
  if (blocked) return NextResponse.json({ error: blocked.error }, { status: blocked.status });

  const { data: login, error } = await sb.rpc("mailbox_login_for_server", { box_id: r.mailbox_id, server_secret: secret });
  if (error || !login) return NextResponse.json({ error: "Only the owner or a manager can answer from the team mailbox." }, { status: 403 });
  const box = login as Login;
  let transport: Awaited<ReturnType<typeof smtpTransport>>;
  try { transport = await smtpTransport(box); } catch (e) { return NextResponse.json({ error: `Sending failed: ${plain(e)}` }, { status: 502 }); }
  let messageId = "";
  try {
    const info = await transport.sendMail(answerMessage(box, to, r.subject, r.message_id, ans));
    messageId = String(info.messageId || "");
  } catch (e) { transport.close(); return NextResponse.json({ error: `Sending failed: ${plain(e)}` }, { status: 502 }); }
  transport.close();
  await sb.rpc("mail_answered", { server_secret: secret, reply_id: id, message_id: messageId, body: replyPlain(ans.text) });
  return NextResponse.json({ sent: true, to });
}

