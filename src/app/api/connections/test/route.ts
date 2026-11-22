import { NextResponse } from "next/server";
import { currentUser, supabaseServer } from "@/lib/supabase/server";
import { SERVICES, type ServiceId } from "@/lib/connections";
import { testKey, type KeyTestResult } from "@/lib/key-test";

// Connections → Test: checks one team key with a free, read-only call to its company (list models, account info or
// one tiny search), keeps the result for the team, and for AI keys returns the models that key can use.
// The key is read on the server (owner or manager only) and never sent to the browser.
export const maxDuration = 30;

const short = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").slice(0, 160);

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const body = await req.json().catch(() => null) as { service?: string } | null;
  const service = String(body?.service || "") as ServiceId;
  if (!(service in SERVICES)) return NextResponse.json({ error: "Unknown service." }, { status: 400 });

  const secret = process.env.MAIL_SERVER_SECRET || "";
  if (secret.length < 32) return NextResponse.json({ error: "Testing keys is not switched on yet (server secret)." }, { status: 503 });
  const sb = await supabaseServer();
  const { data: key, error } = await sb.rpc("key_for_check", { server_secret: secret, service });
  if (error) return NextResponse.json({ error: /owner or a manager/.test(error.message) ? "Only the owner or a manager can test keys." : "Testing keys is coming soon to your workspace." }, { status: 403 });
  if (!key) return NextResponse.json({ error: "Add a key first." }, { status: 400 });

  let result: KeyTestResult;
  try { result = await testKey(service, String(key)); } catch { result = { ok: false, note: `Could not reach ${SERVICES[service].name}. Try again.` }; }
  await sb.rpc("record_key_check", { service, ok: result.ok, note: short(result.note) });
  return NextResponse.json({ ok: result.ok, note: short(result.note), models: result.models ?? [] });
}
