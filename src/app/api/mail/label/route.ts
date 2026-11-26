import { NextResponse } from "next/server";
import { currentUser, supabaseServer } from "@/lib/supabase/server";
import { serverSecret } from "@/lib/assistant-server";
import { kestrelAi, kestrelJson, modelTag } from "@/lib/kestrel-ai";
import { LABEL_SCHEMA, LABEL_SYSTEM, isLabel, ruleLabel, type Label } from "@/lib/inbox";

// Replies → AI reply labels. Labels the team's newest unlabelled replies, a few per call (Replies calls this
// when it loads and after each refresh). Uses Kestrel's own AI (lib/kestrel-ai.ts: the Owner's choice, e.g. NVIDIA, else
// Claude Haiku 5.5 at about $0.0002 a reply, paid by Kestrel); word rules when no key is set up. Runs as the signed-in person:
// row-level security decides which replies they can see; the label is saved with the server secret.
export const maxDuration = 60;
const PER_CALL = 10, AT_ONCE = 5;

type Row = { id: string; subject: string | null; snippet: string | null; body: string | null };

export async function POST() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  const secret = serverSecret();
  if (secret.length < 32) return NextResponse.json({ error: "Mail is not set up on the server yet." }, { status: 503 });
  const sb = await supabaseServer();

  const { data: member } = await sb.from("members").select("team_id").eq("user_id", user.id).maybeSingle();
  const teamId = (member as { team_id?: string } | null)?.team_id || "";
  if (!teamId) return NextResponse.json({ error: "Team not found." }, { status: 403 });

  const { data, error } = await sb.from("mail_replies").select("id,subject,snippet,body").eq("kind", "reply").is("ai_label", null)
    .order("received_at", { ascending: false }).limit(PER_CALL);
  if (error) return NextResponse.json({ error: /ai_label|schema cache/i.test(error.message) ? "Reply labels are coming soon to your workspace." : "Could not read replies." }, { status: 400 });
  const rows = (data ?? []) as Row[];
  if (!rows.length) return NextResponse.json({ labelled: [], more: false });

  const found = await kestrelAi(sb);
  const ai = "error" in found ? null : found;
  const labelled: { id: string; label: Label; reason: string; by: string }[] = [];

  const one = async (r: Row) => {
    const text = `${r.subject ?? ""}\n\n${(r.body || r.snippet || "").slice(0, 4000)}`.trim();
    let out: { label: Label; reason: string; by: string } | null = { ...ruleLabel(text), by: "rules" };
    if (ai) {
      try {
        const json = await kestrelJson<{ label?: unknown; reason?: unknown }>(
          ai,
          LABEL_SYSTEM,
          `<reply>${text}</reply>`,
          LABEL_SCHEMA,
          300,
          20_000,
          // Automatic (runs when Replies loads), so it does not use the team's monthly Kestrel AI allowance.
          // To make it count again, remove `uncounted`.
          { sb, teamId, userId: user.id, task: "reply_label", uncounted: "reply_label_auto" }
        );
        if (json && isLabel(json.label)) out = { label: json.label, reason: String(json.reason ?? "").slice(0, 200), by: modelTag(ai) };
      } catch {
        out = null;   // the AI did not answer: save nothing, so the next visit to Replies tries the AI again
      }
    }
    if (!out) return;
    const { error: saveError } = await sb.rpc("set_reply_label", { server_secret: secret, reply_id: r.id, label: out.label, reason: out.reason, by_model: out.by });
    if (!saveError) labelled.push({ id: r.id, ...out });
  };
  for (let i = 0; i < rows.length; i += AT_ONCE) await Promise.all(rows.slice(i, i + AT_ONCE).map(one));
  return NextResponse.json({ labelled, more: rows.length === PER_CALL, ai: Boolean(ai) });
}
