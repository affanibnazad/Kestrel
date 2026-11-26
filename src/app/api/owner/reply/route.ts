import { NextResponse } from "next/server";
import { currentUser, supabaseServer } from "@/lib/supabase/server";

const clean = (v: unknown, n: number) => String(v ?? "").replace(/\r/g, "").trim().slice(0, n);

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const sb = await supabaseServer();
  const { data: admin } = await sb.rpc("is_admin");
  if (!admin) return NextResponse.json({ error: "Not allowed." }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const to = clean(body.to, 200).toLowerCase();
  const subject = clean(body.subject, 200) || "Re: your message to Kestrel";
  const text = clean(body.text, 5000);

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to) || text.length < 2) {
    return NextResponse.json({ error: "Provide a valid email and reply message." }, { status: 400 });
  }

  const key = process.env.RESEND_API_KEY;
  if (!key) {
    return NextResponse.json({ error: "RESEND_API_KEY is not configured. Use the mailto link instead." }, { status: 503 });
  }

  const replyTo = process.env.CONTACT_INBOX || "hello@kestrelleads.com";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: "Kestrel Support <hello@kestrelleads.com>",
      to: [to],
      reply_to: replyTo,
      subject,
      text,
    }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);

  if (!res?.ok) {
    return NextResponse.json({ error: "Could not send reply email." }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
