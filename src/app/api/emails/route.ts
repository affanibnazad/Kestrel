import { NextResponse } from "next/server";
import { currentUser, supabaseServer } from "@/lib/supabase/server";
import { dncBlocks } from "@/lib/dnc";
import { teamDnc } from "@/lib/dnc-server";
import { hostOf, hunterAccountUrl, hunterCredits } from "@/lib/hunter";
import { findOne, type FindLead } from "@/lib/lead-steps";

// Find Emails: looks up emails for leads with the team's Hunter.io key, like the extension's Find Emails. When Hunter finds
// no email but a person's name is known, the team's other finders are tried in order: Apollo, then Findymail (database 037).
// Runs as the signed-in person (row-level security decides which leads they can change). The key is read here and never returned.
// Leads on Do-not-contact are skipped, and emails on it are never added. The work on each lead is shared with Autopilot (lib/lead-steps.ts).
export const maxDuration = 60;
const MAX_PER_CALL = 10;

type Keys = { hunter?: string; apollo?: string; findymail?: string };
async function teamKey() {
  const sb = await supabaseServer();
  const secret = process.env.MAIL_SERVER_SECRET || "";
  if (secret.length >= 32) {   // all finders (database 037)
    const all = await sb.rpc("finder_keys_for_server", { server_secret: secret });
    if (!all.error) {
      const keys = (all.data ?? {}) as Keys;
      const any = Boolean(keys.hunter || keys.apollo || keys.findymail);
      return { sb, key: keys.hunter ?? "", keys, error: any ? "" : "Your team has no email finder key yet. Add Hunter (or Apollo or Findymail) in Integrations → Services." };
    }
    if (/PLAN_NEEDED/.test(all.error.message)) return { sb, key: "", keys: {} as Keys, error: all.error.message.replace(/^PLAN_NEEDED:\s*/, "") };
    if (/can change leads|find emails/.test(all.error.message)) return { sb, key: "", keys: {} as Keys, error: "Your role can view leads but not find emails. Ask your team owner." };
  }
  const { data, error } = await sb.rpc("source_key_for_server", { service: "hunter" });
  if (error) {
    const m = error.message;
    return { sb, key: "", keys: {} as Keys, error: /PLAN_NEEDED/.test(m) ? m.replace(/^PLAN_NEEDED:\s*/, "") : /can change leads|find emails/.test(m) ? "Your role can view leads but not find emails. Ask your team owner." : "Find Emails is coming soon to your workspace." };
  }
  return { sb, key: typeof data === "string" ? data : "", keys: { hunter: typeof data === "string" ? data : undefined } as Keys, error: data ? "" : "Your team has no Hunter.io key yet. Add one in Integrations → Services." };
}

// How many Hunter credits are left this month.
export async function GET() {
  if (!(await currentUser())) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  const { key, error } = await teamKey();
  if (error) return NextResponse.json({ error }, { status: 400 });
  if (!key) return NextResponse.json({ left: null });
  try {
    const res = await fetch(hunterAccountUrl(key), { signal: AbortSignal.timeout(15000) });
    if (res.status === 401) return NextResponse.json({ error: "Hunter did not accept your team's key. Replace it in Integrations → Services." }, { status: 400 });
    const c = hunterCredits(await res.json());
    return NextResponse.json({ left: c.available === null ? null : Math.max(0, c.available - (c.used || 0)), plan: c.plan, reset: c.reset });
  } catch { return NextResponse.json({ left: null }); }
}

type Row = FindLead & { team_id: string; verdict: string | null };

export async function POST(request: Request) {
  if (!(await currentUser())) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { ids?: unknown };
  const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string" && /^[0-9a-f-]{36}$/i.test(x)).slice(0, MAX_PER_CALL) : [];
  if (!ids.length) return NextResponse.json({ error: "Nothing to do." }, { status: 400 });
  const { sb, keys, error } = await teamKey();
  if (error) return NextResponse.json({ error }, { status: 400 });
  const stopped: Record<string, string> = {};   // a finder that must not be asked again in this run

  const { data: rows } = await sb.from("leads").select("id,team_id,name,website,email,verdict,data").in("id", ids);
  const leads = (rows ?? []) as Row[];
  if (!leads.length) return NextResponse.json({ done: [], skipped: [] });
  // One team per batch: every check below (Do-not-contact, rules) is that team's own.
  const team = leads[0].team_id;
  if (leads.some((l) => l.team_id !== team)) return NextResponse.json({ error: "These leads belong to different teams. Run one team at a time." }, { status: 400 });
  let dnc;
  try { dnc = await teamDnc(sb, team, leads.map((l) => ({ email: l.email, emails: (l.data as { emails?: string[] } | null)?.emails, website: l.website ?? (l.data as { website?: string } | null)?.website }))); }
  catch { return NextResponse.json({ error: "Could not check your Do-not-contact list just now. Try again in a minute." }, { status: 503 }); }
  const { data: rules } = await sb.from("team_rules").select("weights,tiers,rules,refine").eq("team_id", team).maybeSingle();
  // Newly found addresses: look up their own entries too (the first lookup only knew the leads' existing emails and sites).
  // If that check fails, the addresses are not saved (fail closed).
  const allowed = async (found: string[]) => {
    try {
      const more = await teamDnc(sb, team, found.map((e) => ({ email: e })));
      more.emails.forEach((e) => dnc.emails.add(e)); more.domains.forEach((d) => dnc.domains.add(d));
    } catch { return []; }
    return found.filter((e) => !dncBlocks({ email: e }, dnc));
  };
  const done: { id: string; email: string | null; named: boolean; website: string | null }[] = [], skipped: { id: string; why: string }[] = [];

  // Vercel stops the function at 60 s: after 45 s the remaining leads are left for the next batch (they keep no email yet).
  const started = Date.now();
  for (const l of leads) {
    if (Date.now() - started > 45_000) { skipped.push({ id: l.id, why: "time" }); continue; }
    const r = await findOne(l, keys, stopped, dnc, allowed, rules);
    if (!r.ok) { skipped.push({ id: l.id, why: r.why }); continue; }
    const { error: saveError } = await sb.from("leads").update(r.patch).eq("id", l.id);
    if (saveError) { skipped.push({ id: l.id, why: "could not save" }); continue; }
    done.push({ id: l.id, email: r.patch.email, named: r.patch.named, website: hostOf(r.patch.website || "") ? r.patch.website : null });
  }
  const notes = Object.values(stopped);
  return NextResponse.json({ done, skipped, error: (notes.length && !done.some((d) => d.email) ? notes.join(" ") : undefined), notes: notes.length ? notes : undefined });
}
