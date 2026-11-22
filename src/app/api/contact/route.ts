import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_KEY, SUPABASE_URL } from "@/lib/supabase/config";

// The contact form. Every message is saved in Supabase (contact_messages) and, when the email settings are set
// online, also emailed to the team inbox with Reply-To set to the sender, so a reply goes straight back to them.
const TOPICS = ["question", "sales", "billing", "privacy", "security", "other"];
const clean = (v: unknown, n: number) => String(v ?? "").replace(/\r/g, "").trim().slice(0, n);

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (clean(body.website, 200)) return NextResponse.json({ ok: true }); // the hidden field only robots fill in
  const name = clean(body.name, 120), email = clean(body.email, 200).toLowerCase(), message = clean(body.message, 5000), company = clean(body.company, 120);
  const topic = TOPICS.includes(String(body.topic)) ? String(body.topic) : "question";
  if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || message.length < 5) return NextResponse.json({ error: "Add your name, a valid email and a message." }, { status: 400 });

  const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await sb.rpc("send_contact", { name, email, topic, message, company });
  if (error) return NextResponse.json({ error: /TOO_MANY/.test(error.message) ? "Too many messages just now. Please try again in an hour." : "Your message could not be sent. Please try again." }, { status: /TOO_MANY/.test(error.message) ? 429 : 500 });

  const key = process.env.RESEND_API_KEY, inbox = process.env.CONTACT_INBOX;
  if (key && inbox) {
    const text = `${message}\n\n— ${name}${company ? `, ${company}` : ""}\n${email}\nTopic: ${topic}`;
    await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ from: "Kestrel contact form <hello@kestrelleads.com>", to: [inbox], reply_to: email, subject: `Kestrel contact: ${topic} from ${name}`, text }),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null); // the message is already saved, so a mail hiccup loses nothing
  }
  return NextResponse.json({ ok: true });
}
