import { aiOne, aiPlan, writeChecked, type AiPlan, type LeadIn } from "./lead-steps";
import { cleanAbout, aboutForAi } from "./about";
import { dncBlocks, dncIndex } from "./dnc";
import type { Offer } from "./ai";

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
};

type JobContextPayload = {
  lead: (LeadIn & { website?: string | null; team_id?: string }) | null;
  offer: Offer | null;
  sequence: unknown;
  settings: Record<string, unknown> | null;
  about: Record<string, unknown> | null;
  team_plan: { plan?: string | null; paid_until?: string | null; access_until?: string | null; access_plan?: string | null } | null;
  key: string | null;
  dnc_too_long?: boolean;
  dnc?: string[];
};

const NODE_MAP: Record<AiJobKind, { agent: string; from: string }> = {
  find_emails: { agent: "merge", from: "new" },
  research: { agent: "read", from: "sig" },
  score: { agent: "score", from: "quote" },
  write: { agent: "write", from: "angle" },
  qc: { agent: "qc", from: "write" },
};

const PERMANENT_RE = /PLAN_NEEDED|monthly_allowance_reached|allowance_check_failed|used up|401|403|rejected|do not contact|no email|no usable website|Needs human review|No offer|Research this lead first/i;

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
 * Never uses anon `.from()` table queries — reads & saves strictly via security definer RPCs
 * gated by `mail_server_ok(server_secret)` and scoped to `job.team_id`.
 */
export async function executeClaimedJob(
  sb: RpcLike,
  job: ClaimedAiJob,
  deadlineMs: number,
  secret = "",
  providerFn?: AiPlan["providerFn"]
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

  const { data: ctxRaw, error: ctxErr } = await sb.rpc("ai_job_context", {
    server_secret: secret,
    p_team_id: job.team_id,
    p_lead_id: job.lead_id,
    p_offer_id: job.offer_id,
    p_sequence_id: job.sequence_id,
  });
  if (ctxErr) return { status: "retry", error: ctxErr.message || "Could not load job context", retryAfterSec: 60 };
  const ctx = (ctxRaw ?? null) as JobContextPayload | null;
  if (!ctx) return { status: "skipped", error: "Team is not active" };

  const lead = ctx.lead;
  if (!lead) return { status: "skipped", error: "Lead not found" };
  if (!ctx.offer) return { status: "skipped", error: "No offer profile configured" };
  if (ctx.dnc_too_long) return { status: "skipped", error: "Do-not-contact list too large" };

  const dnc = dncIndex((ctx.dnc ?? []).map((entry) => ({ entry })));
  if (
    task !== "score" &&
    dncBlocks(
      {
        email: lead.email,
        emails: (lead.data as { emails?: string[] } | null)?.emails,
        website: lead.website ?? (lead.data as { website?: string } | null)?.website,
      },
      dnc
    )
  ) {
    return { status: "skipped", error: "do not contact" };
  }

  if (task === "emails" && !lead.outreach_approved && !(lead.data as Record<string, unknown> | null)?.outreach_approved) {
    return { status: "skipped", error: "Needs human review: approve opportunity report first" };
  }

  const cleanAb = ctx.about ? cleanAbout(ctx.about) : null;
  const settings: Record<string, unknown> | null = ctx.settings ? { ...ctx.settings, about: aboutForAi(cleanAb) } : null;
  const key = typeof ctx.key === "string" ? ctx.key : "";
  const seq = Array.isArray(ctx.sequence) ? { steps: ctx.sequence, ...(job.sequence_id ? { id: job.sequence_id } : {}) } : null;

  const rawPlan = aiPlan(task, ctx.offer, settings, key, seq, [], cleanAb?.voice_notes, cleanAb);
  if ("error" in rawPlan) return { status: "skipped", error: rawPlan.error };

  const serverTeamAi = {
    provider: typeof settings?.provider === "string" ? settings.provider : null,
    model: typeof settings?.model === "string" ? settings.model : null,
    key: key || null,
    plan: ctx.team_plan ?? null,
  };
  const plan = {
    ...rawPlan,
    sb: sb as never,
    teamId: job.team_id,
    userId: job.user_id,
    deadlineMs,
    ...(secret ? { serverSecret: secret, serverTeamAi } : {}),
    ...(providerFn ? { providerFn } : {}),
  };
  const qcRaw = task === "emails" ? aiPlan("qc", ctx.offer, settings, key, null, [], cleanAb?.voice_notes, cleanAb) : null;
  const qcPlan = qcRaw && !("error" in qcRaw)
    ? {
        ...qcRaw,
        sb: sb as never,
        teamId: job.team_id,
        userId: job.user_id,
        deadlineMs,
        ...(secret ? { serverSecret: secret, serverTeamAi } : {}),
        ...(providerFn ? { providerFn } : {}),
      }
    : null;

  const preparedLead: LeadIn =
    task === "research" && lead.website && !(lead.data as { website?: string } | null)?.website
      ? { ...lead, data: { ...(lead.data ?? {}), website: lead.website } }
      : lead;

  const res =
    task === "emails"
      ? await writeChecked(plan, qcPlan, preparedLead, dnc, 2, () => Date.now() < deadlineMs - 2_000)
      : await aiOne(plan, preparedLead, dnc);

  if (!res.ok) {
    const why = res.why || "AI job failed";
    return isPermanentJobError(why)
      ? { status: "skipped", error: why }
      : { status: "retry", error: why, retryAfterSec: 60 };
  }

  const qcStatus = (res.result as { qc?: { status?: string } } | undefined)?.qc?.status;
  const heldForReview = task === "emails" && qcStatus === "hold";
  const savePatch = heldForReview
    ? {
        ...res.patch,
        outreach_approved: false,
        data: { ...((res.patch.data as Record<string, unknown>) ?? {}), outreach_approved: false },
      }
    : res.patch;

  const { error: updErr } = await sb.rpc("ai_job_save_lead", {
    server_secret: secret,
    p_team_id: job.team_id,
    p_lead_id: lead.id,
    p_patch: savePatch,
  });
  if (updErr) return { status: "retry", error: updErr.message || "Could not save lead patch", retryAfterSec: 60 };

  return { status: "done", summary: heldForReview ? `${job.kind} completed (needs review)` : `${job.kind} completed` };
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
