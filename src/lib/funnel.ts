// Funnel Bot & Daily Summary Engine (Phase 4D, 19 Nov 2026).
// Pure helper functions and types shared by Autopilot, the Bot Room, and Kestrel AI chat.

export type FunnelSummary = {
  unreviewed: number;
  stuck_review: number;
  needs_email: number;
  needs_write: number;
  held_qc: number;
  ready_send: number;
  in_outreach: number;
  replied: number;
  meetings: number;
  won: number;
  won_value: number;
  lost: number;
  campaigns_running: number;
  campaigns_paused: number;
  sent_today: number;
  replies_today: number;
  last_report_at?: string | null;
};

const s = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// Formats a concise, human-readable report string for the Funnel bot in the Bot Room.
export function formatFunnelReport(summary: FunnelSummary, isDaily = true): string {
  const parts: string[] = [];
  const prefix = isDaily ? "Daily funnel report: " : "Funnel report: ";

  parts.push(`${s(summary.sent_today, "email")} sent today`);
  parts.push(`${s(summary.replied, "total reply", "total replies")}`);
  parts.push(`${s(summary.meetings, "meeting")}`);

  if (summary.won > 0) {
    const valStr = summary.won_value > 0 ? ` ($${summary.won_value.toLocaleString()})` : "";
    parts.push(`${s(summary.won, "deal")} won${valStr}`);
  }

  let text = `${prefix}${parts.join(", ")}. `;

  if (summary.ready_send > 0) {
    text += `${s(summary.ready_send, "lead")} ready to send. `;
  }

  if (summary.held_qc > 0) {
    text += `${s(summary.held_qc, "email")} held by QC. `;
  }

  if (summary.stuck_review > 0) {
    text += `${s(summary.stuck_review, "lead")} waiting in To review for 3+ days. `;
  }

  text += "@you";
  return text;
}

// Generates the top 3 actionable next steps for the user based on where leads are in the pipeline.
export function funnelNextSteps(summary: FunnelSummary): string[] {
  const steps: string[] = [];

  if (summary.held_qc > 0) {
    steps.push(`Approve ${s(summary.held_qc, "email")} held by the QC bot in the Bot room`);
  }
  if (summary.ready_send > 0) {
    steps.push(`Add ${s(summary.ready_send, "lead")} ready to send to an active campaign`);
  }
  if (summary.needs_write > 0) {
    steps.push(`Write emails for ${s(summary.needs_write, "good lead")} in Kestrel AI → Score and write`);
  }
  if (summary.needs_email > 0) {
    steps.push(`Find emails for ${s(summary.needs_email, "lead")} in Connections / Leads`);
  }
  if (summary.stuck_review > 0) {
    steps.push(`Review ${s(summary.stuck_review, "stuck lead")} waiting over 3 days in To review`);
  }
  if (summary.replied > 0) {
    steps.push(`Check ${s(summary.replied, "reply", "replies")} in Replies to book meetings or mark outcomes`);
  }
  if (summary.campaigns_running === 0 && summary.ready_send > 0) {
    steps.push("Start a campaign to begin sending your ready leads");
  }

  if (!steps.length) {
    steps.push("Search for fresh leads in the Kestrel extension to feed your pipeline");
  }

  return steps.slice(0, 3);
}

// Detects potential pipeline bottlenecks.
export function funnelBottlenecks(summary: FunnelSummary): string[] {
  const bottlenecks: string[] = [];

  if (summary.stuck_review > 10) {
    bottlenecks.push(`${summary.stuck_review} leads are waiting in To review for 3+ days`);
  }
  if (summary.held_qc > 0) {
    bottlenecks.push(`${summary.held_qc} emails are paused awaiting QC approval`);
  }
  if (summary.ready_send > 20 && summary.campaigns_running === 0) {
    bottlenecks.push(`${summary.ready_send} leads are ready to send but no campaign is running`);
  }
  if (summary.needs_email > 20) {
    bottlenecks.push(`${summary.needs_email} good leads need email enrichment`);
  }

  return bottlenecks;
}
