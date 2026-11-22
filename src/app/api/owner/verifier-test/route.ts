import { NextResponse } from "next/server";
import { createHmac, randomBytes } from "node:crypto";
import { currentUser, supabaseServer } from "@/lib/supabase/server";

// Owner → Email verifier → Test (database 045, Kestrel admins only). 1. The server answers on https (/health).
// 2. It checks a made-up Gmail address that cannot exist: "Invalid" proves port 25 works and the secret matches.
// The secret stays on the server side; only a plain result goes back to the page and is kept for the panel.
export const maxDuration = 60;

export async function POST() {
  if (!(await currentUser())) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const sb = await supabaseServer();
  const { data: admin } = await sb.rpc("is_admin");
  if (admin !== true) return NextResponse.json({ error: "Only Kestrel admins can test the email verifier." }, { status: 403 });
  const ms = process.env.MAIL_SERVER_SECRET || "";
  if (ms.length < 32) return NextResponse.json({ error: "The server secret is missing on Vercel (MAIL_SERVER_SECRET)." }, { status: 503 });
  const { data, error } = await sb.rpc("verifier_config", { server_secret: ms });
  if (error) return NextResponse.json({ error: /verifier_config|schema cache/i.test(error.message) ? "The email verifier needs database 045." : "Could not read the settings." }, { status: 400 });
  const c = data as { url: string | null; secret: string | null };
  if (!c.url || !c.secret) return NextResponse.json({ error: "Add the server address and make a secret first (and switch it on)." }, { status: 400 });

  const done = async (ok: boolean, note: string) => {
    await sb.rpc("record_verifier_check", { ok, note });
    return NextResponse.json({ ok, note });
  };
  const health = await fetch(`${c.url}/health`, { redirect: "error", signal: AbortSignal.timeout(10_000), cache: "no-store" }).catch(() => null);
  if (!health) return done(false, `No answer from ${c.url}. Check the DNS record (A, check → server IP), that the install finished, and that ports 80 and 443 are open.`);
  if (!health.ok) return done(false, `${c.url} answered ${health.status}. Run the install line on the server again.`);

  const fake = `kestrel-test-${randomBytes(6).toString("hex")}@gmail.com`;
  const body = JSON.stringify({ emails: [fake] }), t = Math.floor(Date.now() / 1000);
  const sig = createHmac("sha256", c.secret).update(`${t}.${body}`).digest("hex");
  const r = await fetch(`${c.url}/check`, { method: "POST", body, redirect: "error", signal: AbortSignal.timeout(45_000), cache: "no-store",
    headers: { "content-type": "application/json", "x-kestrel-time": String(t), "x-kestrel-signature": sig } }).catch(() => null);
  if (!r) return done(false, "The server is online but the check took too long. Try again in a minute.");
  if (r.status === 401) return done(false, "The server is online but the secret does not match. Copy the install line again and run it on the server.");
  if (!r.ok) return done(false, `The check answered ${r.status}. Run the install line on the server again.`);
  const res = ((await r.json().catch(() => ({}))) as { results?: { status: string; reason: string }[] }).results?.[0];
  if (res?.status === "invalid") return done(true, "Working: the server reached Gmail's mail server and correctly found a made-up address invalid.");
  if (res?.status === "risky" && /reach/i.test(res.reason)) return done(false, "The server cannot reach mail servers: outbound port 25 is blocked. Ask your VPS provider to open outbound port 25.");
  return done(false, `Unexpected answer (${res?.status ?? "none"}: ${res?.reason ?? ""}). Check reverse DNS and try again.`);
}
