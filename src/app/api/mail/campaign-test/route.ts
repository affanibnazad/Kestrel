import { NextResponse } from "next/server";
import { smtpTransport } from "@/lib/mail-connect";
import { currentUser, supabaseServer } from "@/lib/supabase/server";
import { fromHeader, stepsOf, type ReadyLead } from "@/lib/campaign";

// "Send test to me": every step of one lead's emails (first email and follow-ups), through the campaign's first working
// mailbox, to the signed-in person only. Required once before a campaign can start (class rule: test to yourself first).
export const maxDuration = 60;
const plain = (e: unknown) => String((e as { response?: string; message?: string })?.response || (e as Error)?.message || e || "").replace(/\s+/g, " ").slice(0, 300);

type Login = { email: string; from_name: string; smtp_host: string; smtp_port: number; username: string; password: string };

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user?.email) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  const secret = process.env.MAIL_SERVER_SECRET || "";
  if (secret.length < 32) return NextResponse.json({ error: "Mail is not set up on the server yet." }, { status: 503 });
  const body = (await request.json().catch(() => ({}))) as { campaign?: unknown; lead?: unknown };
  const uuid = (v: unknown) => (typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v) ? v : "");
  const campaignId = uuid(body.campaign), leadId = uuid(body.lead);
  if (!campaignId || !leadId) return NextResponse.json({ error: "Choose a campaign and a lead." }, { status: 400 });

  const sb = await supabaseServer();
  const { data: c } = await sb.from("campaigns").select("id,mailbox_ids").eq("id", campaignId).maybeSingle();
  if (!c) return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
  const { data: boxes } = await sb.from("mailboxes").select("id,status,created_at").in("id", (c.mailbox_ids as string[]) ?? []).eq("status", "ok").order("created_at");
  if (!boxes?.length) return NextResponse.json({ error: "Choose a mailbox that passed its test." }, { status: 400 });
  const { data: lead } = await sb.from("leads").select("id,email,data").eq("id", leadId).maybeSingle();
  const steps = stepsOf(((lead?.data ?? {}) as { outreach?: ReadyLead["outreach"] }).outreach);
  if (!steps.length) return NextResponse.json({ error: "That lead has no written email yet (AI → Write emails)." }, { status: 400 });

  const { data: login, error } = await sb.rpc("mailbox_login_for_server", { box_id: boxes[0].id, server_secret: secret });
  if (error || !login) return NextResponse.json({ error: "Only the owner or a manager can send a test." }, { status: 403 });
  const box = login as Login;
  let transport: Awaited<ReturnType<typeof smtpTransport>>;
  try { transport = await smtpTransport(box); } catch (e) { return NextResponse.json({ error: `Sending failed: ${plain(e)}` }, { status: 502 }); }
  try {
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      await transport.sendMail({ from: fromHeader(box.from_name, box.email), to: user.email,
        subject: `[Kestrel test ${i + 1}/${steps.length}${i ? `, day ${s.day}` : ""}] ${s.subject || "(same thread)"}`, text: s.body });
    }
  } catch (e) { transport.close(); return NextResponse.json({ error: `Sending failed: ${plain(e)}` }, { status: 502 }); }
  transport.close();
  // The emails went out; now the campaign must count as tested. Say so if it does not (Batch 001 feedback #3: the test
  // looked sent, but Start still asked for one).
  const { error: rec } = await sb.rpc("campaign_tested", { campaign: campaignId, server_secret: secret });
  if (rec) return NextResponse.json({ sent: steps.length, to: user.email, from: box.email, recorded: false,
    error: `The test emails were sent to ${user.email}, but Kestrel could not mark the campaign as tested (${rec.message}). Try again, or ask the team owner.` }, { status: 409 });
  return NextResponse.json({ sent: steps.length, to: user.email, from: box.email, recorded: true, tested_at: new Date().toISOString() });
}
