import { createHmac } from "node:crypto";
import { NextResponse } from "next/server";
import type { ImapFlow } from "imapflow";
import { currentUser, supabaseServer } from "@/lib/supabase/server";
import { fromHeader } from "@/lib/campaign";
import { smtpTransport } from "@/lib/mail-connect";
import { inboxBelongs, junkFolder, openSeed, plainError, type SeedLogin } from "@/lib/placement-server";

// Inbox placement → Test inboxes → Test connection. Two checks before a test inbox is "Connected":
// 1. Kestrel can sign in to it by IMAP (read-only) and find its Spam folder.
// 2. It really is that address's inbox: Kestrel sends one short check email from one of the team's ready email accounts and must
//    find it there. Without this, any stranger's address could be entered as a "test inbox" and receive emails.
// The database gives passwords only to this server (server secret) and only for an owner or manager of the team.
export const maxDuration = 60;
const SUBJECT = "Kestrel test inbox check";

// The check email's Message-ID: tied to this inbox's settings, so it can be recognised without storing anything.
const tokenFor = (secret: string, id: string, s: SeedLogin) => createHmac("sha256", secret).update(`${id}|${s.email}|${s.imap_host}|${s.imap_port}|${s.username}`).digest("hex").slice(0, 32);

async function hasCheck(client: ImapFlow, folders: (string | null)[], token: string) {
  for (const f of folders) {
    if (!f) continue;
    const lock = await client.getMailboxLock(f, { readOnly: true });
    try {
      const uids = await client.search({ subject: SUBJECT, since: new Date(Date.now() - 2 * 86400000) }, { uid: true });
      if (!Array.isArray(uids) || !uids.length) continue;
      const msgs = await client.fetchAll(uids.slice(-20).join(","), { uid: true, envelope: true }, { uid: true });
      if (msgs.some((m) => String(m.envelope?.messageId || "").includes(token))) return true;
    } finally { lock.release(); }
  }
  return false;
}

export async function POST(request: Request) {
  if (!(await currentUser())) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  const secret = process.env.MAIL_SERVER_SECRET || "";
  if (secret.length < 32) return NextResponse.json({ error: "Mail is not set up on the server yet." }, { status: 503 });
  const body = (await request.json().catch(() => ({}))) as { id?: unknown };
  const id = typeof body.id === "string" && /^[0-9a-f-]{36}$/i.test(body.id) ? body.id : "";
  if (!id) return NextResponse.json({ error: "Which test inbox?" }, { status: 400 });

  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("seed_login_for_server", { seed_id: id, server_secret: secret });
  if (error || !data) {
    const m = error?.message ?? "";
    return NextResponse.json({ error: /seed_login_for_server|schema cache/i.test(m) ? "Placement tests are coming soon to your workspace." : /owner or a manager/.test(m) ? "Only the owner or a manager can test inboxes." : "Test inbox not found." }, { status: 403 });
  }
  const seed = data as SeedLogin;
  const token = tokenFor(secret, id, seed);
  const report = async (ok: boolean, problem: string) => {
    await sb.rpc("seed_tested", { seed_id: id, server_secret: secret, ok, err: problem });
    return NextResponse.json({ ok, problem });
  };

  const notTheirs = await inboxBelongs(seed);
  if (notTheirs) return await report(false, notTheirs);

  let client: ImapFlow | null = null;
  try {
    client = await openSeed(seed);
    const junk = await junkFolder(client);
    if (await hasCheck(client, ["INBOX", junk], token)) return await report(true, junk ? "" : "Connected, but no Spam folder was found. Spam results may be missing for this inbox.");

    // Not confirmed yet: send the check email from the team's first ready email account.
    const { data: boxes } = await sb.from("mailboxes").select("id,email").eq("status", "ok").order("created_at").limit(1);
    const box = (boxes ?? [])[0] as { id: string; email: string } | undefined;
    if (!box) return await report(false, "Signed in. To confirm you own this inbox, Kestrel sends it one check email from a ready email account: add or test an email account first, then test again.");
    const { data: login, error: le } = await sb.rpc("mailbox_login_for_server", { box_id: box.id, server_secret: secret });
    if (le || !login) return await report(false, "Signed in, but the check email could not be sent (email account not available).");
    const l = login as { email: string; from_name: string; smtp_host: string; smtp_port: number; username: string; password: string };
    const transport = await smtpTransport(l);
    try {
      await transport.sendMail({ from: fromHeader(l.from_name, l.email), to: seed.email, subject: SUBJECT, messageId: `<${token}@${l.email.split("@")[1]}>`,
        text: "This email confirms that this inbox belongs to your Kestrel team and can be used for inbox placement tests. You can delete it." });
    } finally { transport.close(); }
    // Wait up to about 25 seconds for it to arrive.
    for (let i = 0; i < 5; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      if (await hasCheck(client, ["INBOX", junk], token)) return await report(true, junk ? "" : "Connected, but no Spam folder was found. Spam results may be missing for this inbox.");
    }
    return await report(false, `Signed in and sent a check email from ${l.email}. It has not arrived yet: click Test connection again in a minute.`);
  } catch (e) {
    return await report(false, plainError(e));
  } finally { if (client) { try { await client.logout(); } catch { /* already closed */ } } }
}
