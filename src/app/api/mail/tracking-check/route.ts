import { NextResponse } from "next/server";
import { promises as dns } from "node:dns";
import { currentUser, supabaseServer } from "@/lib/supabase/server";

// Checks the team's tracking domain: its DNS points to Vercel (CNAME) and https://<domain>/api/mail/ping reaches Kestrel.
// Only then can campaigns use open tracking. Owners and managers only.
export const maxDuration = 30;

export async function POST() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  const secret = process.env.MAIL_SERVER_SECRET || "";
  if (secret.length < 32) return NextResponse.json({ error: "Mail is not set up on the server yet." }, { status: 503 });
  const sb = await supabaseServer();
  const { data } = await sb.rpc("my_tracking");
  const domain = String((data as { domain?: string } | null)?.domain || "");
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(domain)) return NextResponse.json({ error: "Save a tracking domain first." }, { status: 400 });

  const steps: { name: string; ok: boolean; detail: string }[] = [];
  const cname = await dns.resolveCname(domain).catch(() => [] as string[]);
  const dnsOk = cname.some((c) => /vercel-dns\.com\.?$/i.test(c));
  steps.push({ name: "DNS", ok: dnsOk, detail: dnsOk ? `CNAME → ${cname[0]}` : cname.length ? `CNAME points to ${cname[0]}, not cname.vercel-dns.com` : "No CNAME record found yet (DNS can take up to an hour)" });
  let pingOk = false;
  if (dnsOk) {
    const r = await fetch(`https://${domain}/api/mail/ping`, { signal: AbortSignal.timeout(10000), redirect: "manual" }).catch(() => null);
    pingOk = Boolean(r && r.ok && (await r.text()) === "kestrel-ok");
    steps.push({ name: "Reaches Kestrel", ok: pingOk, detail: pingOk ? "https works" : "Not reaching Kestrel yet: the domain must also be added to the Kestrel project on Vercel" });
  }
  const ok = dnsOk && pingOk;
  const { error } = await sb.rpc("tracking_checked", { server_secret: secret, ok });
  if (error) return NextResponse.json({ error: /owner or a manager/.test(error.message) ? "Only the owner or a manager can check the tracking domain." : "Could not save the check." }, { status: 403 });
  return NextResponse.json({ ok, domain, steps });
}
