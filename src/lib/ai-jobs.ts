import { aiOne, aiPlan, writeChecked, type LeadIn } from "./lead-steps";
import { cleanAbout, aboutForAi } from "./about";
import { dncBlocks, dncIndex } from "./dnc";
import type { Offer, LeadData } from "./ai";

export type AiJobKind = "find_emails" | "research" | "score" | "write" | "qc";

export type ClaimedAiJob = {
  id: string;
  team_id: string;
  user_id: string | null;
  lead_id: string | null;
  offer_id: string | null;
  sequence_id: string | null;
  kind: AiJobKind;
  attempts: number;
  max_attempts: number;
  payload: Record<string, unknown>;
};

export type JobStepOutcome =
  | { status: "done"; summary: string; aiRunId?: number | null }
  | { status: "retry"; error: string; retryAfterSec?: number; aiRunId?: number | null }
  | { status: "skipped"; error: string; aiRunId?: number | null };

export type AiJobsSummary = {
  claimed: number;
  done: number;
  retried: number;
  skipped: number;
  error: number;
};

type RpcError = { message?: string } | null;
type RpcLike = {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data?: unknown; error?: RpcError }>;
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: unknown) => {
        maybeSingle: () => PromiseLike<{ data?: unknown; error?: RpcError }>;
      };
    };
    update: (patch: Record<string, unknown>) => {
      eq: (col: string, val: unknown) => PromiseLike<{ error?: RpcError }>;
    };
  };
};

const NODE_MAP: Record<AiJobKind, { agent: string; from: string }> = {
  find_emails: { agent: "merge", from: "new" },
  research: { agent: "read", from: "sig" },
  score: { agent: "score", from: "quote" },
  write: { agent: "write", from: "angle" },
  qc: { agent: "qc", from: "write" },
};

const PERMANENT_RE = /PLAN_NEEDED|monthly_allowance_reached|allowance_check_failed|used up|401|403|rejected|do not contact|no email|no usable website|Needs human review|No offer/i;

export function isPermanentJobError(msg: string): boolean {
  return PERMANENT_RE.test(msg);
}

async function logBrainEvent(
  sb: RpcLike,
  secret: string,
  job: ClaimedAiJob,
  status: "started" | "ok" | "error" | "skipped",
  ms: number,
  summary: string,
  aiRunId: number | null = null
) {
  const { agent, from } = NODE_MAP[job.kind] ?? { agent: job.kind, from: "new" };
  try {
    await sb.rpc("log_lead_brain_event", {
      server_secret: secret,
      p_team_id: job.team_id,
      p_lead_id: job.lead_id,
      p_job_id: job.id,
      p_agent: agent,
      p_from_agent: from,
      p_status: status,
      p_ms: Math.max(0, Math.round(ms)),
      p_ai_run_id: aiRunId,
      p_summary: summary.slice(0, 200),
    });
  } catch { /* event logging must never fail the job */ }
}

/**
 * Default production executor for one claimed AI job.
 * Runs inside /api/mail/tick with a strict per-job deadline.
 */
export async function executeClaimedJob(
  sb: RpcLike,
  job: ClaimedAiJob,
  deadlineMs: number,
  secret = ""
): Promise<JobStepOutcome> {
  if (!job.lead_id) return { status: "skipped", error: "Missing lead_id" };
  if (job.kind === "find_emails") return { status: "skipped", error: "find_emails runs via lead finder" };

  const taskMap: Record<Exclude<AiJobKind, "find_emails">, "research" | "score" | "emails" | "qc"> = {
    research: "research",
    score: "score",
    write: "emails",
    qc: "qc",
  };
  const task = taskMap[job.kind];

  const [{ data: leadRow }, { data: aiRow }, { data: aboutRow }, { data: offerRow }] = await Promise.all([
    sb.from("leads").select("id,team_id,email,website,data,outreach_approved").eq("id", job.lead_id).maybeSingle(),
    sb.from("team_ai").select("*").eq("team_id", job.team_id).maybeSingle(),
    sb.from("team_about").select("*").eq("team_id", job.team_id).maybeSingle(),
    job.offer_id
      ? sb.from("offer_profiles").select("*").eq("id", job.offer_id).maybeSingle()
      : sb.from("offer_profiles").select("*").eq("team_id", job.team_id).maybeSingle(),
  ]);

  const lead = leadRow as (LeadIn & { website?: string | null; team_id?: string }) | null;
  if (!lead) return { status: "skipped", error: "Lead not found" };
  if (!offerRow) return { status: "skipped", error: "No offer profile configured" };

  const cleanAb = aboutRow ? cleanAbout(aboutRow) : null;
  const settings: Record<string, unknown> | null = aiRow ? { ...(aiRow as Record<string, unknown>), about: aboutForAi(cleanAb) } : null;
  const key = typeof settings?.api_key === "string" ? settings.api_key : "";

  const rawPlan = aiPlan(task, offerRow as Offer, settings, key, null, [], cleanAb?.voice_notes, cleanAb);
  if ("error" in rawPlan) return { status: "skipped", error: rawPlan.error };

  const plan = { ...rawPlan, sb: sb as never, teamId: job.team_id, userId: job.user_id, deadlineMs, ...(secret ? { serverSecret: secret } : {}) };
  const preparedLead: LeadIn = task === "research" && lead.website && !(lead.data as { website?: string } | null)?.website
    ? { ...lead, data: { ...(lead.data ?? {}), website: lead.website } }
    : lead;

  const dnc = task === "score"
    ? dncIndex([])
    : dncIndex([]);

  if (task === "emails" && !lead.outreach_approved && !(lead.data as Record<string, unknown> | null)?.outreach_approved) {
    return { status: "skipped", error: "Needs human review: approve opportunity report first" };
  }
  if (task !== "score" && dncBlocks({ email: lead.email, website: lead.website ?? undefined }, dnc)) {
    return { status: "skipped", error: "do not contact" };
  }

  const res = task === "emails"
    ? await writeChecked(plan, null, preparedLead, dnc, 1, () => Date.now() < deadlineMs - 2_000)
    : await aiOne(plan, preparedLead, dnc);

  if (!res.ok) {
    const why = res.why || "AI job failed";
    return isPermanentJobError(why)
      ? { status: "skipped", error: why }
      : { status: "retry", error: why, retryAfterSec: 60 };
  }

  const { error: updErr } = await sb.from("leads").update(res.patch).eq("id", lead.id);
  if (updErr) return { status: "retry", error: updErr.message || "Could not save lead patch", retryAfterSec: 60 };

  return { status: "done", summary: `${job.kind} completed` };
}

/**
 * Claims up to `maxJobs` due ai_jobs, executes them in parallel within `phaseDeadlineMs`,
 * records `finish_ai_job` and `lead_brain_events`, and never throws.
 */
export async function runDueAiJobs(opts: {
  sb: RpcLike;
  secret: string;
  phaseDeadlineMs: number;
  maxJobs?: number;
  runStep?: (job: ClaimedAiJob, deadlineMs: number) => Promise<JobStepOutcome>;
}): Promise<AiJobsSummary> {
  const summary: AiJobsSummary = { claimed: 0, done: 0, retried: 0, skipped: 0, error: 0 };
  const maxJobs = opts.maxJobs ?? 2;
  const phaseEnd = Date.now() + opts.phaseDeadlineMs;

  const { data, error } = await opts.sb.rpc("claim_ai_jobs", {
    server_secret: opts.secret,
    max_n: maxJobs,
  });
  if (error || !Array.isArray(data) || data.length === 0) return summary;

  const jobs = data as ClaimedAiJob[];
  summary.claimed = jobs.length;

  const runner = opts.runStep ?? ((j, d) => executeClaimedJob(opts.sb, j, d, opts.secret));

  await Promise.allSettled(jobs.map(async (job) => {
    const startedAt = Date.now();
    const jobDeadlineMs = startedAt + Math.min(12_000, Math.max(2_000, phaseEnd - startedAt));
    await logBrainEvent(opts.sb, opts.secret, job, "started", 0, `Running ${job.kind}`);

    let outcome: JobStepOutcome;
    try {
      outcome = await runner(job, jobDeadlineMs);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err || "Unknown error");
      outcome = isPermanentJobError(msg)
        ? { status: "skipped", error: msg }
        : { status: "retry", error: msg, retryAfterSec: 60 };
    }

    const ms = Date.now() - startedAt;
    if (outcome.status === "done") {
      await opts.sb.rpc("finish_ai_job", {
        server_secret: opts.secret,
        p_job_id: job.id,
        p_status: "done",
        p_error: null,
        p_retry_after_sec: 60,
      });
      await logBrainEvent(opts.sb, opts.secret, job, "ok", ms, outcome.summary, outcome.aiRunId ?? null);
      summary.done++;
    } else if (outcome.status === "skipped") {
      await opts.sb.rpc("finish_ai_job", {
        server_secret: opts.secret,
        p_job_id: job.id,
        p_status: "skipped",
        p_error: outcome.error,
        p_retry_after_sec: 60,
      });
      await logBrainEvent(opts.sb, opts.secret, job, "skipped", ms, outcome.error, outcome.aiRunId ?? null);
      summary.skipped++;
    } else {
      const willExhaust = job.attempts >= job.max_attempts;
      await opts.sb.rpc("finish_ai_job", {
        server_secret: opts.secret,
        p_job_id: job.id,
        p_status: "retry",
        p_error: outcome.error,
        p_retry_after_sec: outcome.retryAfterSec ?? 60,
      });
      await logBrainEvent(opts.sb, opts.secret, job, "error", ms, outcome.error, outcome.aiRunId ?? null);
      if (willExhaust) summary.error++;
      else summary.retried++;
    }
  }));

  return summary;
}
