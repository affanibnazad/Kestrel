// The AI activity log (Phase 3E, database 061): one row per change Kestrel AI made after a Confirm, and per Score and
// write run. Best effort: a missing table (before 061) or a network problem never blocks the work itself.
import { supabaseBrowser } from "./supabase/client";

export async function logAiActivity(teamId: string | null | undefined, row: { kind: string; summary: string; ok: boolean; detail?: string | null; ai?: string | null }) {
  if (!teamId) return;
  try {
    await supabaseBrowser().from("ai_activity").insert({
      team_id: teamId, kind: row.kind.replace(/[^a-z_]/g, "").slice(0, 40) || "other", summary: row.summary.slice(0, 400) || "AI action",
      ok: row.ok, detail: row.detail ? row.detail.slice(0, 400) : null, ai: row.ai ? row.ai.slice(0, 60) : null,
    });
  } catch { /* the log is a record, never a blocker */ }
}
