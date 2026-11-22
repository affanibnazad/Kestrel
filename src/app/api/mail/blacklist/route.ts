import { NextResponse } from "next/server";
import { currentUser, supabaseServer } from "@/lib/supabase/server";
import { checkDomain } from "@/lib/blacklist";

// Email accounts → Domain health → Check now: checks one of the team's sending domains against public blacklists
// (and its private sending server, if any), saves the result for the team, and pauses its email accounts if it is newly
// listed. The same check runs once a day by itself from the mail timer. At most once every 10 minutes per domain.
export const maxDuration = 30;

export async function POST(req: Request) {
  if (!(await currentUser())) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  const secret = process.env.MAIL_SERVER_SECRET || "";
  if (secret.length < 32) return NextResponse.json({ error: "Mail is not set up on the server yet." }, { status: 503 });
  const body = await req.json().catch(() => null) as { domain?: unknown } | null;
  const domain = String(body?.domain ?? "").trim().toLowerCase();
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(domain)) return NextResponse.json({ error: "Not a domain." }, { status: 400 });

  const sb = await supabaseServer();
  // Row security: only the person's own team's email accounts are visible.
  const { data: boxes } = await sb.from("mailboxes").select("team_id,email,smtp_host").order("created_at");
  const box = ((boxes ?? []) as { team_id: string; email: string; smtp_host: string }[]).find((b) => b.email.split("@")[1]?.toLowerCase() === domain);
  if (!box) return NextResponse.json({ error: "Only domains of your own email accounts can be checked." }, { status: 403 });

  const { data: last } = await sb.from("domain_monitor").select("checked_at,listed,results").eq("team_id", box.team_id).eq("domain", domain).maybeSingle();
  if (last && Date.now() - Date.parse(String(last.checked_at)) < 10 * 60_000) return NextResponse.json({ ...(last.results as object), cached: true });

  const result = await checkDomain(domain, box.smtp_host);
  const { error } = await sb.rpc("domain_monitor_report", { server_secret: secret, team: box.team_id, dom: domain, is_listed: result.listed, res: result });
  if (error) return NextResponse.json({ error: /domain_monitor|schema cache/i.test(error.message) ? "The blacklist monitor is coming soon to your workspace." : "Could not save the check." }, { status: 400 });
  return NextResponse.json(result);
}
