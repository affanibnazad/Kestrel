import { NextResponse } from "next/server";
import { promises as dns } from "node:dns";
import { currentUser, supabaseServer } from "@/lib/supabase/server";

// Domain health for a sending domain (M1): MX, SPF, DKIM (common selectors), DMARC, and whether it is your main website.
// Only for domains of the team's own mailboxes. DNS lookups only: nothing is changed and nothing is sent.
export const maxDuration = 30;
const SELECTORS = ["google", "selector1", "selector2", "default", "k1", "zoho", "zmail", "dkim", "mail", "s1", "s2", "hostingermail1", "mxvault"];
type Check = { name: string; ok: boolean | null; detail: string; fix?: string };

const txt = async (name: string) => (await dns.resolveTxt(name).catch(() => [] as string[][])).map((r) => r.join(""));

export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  const domain = (new URL(request.url).searchParams.get("domain") || "").trim().toLowerCase();
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(domain)) return NextResponse.json({ error: "Not a domain." }, { status: 400 });
  const sb = await supabaseServer();
  const { data: boxes } = await sb.from("mailboxes").select("email");
  if (!(boxes ?? []).some((b) => String(b.email).split("@")[1] === domain)) return NextResponse.json({ error: "Only domains of your own mailboxes can be checked." }, { status: 403 });
  const { data: account } = await sb.rpc("my_account");
  const site = String((account as { website?: string } | null)?.website || "").replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].toLowerCase();
  const free = /^(gmail|googlemail|outlook|hotmail|live|yahoo|icloud|proton|protonmail)\.[a-z.]+$/.test(domain);

  const checks: Check[] = [];
  const mx = await dns.resolveMx(domain).catch(() => []);
  checks.push({ name: "MX (can receive replies)", ok: mx.length > 0, detail: mx.length ? mx.sort((a, b) => a.priority - b.priority).slice(0, 2).map((m) => m.exchange).join(", ") : "No MX record", fix: "Add the MX records your email provider gives you." });
  const spf = (await txt(domain)).filter((r) => /^v=spf1/i.test(r));
  checks.push({ name: "SPF", ok: spf.length === 1, detail: spf.length === 1 ? spf[0] : spf.length > 1 ? "More than one SPF record (only one is allowed)" : "No SPF record",
    fix: spf.length > 1 ? "Merge them into one TXT record starting with v=spf1." : "Add a TXT record on the domain, for example: v=spf1 include:_spf.google.com ~all (use your provider's include)." });
  let dkim = "";
  for (const sel of SELECTORS) { const r = (await txt(`${sel}._domainkey.${domain}`)).find((x) => /v=DKIM1|k=rsa|p=/i.test(x)); if (r) { dkim = sel; break; } }
  checks.push({ name: "DKIM", ok: dkim ? true : null, detail: dkim ? `Found (selector “${dkim}”)` : "Not found with common selectors (it may use another name)", fix: "Turn on DKIM signing at your email provider and add the TXT record it gives you." });
  const dmarc = (await txt(`_dmarc.${domain}`)).find((r) => /^v=DMARC1/i.test(r)) || "";
  const policy = /p=(none|quarantine|reject)/i.exec(dmarc)?.[1]?.toLowerCase();
  checks.push({ name: "DMARC", ok: Boolean(dmarc), detail: dmarc ? `Policy: ${policy ?? "unknown"}` : "No DMARC record", fix: "Add a TXT record at _dmarc with: v=DMARC1; p=none; rua=mailto:you@yourdomain.com (then move to quarantine later)." });
  checks.push({ name: "Not your main website domain", ok: free ? null : site ? domain !== site : null,
    detail: free ? "A free mailbox (Gmail, Outlook…): fine for tests, use your own look-alike domains for campaigns" : site && domain === site ? "This is your main website domain" : "OK",
    fix: "Best practice: never cold email from your main domain. Buy a look-alike domain (for example getyourbrand.com) that redirects to your site." });
  return NextResponse.json({ domain, checks });
}
