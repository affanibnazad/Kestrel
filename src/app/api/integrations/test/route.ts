import { NextResponse } from "next/server";
import { currentUser, supabaseServer } from "@/lib/supabase/server";
import { deliver, type OutboxItem } from "@/lib/integrations";

// Connections → Webhooks → Send test: puts one example event in the outbox (owner or manager, database 037) and delivers it
// at once, so the person sees the answer of their Zapier / Make / n8n URL right away.
export const maxDuration = 30;

export async function POST(req: Request) {
  if (!(await currentUser())) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  const secret = process.env.MAIL_SERVER_SECRET || "";
  if (secret.length < 32) return NextResponse.json({ error: "Webhooks are not switched on yet (server secret)." }, { status: 503 });
  const body = await req.json().catch(() => null) as { id?: unknown } | null;
  const id = typeof body?.id === "string" && /^[0-9a-f-]{36}$/i.test(body.id) ? body.id : "";
  if (!id) return NextResponse.json({ error: "Which webhook?" }, { status: 400 });

  const sb = await supabaseServer();
  const { data: itemId, error } = await sb.rpc("test_webhook", { hook_id: id });
  if (error) return NextResponse.json({ error: /test_webhook|schema cache/i.test(error.message) ? "Webhooks are coming soon to your workspace." : error.message.replace(/^.*?: /, "") }, { status: 400 });
  const { data: items } = await sb.rpc("integration_due", { server_secret: secret, max_n: 1, only_id: itemId });
  const item = ((items ?? []) as OutboxItem[])[0];
  if (!item) return NextResponse.json({ ok: true, note: "Queued. It is sent within a minute." });
  const r = await deliver(item);
  await sb.rpc("integration_report", { server_secret: secret, item: item.id, success: r.ok, http_status: r.status, err: r.error || null });
  return NextResponse.json({ ok: r.ok, status: r.status, note: r.ok ? `Delivered (HTTP ${r.status}).` : `Not delivered: ${r.error}` });
}
