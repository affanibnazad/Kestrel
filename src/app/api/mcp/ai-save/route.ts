import { NextResponse } from "next/server";
import { currentUser, supabaseServer } from "@/lib/supabase/server";
import { teamDnc } from "@/lib/dnc-server";
import { dncBlocks } from "@/lib/dnc";
import type { LeadData } from "@/lib/ai";
import { aiAnswer } from "@/lib/lead-steps";
import { agentPlan, canWork, mcpGate } from "@/lib/mcp-server";

// Kestrel MCP: saves the answers the person's Claude Code or Codex plan produced for get_ai_task, with every check of the
// App's own AI (lib/lead-steps aiAnswer): a valid fit, full emails, no [FIELD] left, no price or payment words, and never
// anyone on Do-not-contact (checked again here, fail closed). Saved as the person (row-level security).
export async function POST(request: Request) {
  if (!(await currentUser())) return NextResponse.json({ error: "Please sign in again (kestrel-mcp login)." }, { status: 401 });
  const sb = await supabaseServer();
  const gate = await mcpGate(sb);
  if (gate instanceof NextResponse) return gate;
  if (!canWork(gate.role)) return NextResponse.json({ error: "Your role can view leads but not run AI. Ask your team owner." }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as { task?: unknown; offer_id?: unknown; sequence?: unknown; results?: unknown };
  const task = body.task === "emails" ? "emails" : body.task === "score" ? "score" : null;
  const results = Array.isArray(body.results) ? (body.results as { lead_id?: unknown; answer?: unknown }[])
    .filter((r) => r && typeof r.lead_id === "string" && /^[0-9a-f-]{36}$/i.test(r.lead_id)).slice(0, 50) as { lead_id: string; answer: unknown }[] : [];
  if (!task || !results.length || typeof body.offer_id !== "string") return NextResponse.json({ error: "Give task, offer_id and results: [{ lead_id, answer }] (up to 50)." }, { status: 400 });
  const plan = await agentPlan(sb, gate.team, task, body.offer_id, typeof body.sequence === "string" ? body.sequence : "default");
  if ("error" in plan) return NextResponse.json({ error: plan.error }, { status: 400 });
  const { data: rows } = await sb.from("leads").select("id,email,data,outreach_approved").in("id", results.map((r) => r.lead_id)).eq("team_id", gate.team);   // only the current team
  const leads = new Map(((rows ?? []) as { id: string; email: string | null; data: LeadData | null; outreach_approved?: boolean }[]).map((l) => [l.id, l]));
  let dnc;
  try { dnc = await teamDnc(sb, gate.team, [...leads.values()].map((l) => ({ email: l.email, emails: (l.data as { emails?: string[] } | null)?.emails, website: (l.data as { website?: string } | null)?.website }))); }
  catch { return NextResponse.json({ error: "Could not check the Do-not-contact list just now. Nothing was saved. Try again in a minute." }, { status: 503 }); }
  const saved: Record<string, unknown>[] = [], skipped: { lead_id: string; why: string }[] = [];
  for (const r of results) {
    const l = leads.get(r.lead_id);
    if (!l) { skipped.push({ lead_id: r.lead_id, why: "lead not found" }); continue; }
    const d = l.data ?? {};
    if (task === "emails" && !l.email) { skipped.push({ lead_id: l.id, why: "no email" }); continue; }
    if (task === "emails" && dncBlocks({ email: l.email, emails: (d as { emails?: string[] }).emails, website: (d as { website?: string }).website }, dnc)) { skipped.push({ lead_id: l.id, why: "do not contact" }); continue; }
    const answer = typeof r.answer === "string" ? (() => { try { return JSON.parse(r.answer as string); } catch { return null; } })() : r.answer;
    const res = aiAnswer(plan, l, answer);
    if (!res.ok) { skipped.push({ lead_id: l.id, why: res.why }); continue; }
    const { error } = await sb.from("leads").update(res.patch).eq("id", l.id);
    if (error) skipped.push({ lead_id: l.id, why: /permission|policy/i.test(error.message) ? "your role or plan cannot change leads" : "could not save" });
    else saved.push(task === "score" ? res.result : { lead_id: l.id, saved: true });
  }
  return NextResponse.json({ saved, skipped });
}
