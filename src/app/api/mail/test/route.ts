import { NextResponse } from "next/server";
import type { ImapFlow } from "imapflow";
import { imapClient, smtpTransport } from "@/lib/mail-connect";
import { currentUser, supabaseServer } from "@/lib/supabase/server";

// Tests a team mailbox: signs in to SMTP (sending) and IMAP (reading replies), and can send one test email to you.
// Runs as the signed-in person; the database gives the password only to this server (server secret) and only for a manager of the team.
export const maxDuration = 60;

type Login = { email: string; from_name: string; smtp_host: string; smtp_port: number; imap_host: string | null; imap_port: number | null; username: string; password: string; signature: string };

const plain = (e: unknown) => {
  const m = String((e as { response?: string; message?: string })?.response || (e as Error)?.message || e || "").replace(/\s+/g, " ").slice(0, 300);
  if (/auth|535|534|credentials|invalid login|username and password/i.test(m)) return `Sign-in refused: check the username and app password. (${m})`;
  if (/ENOTFOUND|EAI_AGAIN/i.test(m)) return `Server name not found: check the host. (${m})`;
  if (/ETIMEDOUT|timeout|ECONNREFUSED/i.test(m)) return `No answer from the server: check the host and port. (${m})`;
  return m;
};

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  const secret = process.env.MAIL_SERVER_SECRET || "";
  if (secret.length < 32) return NextResponse.json({ error: "Mail is not set up on the server yet (run scripts/setup-mail.mjs, then publish)." }, { status: 503 });
  const body = (await request.json().catch(() => ({}))) as { id?: unknown; send?: unknown };
  const id = typeof body.id === "string" && /^[0-9a-f-]{36}$/i.test(body.id) ? body.id : "";
  if (!id) return NextResponse.json({ error: "Which mailbox?" }, { status: 400 });

  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("mailbox_login_for_server", { box_id: id, server_secret: secret });
  if (error || !data) return NextResponse.json({ error: /owner or a manager/.test(error?.message ?? "") ? "Only the owner or a manager can test mailboxes." : "Mailbox not found." }, { status: 403 });
  const box = data as Login;

  let smtp = false, imap: boolean | null = null, sent = false;
  const problems: string[] = [];
  let transport: Awaited<ReturnType<typeof smtpTransport>> | null = null;
  try { transport = await smtpTransport(box); await transport.verify(); smtp = true; } catch (e) { problems.push(`Sending (SMTP): ${plain(e)}`); }

  if (box.imap_host) {
    let client: ImapFlow | null = null;
    try { client = await imapClient(box); await client.connect(); await client.mailboxOpen("INBOX", { readOnly: true }); imap = true; } catch (e) { imap = false; problems.push(`Reading replies (IMAP): ${plain(e)}`); }
    finally { if (client) { try { await client.logout(); } catch { /* already closed */ } } }
  }

  if (smtp && transport && body.send === true && user.email) {
    try {
      const name = box.from_name ? `"${box.from_name.replace(/"/g, "")}" <${box.email}>` : box.email;
      await transport.sendMail({
        from: name, to: user.email, subject: `Kestrel test from ${box.email}`,
        text: `This is a test email from Kestrel, sent through ${box.email}.\n\nIf it is in your inbox, this mailbox is ready. If it is in spam, send fewer emails a day from it for a while and check Domain health before sending campaigns.${box.signature ? `\n\n${box.signature}` : ""}`,
      });
      sent = true;
    } catch (e) { problems.push(`Test email: ${plain(e)}`); }
  }
  transport?.close();
  await sb.rpc("mailbox_tested", { box_id: id, server_secret: secret, smtp, imap, err: problems.join(" · ") });
  return NextResponse.json({ smtp, imap, sent, to: sent ? user.email : undefined, problems });
}
