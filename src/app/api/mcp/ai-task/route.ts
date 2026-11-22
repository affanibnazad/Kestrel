import { NextResponse } from "next/server";
import { currentUser, supabaseServer } from "@/lib/supabase/server";
import { teamDnc } from "@/lib/dnc-server";
import { dncBlocks } from "@/lib/dnc";
import { emailPayload, leadPayload, type LeadData } from "@/lib/ai";
import { agentPlan, canWork, mcpGate } from "@/lib/mcp-server";

// Kestrel MCP: the instructions and lead details for scoring or writing, so the person's own Claude Code or Codex plan can do
// the AI work. Only public business details are given (as for the App's AI). Leads without an email or on Do-not-contact are
// left out of writing.
export async function POST(request: Request) {
  if (!(await currentUser())) return NextResponse.json({ error: "Please sign in again (kestrel-mcp login)." }, { status: 401 });
  const sb = await supabaseServer();
  const gate = await mcpGate(sb);
  if (gate instanceof NextResponse) return gate;
  if (!canWork(gate.role)) return NextResponse.json({ error: "Your role can view leads but not run AI. Ask your team owner." }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as { task?: unknown; lead_ids?: unknown; offer_id?: unknown; sequence?: unknown };
  const task = body.task === "emails" ? "emails" : body.task === "score" ? "score" : null;
  const ids = Array.isArray(body.lead_ids) ? body.lead_ids.filter((x): x is string => typeof x === "string" && /^[0-9a-f-]{36}$/i.test(x)).slice(0, 50) : [];
  if (!task || !ids.length || typeof body.offer_id !== "string") return NextResponse.json({ error: "Give task (score or emails), lead_ids (up to 50) and offer_id." }, { status: 400 });
  const plan = await agentPlan(sb, gate.team, task, body.offer_id, typeof body.sequence === "string" ? body.sequence : "default");
  if ("error" in plan) return NextResponse.json({ error: plan.error }, { status: 400 });
  const { data: rows } = await sb.from("leads").select("id,team_id,name,email,data").in("id", ids).eq("team_id", gate.team);   // only the current team
  const leads = (rows ?? []) as { id: string; team_id: string; name: string | null; email: string | null; data: LeadData | null }[];
  let dnc;
  try { dnc = await teamDnc(sb, gate.team, leads.map((l) => ({ email: l.email, emails: (l.data as { emails?: string[] } | null)?.emails, website: (l.data as { website?: string } | null)?.website }))); }
  catch { return NextResponse.json({ error: "Could not check the Do-not-contact list just now. Try again in a minute." }, { status: 503 }); }
  const out = [], skipped: { id: string; why: string }[] = [];
  for (const l of leads) {
    const d = l.data ?? {};
    if (task === "emails" && !l.email) { skipped.push({ id: l.id, why: "no email" }); continue; }
    if (task === "emails" && dncBlocks({ email: l.email, emails: (d as { emails?: string[] }).emails, website: (d as { website?: string }).website }, dnc)) { skipped.push({ id: l.id, why: "do not contact" }); continue; }
    out.push({ lead_id: l.id, name: l.name, details: task === "score" ? leadPayload(d) : emailPayload({ ...d, email: l.email ?? (d as { email?: string }).email }) });
  }
  return NextResponse.json({
    how: `For each lead, follow the instructions with that lead's details and produce one JSON answer that matches answer_schema exactly. Then call save_ai_results with task "${task}", the same offer_id${task === "emails" ? " and sequence" : ""}, and results: [{ lead_id, answer }].`,
    instructions: plan.system, answer_schema: plan.schema, leads: out, skipped,
  });
}
