import { NextResponse } from "next/server";
import { currentUser, supabaseServer } from "@/lib/supabase/server";

type UsageTeam = {
  id: string;
  state: string;
  mailboxes: number;
  sent: number;
  replies: number;
  bounced: number;
  leads_total: number;
};

type AiRunRow = {
  id: number;
  task: string;
  slot: string | null;
  source: string;
  status: string;
  cost_usd: number | null;
  error: string | null;
  created_at: string;
};

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const sb = await supabaseServer();
  const { data: admin } = await sb.rpc("is_admin");
  if (!admin) return NextResponse.json({ error: "Not allowed." }, { status: 403 });

  const now = Date.now();
  const since30d = new Date(now - 30 * 86_400_000).toISOString();
  const since24h = new Date(now - 86_400_000).toISOString();

  const [usageRes, runsRes, jobsRes] = await Promise.all([
    sb.rpc("admin_usage", { days: 30 }),
    sb
      .from("ai_runs")
      .select("id,task,slot,source,status,cost_usd,error,created_at")
      .gte("created_at", since30d)
      .order("created_at", { ascending: false })
      .limit(1000),
    sb.from("ai_jobs").select("status").limit(1000),
  ]);

  const teams = (Array.isArray(usageRes.data) ? usageRes.data : []) as UsageTeam[];
  const funnel = {
    teams: teams.length,
    withLeads: teams.filter((t) => t.leads_total > 0).length,
    withMailbox: teams.filter((t) => t.mailboxes > 0).length,
    sentEmails: teams.filter((t) => t.sent > 0).length,
    gotReplies: teams.filter((t) => t.replies > 0).length,
    paying: teams.filter((t) => t.state === "paid").length,
  };

  const runs = (Array.isArray(runsRes.data) ? runsRes.data : []) as AiRunRow[];
  const runs24h = runs.filter((r) => r.created_at >= since24h);
  const sumCost = (arr: AiRunRow[]) =>
    Math.round(arr.reduce((s, r) => s + (Number(r.cost_usd) || 0), 0) * 10000) / 10000;

  const ai = {
    runs24h: runs24h.length,
    ok24h: runs24h.filter((r) => r.status === "ok" || r.status === "fallback").length,
    errors24h: runs24h.filter((r) => r.status === "error" || r.status === "timeout").length,
    cost24h: sumCost(runs24h),
    runs30d: runs.length,
    cost30d: sumCost(runs),
    recentErrors: runs
      .filter((r) => r.status === "error" || r.status === "timeout")
      .slice(0, 15)
      .map((r) => ({
        id: r.id,
        task: r.task,
        slot: r.slot,
        source: r.source,
        status: r.status,
        error: r.error ? r.error.slice(0, 140) : null,
        created_at: r.created_at,
      })),
  };

  let jobs: Record<"queued" | "running" | "done" | "error" | "skipped", number> | null = null;
  if (!jobsRes.error && Array.isArray(jobsRes.data)) {
    const counts = { queued: 0, running: 0, done: 0, error: 0, skipped: 0 };
    for (const j of jobsRes.data as { status?: string }[]) {
      if (j.status && j.status in counts) {
        counts[j.status as keyof typeof counts]++;
      }
    }
    jobs = counts;
  }

  return NextResponse.json({ funnel, ai, jobs });
}
