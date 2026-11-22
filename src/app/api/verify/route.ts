import { NextResponse } from "next/server";
import { createHmac } from "node:crypto";
import dns from "node:dns/promises";
import { currentUser, supabaseServer } from "@/lib/supabase/server";
import { dncBlocks } from "@/lib/dnc";
import { teamDnc } from "@/lib/dnc-server";
import { fromHunter, precheck, type EmailCheck } from "@/lib/verify";

// Verify emails (database 044): Valid / Invalid / Risky for each lead's email, before outreach.
// 1. Checks in Kestrel: format, typos, throwaway inboxes, and whether the domain has a mail server (MX).
// 2. Affan's own verifier server (quarry-cloud/public/verifier) asks the mail server whether the mailbox exists, when
//    VERIFIER_URL and VERIFIER_SECRET are set on Vercel. Requests are signed (HMAC); the server never sends email.
// 3. Hunter's email verifier with the team's key, when the server is not set up or could not decide.
// Runs as the signed-in person: row-level security decides which leads they can change. Keys are never returned.
export const maxDuration = 60;
const MAX_PER_CALL = 25, BUDGET_MS = 45_000;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Lead = { id: string; team_id: string; email: string | null; website: string | null };
type Result = EmailCheck | null;

const withTimeout = <T,>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<never>((_, no) => setTimeout(() => no(new Error("timeout")), ms))]);

// Does the domain receive email? "none" = certainly not; "a-only" = no MX but an address (mail may still work).
async function mailDomain(domain: string): Promise<"ok" | "none" | "a-only" | "unknown"> {
  try {
    const mx = await withTimeout(dns.resolveMx(domain), 5000);
    if (mx.length && mx.every((m) => !m.exchange || m.exchange === ".")) return "none";
    if (mx.length) return "ok";
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code !== "ENODATA" && code !== "ENOTFOUND") return "unknown";
  }
  try { await withTimeout(dns.resolve4(domain), 5000); return "a-only"; } catch (e) {
    return (e as { code?: string }).code === "ENOTFOUND" || (e as { code?: string }).code === "ENODATA" ? "none" : "unknown";
  }
}

// Where the verifier server is: Owner → Email verifier (database 045), else the VERIFIER_URL / VERIFIER_SECRET settings on Vercel.
type Sb = Awaited<ReturnType<typeof supabaseServer>>;
async function verifierConfig(sb: Sb): Promise<{ url: string; secret: string }> {
  const ms = process.env.MAIL_SERVER_SECRET || "";
  if (ms.length >= 32) {
    const { data, error } = await sb.rpc("verifier_config", { server_secret: ms });
    const c = data as { url?: string | null; secret?: string | null } | null;
    if (!error && c?.url && c?.secret) return { url: c.url, secret: c.secret };
  }
  return { url: (process.env.VERIFIER_URL || "").replace(/\/+$/, ""), secret: process.env.VERIFIER_SECRET || "" };
}

async function askServer(cfg: { url: string; secret: string }, emails: string[]): Promise<Map<string, { status: string; reason: string; catchAll?: boolean }> | null> {
  const { url, secret } = cfg;
  if (!/^https:\/\//.test(url) || secret.length < 32 || !emails.length) return null;
  const body = JSON.stringify({ emails }), t = Math.floor(Date.now() / 1000);
  const sig = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  try {
    const r = await fetch(`${url}/check`, { method: "POST", body, redirect: "error", signal: AbortSignal.timeout(43_000),
      headers: { "content-type": "application/json", "x-kestrel-time": String(t), "x-kestrel-signature": sig } });
    if (!r.ok) return null;
    const j = await r.json() as { results?: { email: string; status: string; reason: string; catchAll?: boolean }[] };
    return new Map((j.results ?? []).map((x) => [String(x.email).toLowerCase(), x]));
  } catch { return null; }
}

export async function POST(request: Request) {
  if (!(await currentUser())) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  const started = Date.now();
  const body = await request.json().catch(() => ({})) as { ids?: unknown };
  const ids = (Array.isArray(body.ids) ? body.ids : []).filter((x): x is string => typeof x === "string" && ID.test(x)).slice(0, MAX_PER_CALL);
  if (!ids.length) return NextResponse.json({ error: "Nothing to check." }, { status: 400 });
  const sb = await supabaseServer();
  const { data: rows, error } = await sb.from("leads").select("id,team_id,email,website").in("id", ids);
  if (error) return NextResponse.json({ error: /email_status|column/.test(error.message) ? "Email checks are coming soon to your workspace." : "Could not read the leads." }, { status: 500 });
  const leads = ((rows ?? []) as Lead[]).filter((l) => l.email);
  if (!leads.length) return NextResponse.json({ done: [], skipped: ids.map((id) => ({ id, why: "no email" })) });
  const team = leads[0].team_id;
  if (leads.some((l) => l.team_id !== team)) return NextResponse.json({ error: "These leads belong to different teams. Run one team at a time." }, { status: 400 });

  const skipped: { id: string; why: string }[] = [];
  let dnc;
  try { dnc = await teamDnc(sb, team, leads.map((l) => ({ email: l.email, website: l.website }))); }
  catch { return NextResponse.json({ error: "Could not check your Do-not-contact list just now. Try again in a minute." }, { status: 503 }); }

  // 1. Checks in Kestrel.
  const results = new Map<string, Result>();
  const todo: Lead[] = [];
  const domains = new Map<string, Promise<"ok" | "none" | "a-only" | "unknown">>();
  for (const l of leads) {
    if (dncBlocks({ email: l.email }, dnc)) { skipped.push({ id: l.id, why: "do not contact" }); continue; }
    const p = precheck(l.email);
    if (p.status === "invalid") { results.set(l.id, { status: "invalid", reason: p.reason, by: "format", role: p.role, free: p.free, suggest: p.suggest }); continue; }
    if (!domains.has(p.domain)) domains.set(p.domain, mailDomain(p.domain));
    todo.push(l);
  }
  const flags = new Map(todo.map((l) => { const p = precheck(l.email); return [l.id, { role: p.role, free: p.free, domain: p.domain }]; }));
  const stillOpen: Lead[] = [];
  for (const l of todo) {
    const f = flags.get(l.id)!, d = await domains.get(f.domain)!;
    if (d === "none") results.set(l.id, { status: "invalid", reason: "The domain has no mail server", by: "dns", role: f.role, free: f.free });
    else stillOpen.push(l);
  }

  // 2. Affan's own verifier server.
  const server = stillOpen.length ? await askServer(await verifierConfig(sb), stillOpen.map((l) => String(l.email).toLowerCase())) : null;
  const forHunter: Lead[] = [];
  for (const l of stillOpen) {
    const f = flags.get(l.id)!, s = server?.get(String(l.email).toLowerCase());
    if (s && (s.status === "valid" || s.status === "invalid")) { results.set(l.id, { status: s.status, reason: s.reason, by: "server", role: f.role, free: f.free }); continue; }
    if (s && s.status === "risky" && s.catchAll) { results.set(l.id, { status: "risky", reason: s.reason, by: "server", role: f.role, free: f.free, catchAll: true }); continue; }
    if (s && s.status === "later") { skipped.push({ id: l.id, why: "time" }); continue; }
    forHunter.push(l);
    if (s) results.set(l.id, { status: "risky", reason: s.reason, by: "server", role: f.role, free: f.free });
  }

  // 3. Hunter, for what is still open (no server, or the server could not decide).
  let hunterNote = "";
  if (forHunter.length) {
    const secret = process.env.MAIL_SERVER_SECRET || "";
    const k = secret.length >= 32 ? await sb.rpc("finder_keys_for_server", { server_secret: secret }) : null;
    const key = (k?.data as { hunter?: string } | null)?.hunter ?? "";
    for (const l of forHunter) {
      const f = flags.get(l.id)!;
      if (!key || hunterNote || Date.now() - started > BUDGET_MS) {
        if (!results.has(l.id)) results.set(l.id, null);   // format and domain fine, mailbox not checked
        continue;
      }
      const r = await fetch(`https://api.hunter.io/v2/email-verifier?${new URLSearchParams({ email: String(l.email), api_key: key })}`, { signal: AbortSignal.timeout(15_000), redirect: "error" })
        .catch(() => null);
      if (r?.status === 429 || r?.status === 402 || r?.status === 403) { hunterNote = "Hunter has no checks left this month, or too many at once."; if (!results.has(l.id)) results.set(l.id, null); continue; }
      if (r?.status === 401) { hunterNote = "Hunter did not accept your team's key. Replace it in Connections."; if (!results.has(l.id)) results.set(l.id, null); continue; }
      const h = r?.ok ? fromHunter(await r.json().catch(() => null)) : null;
      if (h) results.set(l.id, { ...h, by: "hunter", role: f.role, free: f.free });
      else if (!results.has(l.id)) results.set(l.id, null);
    }
  }

  // Save. A lead whose mailbox could not be checked keeps no label, only a note that format and domain are fine.
  const done: { id: string; status: string | null; reason: string }[] = [];
  const now = new Date().toISOString();
  for (const l of leads) {
    if (!results.has(l.id)) continue;
    const r = results.get(l.id)!;
    const check = r ?? { reason: "Format and domain are fine; the mailbox was not checked (no verifier server or Hunter key)", by: "dns", ...flags.get(l.id) };
    const { error: e } = await sb.from("leads").update({ email_status: r?.status ?? null, email_checked_at: now, email_check: check }).eq("id", l.id);
    if (e) skipped.push({ id: l.id, why: /email_status|column/.test(e.message) ? "database 044 missing" : "could not save" });
    else done.push({ id: l.id, status: r?.status ?? null, reason: check.reason });
  }
  return NextResponse.json({ done, skipped, server: Boolean(server), note: hunterNote || undefined });
}
