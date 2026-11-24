import { timingSafeEqual } from "node:crypto";
import { checkDomain } from "@/lib/blacklist";
import { deliver, type OutboxItem } from "@/lib/integrations";
import type { ImapFlow } from "imapflow";
import { imapClient, smtpTransport } from "@/lib/mail-connect";
import { createClient } from "@supabase/supabase-js";
import { answerMessage, readAnswer, type Answer } from "@/lib/answer-mail";
import { SUPABASE_KEY, SUPABASE_URL } from "@/lib/supabase/config";
import { campaignHeaders, classifyMessage, fromHeader, isLoginError, readableText, trackedHtml, verdictOf, type DueEmail, type InboxItem } from "@/lib/campaign";

// The sending timer: the database calls this every minute (pg_cron, 016) with the mail server secret.
// It asks the database for the emails that are due (each mailbox at most one, inside its campaign's hours and daily limit),
// checks for a reply before every follow-up, sends through the mailbox's own SMTP and reports back.
// Phase 4: then it reads up to five campaign mailboxes (each about every minute) for replies, "remove me" answers and bounces.
// Nobody signed in calls this: every database function it uses checks the server secret itself.
export const maxDuration = 60;
const PER_CALL = 10;

const same = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

function withTimeout<T>(promise: Promise<T>, ms: number, msg: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(msg)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Reporting back must not be lost after a real send: try three times.
type Rpc = { rpc: (fn: "mail_result", args: Record<string, unknown>) => PromiseLike<{ error: unknown }> };
async function report(sb: Rpc, args: Record<string, unknown>) {
  for (let i = 0; i < 3; i++) {
    const { error } = await sb.rpc("mail_result", args);
    if (!error) return true;
    await new Promise((r) => setTimeout(r, 500 * (i + 1)));
  }
  console.error("mail_result failed for", args.cl_id, "(the claim stays for 6 hours, so it is not sent again soon)");
  return false;
}
const plain = (e: unknown) => String((e as { response?: string; message?: string })?.response || (e as Error)?.message || e || "").replace(/\s+/g, " ").slice(0, 300);

type ScheduledAnswer = { id: string; reply_id: string; to: string; subject: string | null; message_id: string | null; payload: Answer;
  box: { email: string; from_name: string; smtp_host: string; smtp_port: number; username: string; password: string; signature: string } };
type Login = { email: string; imap_host: string | null; imap_port: number | null; username: string; password: string };
const imapFor = (b: Login) => imapClient(b);

// Reads the given messages and decides what each one is (reply, remove me, bounce, out of office).
async function readMessages(client: ImapFlow, uids: number[], mailbox: string): Promise<InboxItem[]> {
  if (!uids.length) return [];
  const out: InboxItem[] = [];
  const list = await client.fetchAll(uids.join(","), { uid: true, envelope: true, headers: true, source: { maxLength: 20000 } }, { uid: true });
  for (const m of list) {
    const from = String(m.envelope?.from?.[0]?.address || "").toLowerCase(), subject = String(m.envelope?.subject || "");
    const raw = m.source ? m.source.toString("utf8") : "", text = readableText(raw);
    const c = classifyMessage({ from, subject, headers: m.headers ? m.headers.toString("utf8") : "", text, raw, mailbox });
    if (c) out.push({ uid: m.uid, from, subject: subject.slice(0, 300), snippet: text.slice(0, 600), body: text.slice(0, 20000), message_id: String(m.envelope?.messageId || "").slice(0, 300),
      date: m.envelope?.date ? new Date(m.envelope.date).toISOString() : null, ...c });
  }
  return out;
}

// Has this person written back since the first email? Out-of-office answers do not count. (Follow-ups stop on a reply.)
// If the inbox cannot be checked, this throws: the follow-up waits and is tried again, it is never sent blind.
async function replied(e: DueEmail) {
  if (!e.box.imap_host) throw new Error("This mailbox has no IMAP (reading) settings, so replies cannot be checked. Add them in Mailboxes.");
  if (!e.first_sent_at) return false;
  const sentAt = e.first_sent_at;
  return await withTimeout((async () => {
    const client = await imapFor(e.box);
    try {
      await client.connect();
      await client.mailboxOpen("INBOX", { readOnly: true });
      const found = await client.search({ from: e.to, since: new Date(sentAt) }, { uid: true });
      if (!Array.isArray(found) || !found.length) return false;
      const items = await readMessages(client, found.slice(-10), e.box.email);
      return items.some((i) => i.kind !== "auto");
    } finally { try { await client.logout(); } catch { /* already closed */ } }
  })(), 10_000, "IMAP check timed out (10s)");
}

// Phase 4: read new messages in one mailbox since the last read (or since its first campaign email) and report them.
type ScanBox = Login & { id: string; scan_uid: number | null; scan_validity: string | null; since: string | null };
async function scanBox(b: ScanBox) {
  return await withTimeout((async () => {
    const client = await imapFor(b);
    try {
      await client.connect();
      const box = await client.mailboxOpen("INBOX", { readOnly: true });
      const validity = String(box.uidValidity ?? "");
      const fresh = !b.scan_uid || b.scan_validity !== validity;
      const found = fresh
        ? await client.search({ since: new Date(b.since || Date.now() - 86400000) }, { uid: true })
        : await client.search({ uid: `${Number(b.scan_uid) + 1}:*` }, { uid: true });
      const uids = (Array.isArray(found) ? found : []).filter((u) => fresh || u > Number(b.scan_uid)).sort((x, y) => x - y).slice(-100);
      const items = await readMessages(client, uids, b.email);
      const last = uids.length ? uids[uids.length - 1] : Math.max(Number(b.scan_uid || 0), Number(box.uidNext || 1) - 1);
      return { validity, last, items };
    } finally { try { await client.logout(); } catch { /* already closed */ } }
  })(), 15_000, "IMAP scan timed out (15s)");
}

async function sendOne(e: DueEmail, origin: string) {
  const transport = await smtpTransport(e.box);
  try {
    // With open tracking (team's own checked domain only) the email also gets an HTML copy with a 1×1 image.
    const html = e.track ? trackedHtml(e.body, `https://${e.track.domain}/api/mail/o?t=${encodeURIComponent(e.track.token)}&s=${e.step}`) : undefined;
    const info = await transport.sendMail({ from: fromHeader(e.box.from_name, e.box.email), to: e.to, subject: e.subject, text: e.body, html, headers: campaignHeaders(e, origin) });
    return String(info.messageId || "");
  } finally { transport.close(); }
}

export async function POST(request: Request) {
  const secret = process.env.MAIL_SERVER_SECRET || "";
  const given = request.headers.get("x-kestrel-secret") || "";
  if (secret.length < 32 || !same(given, secret)) return new Response("not allowed", { status: 401 });

  const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  // Time budget: Vercel stops the function at 60 s. Sending always finishes (each send is reported), the later phases
  // run only while there is time left, so a slow mail server never cuts a report in half.
  const started = Date.now(), left = () => 55_000 - (Date.now() - started);
  // Manual task steps (database 038): due LinkedIn / call / other task steps become tasks first; they are never sent.
  const { data: tasks } = await sb.rpc("mail_task_steps", { server_secret: secret, max_n: 100 });
  const { data, error } = await sb.rpc("mail_due", { server_secret: secret, max_n: PER_CALL });
  if (error) return Response.json({ error: "Could not read the queue." }, { status: 500 });
  const due = (data ?? []) as DueEmail[];
  const origin = new URL(request.url).origin;

  const results: string[] = [];
  for (const e of due) {
    if (left() < 20_000) break;
    try {
      if (e.step > 0 && (await replied(e))) {
        await report(sb, { server_secret: secret, cl_id: e.id, kind: "replied", message_id: null, err: null, box_error: false });
        results.push("replied");
        continue;
      }
      // M1: verify the address before the first email when the campaign asks for it (Hunter, team key).
      if (e.step === 0 && e.verify_key) {
        const v = await fetch(`https://api.hunter.io/v2/email-verifier?${new URLSearchParams({ email: e.to, api_key: e.verify_key })}`, { signal: AbortSignal.timeout(10000) })
          .then((r) => (r.ok ? r.json() : null)).catch(() => null);
        if (v && verdictOf(v) === "invalid") {
          await report(sb, { server_secret: secret, cl_id: e.id, kind: "invalid", message_id: null, err: `Hunter: ${String(v?.data?.status)}`, box_error: false });
          results.push("invalid");
          continue;
        }
      }
      if (left() < 20_000) break;
      const id = await sendOne(e, origin);
      await report(sb, { server_secret: secret, cl_id: e.id, kind: "sent", message_id: id, err: null, box_error: false });
      results.push("sent");
    } catch (err) {
      const msg = plain(err);
      await report(sb, { server_secret: secret, cl_id: e.id, kind: "failed", message_id: null, err: msg, box_error: isLoginError(msg) });
      results.push("failed");
    }
  }

  // Scheduled answers (database 055): the database checked every gate again just now and hands over what to send.
  // Missing function (055 not run yet) = nothing to do. A failed send is retried by the database (3 tries).
  let answered = 0;
  const { data: answers } = left() > 30_000 ? await sb.rpc("scheduled_answers_due", { server_secret: secret, max_n: 5 }) : { data: [] };
  await Promise.all(((answers ?? []) as ScheduledAnswer[]).map(async (a) => {
    let transport: Awaited<ReturnType<typeof smtpTransport>> | null = null;
    try {
      // Check the stored answer again with the App's own rules (a direct database call could have skipped the App).
      const checked = readAnswer(a.payload as unknown as Record<string, unknown>);
      if ("error" in checked) throw new Error(`Not sent: ${checked.error}`);
      transport = await smtpTransport(a.box);
      const info = await transport.sendMail(answerMessage(a.box, a.to, a.subject, a.message_id, checked));
      await sb.rpc("scheduled_answer_done", { server_secret: secret, answer: a.id, ok: true, message_id: String(info.messageId || ""), err: null });
      answered++;
    } catch (err) {
      await sb.rpc("scheduled_answer_done", { server_secret: secret, answer: a.id, ok: false, message_id: null, err: plain(err) });
    } finally { transport?.close(); }
  }));

  // Phase 4: read up to five mailboxes for replies, remove-me answers and bounces (each mailbox about every minute).
  let scanned = 0;
  const { data: boxes } = left() > 25_000 ? await sb.rpc("mail_scan_due", { server_secret: secret, max_n: 5 }) : { data: [] };
  await Promise.all(((boxes ?? []) as ScanBox[]).map(async (b) => {
    const domain = b.email.split("@")[1] || "unknown";
    try {
      const r = await scanBox(b);
      await sb.rpc("mail_inbox_report", { server_secret: secret, box_id: b.id, validity: r.validity, last_uid: r.last, items: r.items });
      scanned++;
    } catch (err) {
      const msg = plain(err);
      console.error(`inbox read failed for mailbox ${b.id} (${domain}):`, msg);
      try {
        await sb.rpc("mail_scan_failure", { server_secret: secret, box_id: b.id, err: msg });
      } catch (e) {
        console.error("mail_scan_failure rpc error:", plain(e));
      }
    }
  }));
  // Spam Guard B: check one sending domain against public blacklists when its last check is a day old.
  let monitored = 0;
  const { data: doms } = left() > 15_000 ? await sb.rpc("domain_monitor_due", { server_secret: secret, max_n: 1 }) : { data: [] };
  for (const d of (doms ?? []) as { team_id: string; domain: string; smtp_host: string | null }[]) {
    try {
      const r = await checkDomain(d.domain, d.smtp_host);
      await sb.rpc("domain_monitor_report", { server_secret: secret, team: d.team_id, dom: d.domain, is_listed: r.listed, res: r });
      monitored++;
    } catch (err) { console.error("domain monitor failed:", plain(err)); }
  }
  // Integrations (database 037): webhooks and HubSpot / Pipedrive sync, up to 5 a minute, retried by the database.
  let delivered = 0;
  const wait = Math.min(25_000, left() - 4_000);
  const { data: outbox } = wait > 5_000 ? await sb.rpc("integration_due", { server_secret: secret, max_n: 5 }) : { data: [] };
  await Promise.all(((outbox ?? []) as OutboxItem[]).map(async (item) => {
    // At most 25 seconds each (less when the timer is short of time); an unfinished one is tried again later.
    const r = await Promise.race([deliver(item), new Promise<{ ok: false; status: 0; error: string }>((ok) => setTimeout(() => ok({ ok: false, status: 0, error: `No answer in ${Math.round(wait / 1000)} seconds` }), wait))]);
    await sb.rpc("integration_report", { server_secret: secret, item: item.id, success: r.ok, http_status: r.status, err: r.error || null });
    if (r.ok) delivered++;
  }));
  return Response.json({ tasks: tasks ?? 0, delivered, answered, due: due.length, sent: results.filter((r) => r === "sent").length, replied: results.filter((r) => r === "replied").length,
    failed: results.filter((r) => r === "failed").length, scanned, monitored });
}
