import { NextResponse } from "next/server";
import { currentUser, supabaseServer } from "@/lib/supabase/server";
import { blockedExtras, readAnswer } from "@/lib/answer-mail";

// "Send later" from the Replies answer box (database 055): checks the answer like "Send" does, refuses Cc / Bcc on
// Do-not-contact at once, then stores it with the chosen time. The mail timer sends it then, after checking every gate
// again (role, plan, mailbox, daily limit, Do-not-contact). { cancel: id } cancels one that is still waiting.
export async function POST(request: Request) {
  if (!(await currentUser())) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const uuid = (v: unknown) => (typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v) ? v : "");
  const sb = await supabaseServer();
  const missing = (m: string) => /schedule_answer|cancel_scheduled_answer|scheduled_answers|schema cache/i.test(m);

  if (uuid(body.cancel)) {
    const { error } = await sb.rpc("cancel_scheduled_answer", { answer: uuid(body.cancel) });
    if (error) return NextResponse.json({ error: missing(error.message) ? "Send later needs the newest database update (055)." : error.message.replace(/^.*?: /, "") }, { status: 400 });
    return NextResponse.json({ cancelled: true });
  }

  const id = uuid(body.reply);
  const at = typeof body.sendAt === "string" ? new Date(body.sendAt) : null;
  if (!id) return NextResponse.json({ error: "Choose a reply to answer." }, { status: 400 });
  if (!at || Number.isNaN(at.getTime())) return NextResponse.json({ error: "Pick a day and time." }, { status: 400 });
  if (at.getTime() < Date.now() + 60_000 || at.getTime() > Date.now() + 30 * 864e5) return NextResponse.json({ error: "Pick a time between a minute and 30 days from now." }, { status: 400 });
  const ans = readAnswer(body);
  if ("error" in ans) return NextResponse.json({ error: ans.error }, { status: 400 });

  const { data: r } = await sb.from("mail_replies").select("id,team_id,from_email,lead_email").eq("id", id).maybeSingle();
  if (!r) return NextResponse.json({ error: "Reply not found." }, { status: 404 });
  const blocked = await blockedExtras(sb, r.team_id as string, String(r.lead_email || r.from_email || "").toLowerCase(), ans);
  if (blocked) return NextResponse.json({ error: blocked.error }, { status: blocked.status });

  const { data, error } = await sb.rpc("schedule_answer", { reply: id, send_at: at.toISOString(), payload: ans });
  if (error) return NextResponse.json({ error: missing(error.message) ? "Send later needs the newest database update (055)." : error.message.replace(/^.*?: /, "") }, { status: 400 });
  return NextResponse.json({ scheduled: data, sendAt: at.toISOString() });
}
