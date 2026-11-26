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

  const [usageRes, healthRes] = await Promise.all([
    sb.rpc("admin_usage", { days: 30 }),
    sb.rpc("admin_health_ai", { days: 30 }),
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

  if (healthRes.error) {
    return NextResponse.json({ error: healthRes.error.message }, { status: 500 });
  }

  const health = (healthRes.data ?? {}) as {
    ai?: {
      runs24h: number;
      ok24h: number;
      errors24h: number;
      cost24h: number;
      runs30d: number;
      cost30d: number;
      recentErrors: Omit<AiRunRow, "cost_usd">[];
    };
    jobs?: Record<"queued" | "running" | "done" | "error" | "skipped", number> | null;
  };

  const ai = health.ai ?? {
    runs24h: 0,
    ok24h: 0,
    errors24h: 0,
    cost24h: 0,
    runs30d: 0,
    cost30d: 0,
    recentErrors: [],
  };
  const jobs = health.jobs ?? null;

  return NextResponse.json({ funnel, ai, jobs });
}
