import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dncCandidates, dncIndex, type DncIndex } from "./dnc";

type Who = { email?: string | null; emails?: string[] | null; website?: string | null };

// The team's Do-not-contact entries that can block these leads, without loading the whole list (the API cuts at 1000 rows):
// 1. every exact entry the leads could match (their emails, email domains, website hosts and parent domains), in chunks;
// 2. any entry not stored in the clean form (e.g. "www.acme.com", "https://acme.com/", "mailto:…"): normally none, since the
//    App and the extension clean entries first, but the table accepts them, so they are read and cleaned here (dncIndex).
// Throws on any database error, so callers fail closed (no email found or written when the check could not run).
export async function teamDnc(sb: SupabaseClient, teamId: string, leads: Who[]): Promise<DncIndex> {
  const cand = dncCandidates(leads);
  const rows: { entry: string }[] = [];
  for (let i = 0; i < cand.length; i += 150) {
    const { data, error } = await sb.from("do_not_contact").select("entry").eq("team_id", teamId).in("entry", cand.slice(i, i + 150));
    if (error) throw new Error(`Do-not-contact check failed: ${error.message}`);
    rows.push(...((data ?? []) as { entry: string }[]));
  }
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from("do_not_contact").select("entry").eq("team_id", teamId)
      .or("entry.like.www.*,entry.like.*/*,entry.like.*:*,entry.like.@*").order("entry").range(from, from + 999);
    if (error) throw new Error(`Do-not-contact check failed: ${error.message}`);
    rows.push(...((data ?? []) as { entry: string }[]));
    if (!data || data.length < 1000) break;
  }
  return dncIndex(rows);
}
