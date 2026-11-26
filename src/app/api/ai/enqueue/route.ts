import { NextResponse } from "next/server";
import { currentUser, supabaseServer } from "@/lib/supabase/server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type EnqueueBody = {
  task?: unknown;
  ids?: unknown;
  offerId?: unknown;
  sequence?: unknown;
};

const KIND_MAP = {
  score: "score",
  emails: "write",
  research: "research",
  find_emails: "find_emails",
} as const;

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const body = (await req.json().catch(() => null)) as EnqueueBody | null;
  const rawTask = typeof body?.task === "string" ? body.task : "";
  const kind = KIND_MAP[rawTask as keyof typeof KIND_MAP];
  if (!kind) return NextResponse.json({ error: "Invalid task." }, { status: 400 });

  const ids = [...new Set(
    (Array.isArray(body?.ids) ? body.ids : [])
      .filter((x): x is string => typeof x === "string" && UUID_RE.test(x)),
  )].slice(0, 1000);
  if (ids.length === 0) return NextResponse.json({ error: "No leads selected." }, { status: 400 });

  const offerId = typeof body?.offerId === "string" && UUID_RE.test(body.offerId) ? body.offerId : null;
  const sequenceId = typeof body?.sequence === "string" && UUID_RE.test(body.sequence) ? body.sequence : null;

  const sb = await supabaseServer();
  const { data: acc, error: accErr } = await sb.rpc("my_account");
  const teamId = (acc as { team_id?: string } | null)?.team_id;
  if (accErr || !teamId) return NextResponse.json({ error: "Team not found." }, { status: 403 });

  const { data, error } = await sb.rpc("enqueue_ai_jobs", {
    p_team_id: teamId,
    p_lead_ids: ids,
    p_kind: kind,
    p_offer_id: offerId,
    p_sequence_id: sequenceId,
  });

  if (error) {
    if (/enqueue_ai_jobs|schema cache|does not exist/i.test(error.message)) {
      return NextResponse.json({ fallback: true, error: "Background queue not enabled yet." }, { status: 501 });
    }
    const status = /not allowed/i.test(error.message) ? 403 : 400;
    return NextResponse.json({ error: error.message }, { status });
  }

  const queued = typeof data === "number" ? data : Number(data);
  if (!Number.isFinite(queued) || queued <= 0) {
    return NextResponse.json({ error: "No leads were queued." }, { status: 400 });
  }

  return NextResponse.json({ queued, kind });
}
