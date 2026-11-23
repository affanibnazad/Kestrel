import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { aiPlan, type AiPlan } from "./lead-steps";
import type { Offer } from "./ai";
import { mcpAllowed } from "./plans";
import { aboutForAi, cleanAbout } from "./about";

// Kestrel MCP (Claude Code / Codex on the person's computer): paid plans only (Affan, 17 Nov 2026). The free trial and an
// ended plan get a plain message. Everything else is the person's own permissions (row-level security).
export async function mcpGate(sb: SupabaseClient): Promise<{ team: string; role: string } | NextResponse> {
  const { data } = await sb.rpc("my_account");
  const a = data as { team_id?: string; role?: string; plan?: string; active?: boolean; access_until?: string | null } | null;
  if (!a?.team_id) return NextResponse.json({ error: "Please sign in again (kestrel-mcp login)." }, { status: 401 });
  if (!mcpAllowed(a)) {
    return NextResponse.json({ error: "Kestrel MCP is part of the paid plans. Choose a plan in the Kestrel App (Plan and billing)." }, { status: 402 });
  }
  return { team: a.team_id, role: a.role ?? "viewer" };
}
export const canWork = (role: string) => ["owner", "manager", "researcher"].includes(role);

// The same instructions as the App's own AI, for the person's Claude Code or Codex plan to follow (no AI key needed).
// Everything comes from the person's current team only (a person in two teams never mixes them).
export async function agentPlan(sb: SupabaseClient, team: string, task: "score" | "emails", offerId: string, sequence: string): Promise<AiPlan | { error: string }> {
  const [{ data: offer }, { data: ai }, { data: aboutRow }, { data: allActiveOffers }] = await Promise.all([
    sb.from("offer_profiles").select("*").eq("id", offerId).eq("team_id", team).maybeSingle(),
    sb.from("team_ai").select("*").eq("team_id", team).maybeSingle(),
    sb.from("team_about").select("*").eq("team_id", team).maybeSingle(),   // database 059
    task === "score" ? sb.from("offer_profiles").select("*").eq("team_id", team).order("name") : Promise.resolve({ data: [] }),
  ]);
  const settings = ai ? { ...ai, about: aboutForAi(aboutRow ? cleanAbout(aboutRow) : null) } : null;
  if (!offer) return { error: "Offer not found. Use list_offers for the ids." };
  let seq: { steps: unknown; id: string } | "default" | null = null;
  if (task === "emails") {
    if (sequence === "none") seq = null;
    else if (/^[0-9a-f-]{36}$/i.test(sequence)) {
      const { data: row } = await sb.from("sequences").select("id,steps").eq("id", sequence).eq("team_id", team).maybeSingle();
      if (!row) return { error: "Sequence not found. Use list_sequences for the ids." };
      seq = { steps: row.steps, id: row.id as string };
    } else seq = "default";
  }
  const activeServices = ((allActiveOffers ?? []) as (Offer & { active?: boolean })[]).filter((o) => o.active !== false);
  // Model and key are not used here: the person's own plan does the thinking.
  const p = aiPlan(task, offer as Offer, { ...(settings ?? {}), provider: "anthropic", model: "" }, "agent", seq, activeServices);
  return "error" in p ? p : { ...p, by: "kestrel-mcp" };
}
