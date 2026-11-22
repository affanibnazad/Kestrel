import { timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_KEY, SUPABASE_URL } from "@/lib/supabase/config";
import { fromHeader } from "@/lib/campaign";
import { smtpTransport } from "@/lib/mail-connect";
import { locate, type SeedItem, type SeedLogin } from "@/lib/placement-server";

// The placement timer (Spam Guard C): the database calls this every minute while a placement test runs (pg_cron, 032), with the
// mail server secret. It starts weekly tests that are due, sends the test emails (one per email account × test inbox), then reads
// the test inboxes to see where each email landed and reports back. Every database function it uses checks the secret itself.
export const maxDuration = 60;

const same = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
const plain = (e: unknown) => String((e as { response?: string; message?: string })?.response || (e as Error)?.message || e || "").replace(/\s+/g, " ").slice(0, 250);

type Box = { email: string; from_name: string; smtp_host: string; smtp_port: number; username: string; password: string };
type Due = { id: string; token: string; to: string; subject: string; body: string; box: Box };

export async function POST(request: Request) {
  const secret = process.env.MAIL_SERVER_SECRET || "";
  const given = request.headers.get("x-kestrel-secret") || "";
  if (secret.length < 32 || !same(given, secret)) return new Response("not allowed", { status: 401 });
  const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: scheduled } = await sb.rpc("placement_schedule", { server_secret: secret });

  // 1. Send. One connection per email account; its emails go one after another, a few seconds apart.
  const { data: dueData } = await sb.rpc("placement_send_due", { server_secret: secret, max_n: 12 });
  const due = (dueData ?? []) as Due[];
  const byBox = new Map<string, Due[]>();
  for (const d of due) byBox.set(d.box.email, [...(byBox.get(d.box.email) ?? []), d]);
  let sent = 0;
  await Promise.all([...byBox.values()].map(async (list) => {
    const box = list[0].box;
    const fail = async (err: string) => { for (const d of list) await sb.rpc("placement_sent", { server_secret: secret, result_id: d.id, ok: false, err }); };
    let transport: Awaited<ReturnType<typeof smtpTransport>>;
    try { transport = await smtpTransport(box); } catch (e) { await fail(plain(e)); return; }
    try {
      for (const [i, d] of list.entries()) {
        if (i) await new Promise((r) => setTimeout(r, 1500 + Math.random() * 2000));
        try {
          // The token is the email's Message-ID, so the test inbox can find exactly this email; nothing else is added.
          await transport.sendMail({ from: fromHeader(box.from_name, box.email), to: d.to, subject: d.subject, text: d.body, messageId: `<${d.token}@${box.email.split("@")[1]}>` });
          await sb.rpc("placement_sent", { server_secret: secret, result_id: d.id, ok: true, err: null });
          sent++;
        } catch (e) { await sb.rpc("placement_sent", { server_secret: secret, result_id: d.id, ok: false, err: plain(e) }); }
      }
    } finally { transport.close(); }
  }));

  // 2. Read the test inboxes for emails sent at least 90 seconds ago.
  const { data: seedData } = await sb.rpc("placement_check_due", { server_secret: secret, max_n: 4 });
  let checked = 0;
  await Promise.all(((seedData ?? []) as (SeedLogin & { id: string; items: SeedItem[] })[]).map(async (seed) => {
    const found = await locate(seed, seed.items);
    await sb.rpc("placement_report", { server_secret: secret, items: found });
    checked += found.length;
  }));

  return Response.json({ scheduled: scheduled ?? 0, sent, checked });
}
