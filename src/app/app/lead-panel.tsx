"use client";

import { askConfirm } from "@/components/dialog";
import { useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Tip } from "@/components/ui";
import { placeOf, searchNote, SOURCE_NAMES, type LeadRow } from "@/lib/leads";
import LeadTimeline from "./lead-timeline";
import { BizAvatar, Socials, siteOfEmail } from "./biz";
import { scoreEmail } from "@/lib/spamguard";
import { emailIssue, isChain, junkText, phoneIssue } from "@/lib/email-check";
import { IssueList, ScoreBadge } from "./spam-check";

// The lead panel: everything the extension collected about one business, like the extension's Workspace drawer.
// Change the AI verdict, keep or remove the lead, and copy its email draft.
type Full = Record<string, unknown> & {
  emails?: string[]; address?: string; description?: string; url?: string; keyword?: string; rating?: number; reviews?: number;
  socials?: Record<string, string>; contacts?: { name?: string; position?: string; role?: string; email?: string; linkedin?: string }[];
  hiring?: { jobs?: { title?: string; url?: string }[] };
  ai?: {
    verdict?: string;
    reason?: string;
    fit?: string | number;
    matched_service_id?: string;
    matched_service_name?: string;
    buying_trigger?: string;
  };
  verdict_log?: { from: string | null; to: string | null; at: string; by: string }[];
  research?: {
    problem?: string;
    how?: string;
    detail?: string;
    sure?: string;
    host?: string;
    at?: number;
    observations?: { fact: string; quote: string; url?: string }[];
    hypotheses?: string[];
    unknowns?: string[];
    dropped_observations?: { fact: string; quote: string; url?: string }[];
  };
  outreach_approved?: boolean;
  outreach_approved_at?: string;
  outreach?: { qc?: { status?: string; issues?: string[]; rounds?: number; fixed?: string[] }; firstName?: string; subject?: string; icebreaker?: string; question?: string; body?: string; steps?: { day: number; subject: string; body: string }[] };
};
export type Status = "new" | "kept" | "removed";

export default function LeadPanel({ lead, editable, demo, onClose, onChange, blocked, canBlock, onBlock, finding, onFind, onSkipCategory }: {
  lead: LeadRow; editable: boolean; demo: boolean; onClose: () => void; onChange: (patch: Partial<LeadRow>) => void;
  blocked: boolean; canBlock: boolean; onBlock: (entry: string) => void; finding: boolean; onFind: () => void; onSkipCategory?: (category: string, leadId: string) => void;
}) {
  const [full, setFull] = useState<Full | null>(null);
  const [copied, setCopied] = useState("");
  const [reading, setReading] = useState(""); // Research bot: "" idle, "busy", or what went wrong
  const [editingDraft, setEditingDraft] = useState(false);
  const [customSubject, setCustomSubject] = useState("");
  const [customBody, setCustomBody] = useState("");
  const [customSaving, setCustomSaving] = useState(false);
  const [draftWarn, setDraftWarn] = useState("");

  useEffect(() => {
    let live = true;
    if (demo) {
      const name = String(lead.name || "there").replace(/\s+(ltd|limited|llc|inc)\.?$/i, "");
      const d = {
        firstName: name,
        subject: `video edits at ${name.toLowerCase()}`,
        icebreaker: `Saw ${name} films client stories in ${lead.location || "your city"}.`,
        question: "Who edits those videos when your team gets busy?",
        body: `Hi ${name},\n\nSaw ${name} films client stories in ${lead.location || "your city"}.\n\nWho edits those videos when your team gets busy?`,
        steps: [{ day: 0, subject: `video edits at ${name.toLowerCase()}`, body: `Hi ${name},\n\nSaw ${name} films client stories in ${lead.location || "your city"}.\n\nWho edits those videos when your team gets busy?` }],
      };
      Promise.resolve().then(() => { if (live) setFull({ outreach: d }); });
      return () => { live = false; };
    }
    supabaseBrowser().from("leads").select("data").eq("id", lead.id).single()
      .then(({ data }) => { if (live) setFull(((data as { data?: Full } | null)?.data) ?? {}); });
    return () => { live = false; };
  }, [lead.id, lead.name, lead.location, demo]);

  // Keyboard: focus moves into the panel, Tab stays inside it, Escape closes it, and focus goes back to the lead row.
  const box = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; }, [onClose]);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    box.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { close.current(); return; }
      if (e.key !== "Tab" || !box.current) return;
      const items = [...box.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex='-1'])")];
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === box.current)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", key);
    return () => { window.removeEventListener("keydown", key); before?.focus?.(); };
  }, []);

  async function save(patch: Partial<LeadRow>) {
    onChange(patch);
    if (demo) return;
    const { error } = await supabaseBrowser().from("leads").update(patch).eq("id", lead.id);
    if (error) onChange({ ...lead });
  }
  // Phase 4B: the Research bot reads this lead's website now (the same step Autopilot runs before writing).
  async function research() {
    if (demo) {
      setFull((x) => ({
        ...(x ?? {}),
        research: {
          observations: [
            { fact: "They publish weekly client stories and video productions.", quote: "client stories and launch videos every week", url: "https://example.test" },
            { fact: "Produced a 6-part launch series for an outdoor apparel brand.", quote: "6-part launch series for an outdoor brand", url: "https://example.test" },
          ],
          hypotheses: [
            "Guess: Video post-production workload spikes around customer launches.",
            "Guess: Would benefit from dedicated overflow editing support.",
          ],
          unknowns: [
            "Internal video post-production team size",
            "Target turnaround speed requirements",
          ],
          problem: "They post new client launch videos every week, so editing likely piles up around launches.",
          how: "A steady outside editor could take the launch edits so their team keeps up.",
          detail: "Their latest case study is a 6-part launch series for an outdoor brand.",
          sure: "high",
          host: "example.test",
          at: Date.now(),
        },
      }));
      return;
    }
    setReading("busy");
    const r = await fetch("/api/ai", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ task: "research", ids: [lead.id], offerId: "current" }) })
      .then((x) => x.json()).catch(() => null) as { done?: { research?: Full["research"] }[]; skipped?: { why: string }[]; error?: string } | null;
    const got = r?.done?.[0]?.research;
    if (got) { setFull((x) => ({ ...(x ?? {}), research: got })); setReading(""); return; }
    setReading(r?.error || (r?.skipped?.[0]?.why ? `Could not research it: ${r.skipped[0].why}.` : "Could not research it just now. Try again in a minute."));
  }

  const [approving, setApproving] = useState(false);

  async function toggleApproveOutreach() {
    if (approving) return;
    setApproving(true);
    const nextApproved = !(lead.outreach_approved || full?.outreach_approved);
    const now = new Date().toISOString();
    if (demo) {
      setFull((x) => ({ ...(x ?? {}), outreach_approved: nextApproved, outreach_approved_at: now }));
      onChange({ outreach_approved: nextApproved, outreach_approved_at: now } as Partial<LeadRow>);
      setApproving(false);
      return;
    }
    const sb = supabaseBrowser();
    const { data: userData } = await sb.auth.getUser();
    const userId = userData.user?.id || null;
    const patch: Record<string, unknown> = {
      outreach_approved: nextApproved,
      outreach_approved_at: nextApproved ? now : null,
      outreach_approved_by: nextApproved ? userId : null,
    };
    let { error } = await sb.from("leads").update(patch).eq("id", lead.id);
    if (error && /column.*does not exist|schema cache/i.test(error.message)) {
      const curData = (full ?? {}) as Record<string, unknown>;
      const nextData = { ...curData, outreach_approved: nextApproved, outreach_approved_at: nextApproved ? now : null };
      const res2 = await sb.from("leads").update({ data: nextData }).eq("id", lead.id);
      error = res2.error;
    }
    setApproving(false);
    if (!error) {
      setFull((x) => ({ ...(x ?? {}), outreach_approved: nextApproved, outreach_approved_at: now }));
      onChange({ outreach_approved: nextApproved, outreach_approved_at: now } as Partial<LeadRow>);
    }
  }
  // Phase 4C: approve an email the QC bot held, so campaigns can send it (database 068 leaves held emails out).
  async function approveQc() {
    if (demo) { setFull((x) => (x?.outreach ? { ...x, outreach: { ...x.outreach, qc: { ...x.outreach.qc, status: "approved" } } } : x)); return; }
    const sb = supabaseBrowser();
    const { data } = await sb.from("leads").select("data").eq("id", lead.id).single();
    const cur = ((data as { data?: Full } | null)?.data) ?? {};
    if (!cur.outreach) return;
    const next = { ...cur, outreach: { ...cur.outreach, qc: { ...(cur.outreach.qc ?? {}), status: "approved", approved_at: Date.now() } } };
    const { error } = await sb.from("leads").update({ data: next }).eq("id", lead.id);
    if (!error) setFull(next);
  }

  function startEditDraft() {
    const d = full?.outreach;
    const first = d?.steps?.[0] ?? {
      subject: d?.subject ?? "",
      body: d?.body || [d?.icebreaker, d?.question].filter(Boolean).join("\n\n"),
    };
    setCustomSubject(first.subject || "");
    setCustomBody(first.body || "");
    setDraftWarn("");
    setEditingDraft(true);
  }

  async function saveCustomDraft() {
    if (customSaving) return;
    const subject = customSubject.trim();
    const body = customBody.trim();
    if (!subject && !body) {
      setDraftWarn("Draft subject or body cannot be completely empty.");
      return;
    }

    // Run rigorous QC + spam + link checks
    const sc = scoreEmail({ subject, body });
    if (sc.blocked || sc.issues.some((h) => h.level === "red")) {
      const redIssues = sc.issues.filter((h) => h.level === "red").map((h) => h.title).join(", ");
      setDraftWarn(`Blocked by spam check: ${redIssues}. Please fix the red items first.`);
      return;
    }

    setCustomSaving(true);
    setDraftWarn("");

    const qcIssues = sc.issues.map((h) => `${h.title}: ${h.fix}`);
    const qcStatus = sc.issues.some((h) => h.level === "orange") ? "hold" : "passed";

    if (demo) {
      setFull((cur) => {
        const outreach = cur?.outreach ?? { steps: [] };
        const steps = outreach.steps ? [...outreach.steps] : [];
        if (steps[0]) steps[0] = { ...steps[0], subject, body };
        else steps.push({ day: 0, subject, body });
        return {
          ...cur,
          outreach: {
            ...outreach,
            subject,
            body,
            steps,
            qc: {
              ...(outreach.qc ?? {}),
              status: qcStatus,
              issues: qcIssues,
              rounds: (outreach.qc?.rounds ?? 0) + 1,
            },
          },
        };
      });
      setEditingDraft(false);
      setCustomSaving(false);
      return;
    }

    const sb = supabaseBrowser();
    const { data } = await sb.from("leads").select("data").eq("id", lead.id).single();
    const cur = ((data as { data?: Full } | null)?.data) ?? {};
    const outreach = cur.outreach ?? { steps: [] };
    const steps = outreach.steps ? [...outreach.steps] : [];
    if (steps[0]) steps[0] = { ...steps[0], subject, body };
    else steps.push({ day: 0, subject, body });
    const next = {
      ...cur,
      outreach: {
        ...outreach,
        subject,
        body,
        steps,
        qc: {
          ...(outreach.qc ?? {}),
          status: qcStatus,
          issues: qcIssues,
          rounds: (outreach.qc?.rounds ?? 0) + 1,
        },
      },
    };
    const { error } = await sb.from("leads").update({ data: next }).eq("id", lead.id);
    setCustomSaving(false);
    if (!error) {
      setFull(next);
      setEditingDraft(false);
    } else {
      setDraftWarn(error.message || "Could not save custom draft.");
    }
  }

  const copy = async (label: string, text: string) => { await navigator.clipboard.writeText(text); setCopied(label); setTimeout(() => setCopied(""), 1800); };

  const f = full ?? {};
  const emails = [...new Set([lead.email, ...(f.emails ?? [])].filter(Boolean) as string[])];
  // Scraped data: only real web links (http/https) are shown as links, never javascript: or other schemes.
  const socials = Object.entries(f.socials ?? {}).filter(([, v]) => typeof v === "string" && /^https?:\/\/[^\s]+$/i.test(v));
  const draft = f.outreach;
  const draftText = draft ? [draft.subject ? `Subject: ${draft.subject}` : "", draft.body || [draft.icebreaker, draft.question].filter(Boolean).join("\n\n")].filter(Boolean).join("\n\n") : "";
  // Mail phase 2: follow-ups written with a sequence (the first step is the draft above).
  const followUps = (draft?.steps ?? []).slice(1).filter((x) => x && x.body);
  const status = (lead as LeadRow & { status?: Status }).status ?? "new";

  return (
    <div className="drawer-wrap" onClick={onClose}>
      <aside ref={box} tabIndex={-1} className="drawer" role="dialog" aria-modal="true" aria-label={`Lead: ${lead.name}`} onClick={(e) => e.stopPropagation()}>
        <header className="dr-head">
          <div className="dr-biz">
            <BizAvatar name={lead.name} website={lead.website || siteOfEmail(lead.email)} size={48} />
            <div>
              <h2>{lead.name}</h2>
              <p title={searchNote(lead) || undefined}>{[lead.category, placeOf(lead)].filter(Boolean).join(" · ")}</p>
              <Socials socials={f.socials ?? lead.socials} max={6} />
            </div>
          </div>
          <button type="button" className="dr-x" aria-label="Close" onClick={onClose}>×</button>
        </header>

        <section className="dr-block">
          <div className="dr-row"><span>Fit</span>
            <div className="seg">
              {(["Good", "Maybe", "No"] as const).map((v) => (
                <button key={v} type="button" className={lead.verdict === v ? `on ${v.toLowerCase()}` : ""} disabled={!editable} onClick={() => save({ verdict: lead.verdict === v ? null : v })}>{v}</button>
              ))}
            </div>
          </div>
          {lead.reason ? <p className="dr-reason">{lead.reason}</p> : null}
          {/* Opportunity Report Card (Stage C) */}
          {f.research || f.ai?.matched_service_name || lead.matched_service_id || f.ai?.buying_trigger || lead.buying_trigger ? (
            <div className="dr-opp-card" style={{ border: "1px solid var(--k-border, rgba(120,120,128,0.18))", borderRadius: "14px", padding: "12px", background: "var(--fill, rgba(120, 120, 128, .04))", margin: "10px 0 6px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px", flexWrap: "wrap", gap: "6px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <b style={{ fontSize: "13.5px" }}>Opportunity Report</b>
                  <span style={{ fontSize: "11px", padding: "1px 7px", borderRadius: 9999, background: "rgba(14, 165, 164, 0.12)", color: "#0EA5A4", fontWeight: 600 }}>
                    Stage C
                  </span>
                </div>
                {(lead.outreach_approved || f.outreach_approved) ? (
                  <span style={{ fontSize: "11.5px", padding: "2px 8px", borderRadius: 9999, background: "rgba(22, 163, 74, 0.12)", color: "#16A34A", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: "4px" }}>
                    Approved for outreach ✓
                  </span>
                ) : (
                  <span style={{ fontSize: "11.5px", padding: "2px 8px", borderRadius: 9999, background: "rgba(217, 119, 6, 0.12)", color: "#D97706", fontWeight: 600 }}>
                    Approval required
                  </span>
                )}
              </div>

              {/* Matched Service, Buying Trigger, and Fit */}
              <div style={{ display: "grid", gap: "6px", background: "var(--k-surface, rgba(120, 120, 128, .06))", padding: "8px 10px", borderRadius: "10px", marginBottom: "8px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                  <span style={{ fontSize: "12px", color: "var(--label2, #8A8A8A)" }}>Service Fit:</span>
                  <b style={{ fontSize: "13px", color: (f.ai?.matched_service_name || lead.matched_service_id) ? "#8B5CF6" : "inherit" }}>
                    {f.ai?.matched_service_name || (lead.matched_service_id ? "Active Service" : "None")}
                  </b>
                  {lead.verdict ? (
                    <span className={`seg-pill ${lead.verdict.toLowerCase()}`} style={{ fontSize: "11px", padding: "1px 8px", borderRadius: 9999, fontWeight: 600 }}>
                      {lead.verdict} ({lead.score ?? f.ai?.fit ?? "—"})
                    </span>
                  ) : null}
                </div>
                {(f.ai?.buying_trigger || lead.buying_trigger) ? (
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                    <span style={{ fontSize: "12px", color: "var(--label2, #8A8A8A)" }}>Buying Trigger:</span>
                    <span style={{ fontSize: "12px", fontWeight: 600, color: "#0EA5A4", background: "rgba(14, 165, 164, 0.1)", padding: "1px 8px", borderRadius: 9999 }}>
                      ⚡ {f.ai?.buying_trigger || lead.buying_trigger}
                    </span>
                  </div>
                ) : null}
              </div>

              {/* Observations with verbatim quotes */}
              {f.research?.observations && f.research.observations.length > 0 ? (
                <div style={{ marginBottom: "8px" }}>
                  <p style={{ margin: "0 0 5px", fontSize: "11.5px", fontWeight: 600, color: "var(--label2, #8A8A8A)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                    Verified Observations ({f.research.observations.length})
                  </p>
                  <div style={{ display: "grid", gap: "5px" }}>
                    {f.research.observations.map((obs, i) => (
                      <div key={i} style={{ border: "1px solid var(--k-border, rgba(120,120,128,0.15))", borderRadius: "8px", padding: "6px 8px", background: "var(--k-surface, #fff)" }}>
                        <div style={{ fontSize: "12.5px", fontWeight: 500, marginBottom: "3px" }}>• {obs.fact}</div>
                        <blockquote style={{ margin: 0, padding: "3px 6px", borderLeft: "2px solid #0EA5A4", background: "rgba(14, 165, 164, 0.05)", fontSize: "11.5px", fontStyle: "italic", color: "var(--label2, #666)" }}>
                          &ldquo;{obs.quote}&rdquo;
                        </blockquote>
                      </div>
                    ))}
                  </div>
                </div>
              ) : f.research?.problem ? (
                <div style={{ marginBottom: "8px" }}>
                  <p style={{ margin: "0 0 4px", fontSize: "11.5px", fontWeight: 600, color: "var(--label2, #8A8A8A)", textTransform: "uppercase" }}>
                    Website Research
                  </p>
                  <div style={{ fontSize: "12.5px", lineHeight: "1.4" }}>
                    <div><b>Problem:</b> {f.research.problem}</div>
                    <div style={{ marginTop: "2px" }}><b>How you help:</b> {f.research.how}</div>
                    {f.research.detail ? <div style={{ marginTop: "2px" }}><b>Detail:</b> {f.research.detail}</div> : null}
                  </div>
                </div>
              ) : null}

              {/* Hypotheses */}
              {f.research?.hypotheses && f.research.hypotheses.length > 0 ? (
                <div style={{ marginBottom: "8px" }}>
                  <p style={{ margin: "0 0 4px", fontSize: "11.5px", fontWeight: 600, color: "var(--label2, #8A8A8A)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                    Hypotheses
                  </p>
                  <ul style={{ margin: 0, paddingLeft: "16px", fontSize: "12px", display: "grid", gap: "3px" }}>
                    {f.research.hypotheses.map((h, i) => (
                      <li key={i} style={{ lineHeight: "1.35" }}>
                        <span style={{ fontSize: "10.5px", fontWeight: 600, color: "#8B5CF6", marginRight: "3px" }}>[Guess]</span>
                        {h.replace(/^Guess:\s*/i, "")}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {/* Unknowns */}
              {f.research?.unknowns && f.research.unknowns.length > 0 ? (
                <div style={{ marginBottom: "8px" }}>
                  <p style={{ margin: "0 0 4px", fontSize: "11.5px", fontWeight: 600, color: "var(--label2, #8A8A8A)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                    Unknowns
                  </p>
                  <ul style={{ margin: 0, paddingLeft: "16px", fontSize: "11.5px", color: "var(--label2, #8A8A8A)", display: "grid", gap: "2px" }}>
                    {f.research.unknowns.map((u, i) => (
                      <li key={i}>{u}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {/* Human Approval Action */}
              {editable ? (
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "10px", paddingTop: "8px", borderTop: "1px solid var(--k-border, rgba(120,120,128,0.15))" }}>
                  {!(lead.outreach_approved || f.outreach_approved) ? (
                    <button
                      type="button"
                      className="btn go small"
                      style={{ borderRadius: 9999 }}
                      disabled={approving}
                      onClick={toggleApproveOutreach}
                    >
                      {approving ? "Approving…" : "Approve for Outreach"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn glass small"
                      style={{ borderRadius: 9999, color: "var(--label2, #8A8A8A)" }}
                      disabled={approving}
                      onClick={toggleApproveOutreach}
                    >
                      {approving ? "Revoking…" : "Revoke approval"}
                    </button>
                  )}
                  {editable ? (
                    <button type="button" className="link-btn" disabled={reading === "busy"} onClick={research}>
                      {reading === "busy" ? "Reading website…" : "Re-read website"}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : editable && (lead.website || (f as { website?: string }).website) ? (
            <p className="dr-research-go">
              <button type="button" className="btn small glass" style={{ borderRadius: 9999 }} disabled={reading === "busy"} onClick={research}>
                {reading === "busy" ? "Reading their website…" : "Research their website"}
              </button>
              <Tip text="The Research bot reads this lead's own website and extracts verified observations, hypotheses, unknowns, and buying triggers. Uses your team's AI." />
            </p>
          ) : null}
          {reading && reading !== "busy" ? <p className="dr-muted" role="status">{reading}</p> : null}
          {(f.verdict_log ?? []).length > 1 ? <details className="dr-log"><summary>Verdict changed {(f.verdict_log ?? []).length - 1} {(f.verdict_log ?? []).length === 2 ? "time" : "times"}</summary>
            <ul>{[...(f.verdict_log ?? [])].reverse().map((v, i) => <li key={i}>{v.from ?? "Not judged"} → <b>{v.to ?? "Not judged"}</b> · {v.by === "by hand" ? "by hand" : v.by === "agent" ? "Claude Code / Codex" : v.by} · {new Date(v.at).toLocaleDateString()}</li>)}</ul></details> : null}
          <div className="dr-facts">
            {f.rating ? <div><small>Rating</small><b>{f.rating}{f.reviews ? ` (${f.reviews})` : ""}</b></div> : null}
            <div><small>Source</small><b>{SOURCE_NAMES[lead.source ?? ""] ?? lead.source ?? "—"}</b></div>
          </div>
          <div className="dr-actions">
            {status === "removed"
              ? <button type="button" className="btn small glass" disabled={!editable} onClick={() => save({ status: "new" } as Partial<LeadRow>)}>Restore</button>
              : <>
                  <button type="button" className={`btn small ${status === "kept" ? "go" : "glass"}`} disabled={!editable} onClick={() => save({ status: status === "kept" ? "new" : "kept" } as Partial<LeadRow>)}>{status === "kept" ? "Kept" : "Keep"}</button>
                  <button type="button" className="btn small glass" disabled={!editable} onClick={() => save({ status: "removed" } as Partial<LeadRow>)}>Remove</button>
                </>}
            {!blocked ? <button type="button" className="btn small glass" disabled={!canBlock || (!lead.email && !lead.website)}
              onClick={async () => { const entry = lead.email || lead.website || ""; if (await askConfirm(`Add ${entry.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")} to your team's Do-not-contact list? This lead is then never exported or emailed.`)) onBlock(entry); }}>Do not contact</button> : null}
          </div>
          {onSkipCategory && lead.category ? <p className="dr-muted"><button type="button" className="link-btn" onClick={() => onSkipCategory(lead.category!, lead.id)}>Not my kind of business: skip “{lead.category}” from now on</button></p> : null}
          {blocked ? <p className="dr-dnc" role="status">On your team&apos;s Do-not-contact list. Never exported or emailed.</p> : null}
          {isChain(lead.name) ? <p className="dr-muted">This looks like a big chain or franchise: they rarely buy from small agencies.</p> : null}
        </section>

        <section className="dr-block">
          <h3>Contact</h3>
          {emails.map((e) => { const iss = emailIssue(e, lead.website); return <div className="dr-line" key={e}><span>Email</span><a href={`mailto:${e}`}>{e}</a>{iss ? <small className={iss.level === "bad" ? "dlv-bad" : "dr-muted"}> {iss.reason}{iss.level === "bad" ? ": left out of campaigns" : ""}</small> : null}</div>; })}
          {lead.phone ? <div className="dr-line"><span>Phone</span><a href={`tel:${lead.phone}`}>{lead.phone}</a>{phoneIssue(lead.phone) ? <small className="dlv-bad"> {phoneIssue(lead.phone)}</small> : null}</div> : null}
          {lead.website ? <div className="dr-line"><span>Website</span><a href={lead.website} target="_blank" rel="noreferrer">{lead.website.replace(/^https?:\/\/(www\.)?/, "")}</a></div> : null}
          {f.address ? <div className="dr-line"><span>Address</span><b>{f.address}</b></div> : null}
          {socials.map(([k, v]) => <div className="dr-line" key={k}><span className="cap">{k}</span><a href={v} target="_blank" rel="noreferrer">{v.replace(/^https?:\/\/(www\.)?/, "")}</a></div>)}
          {!emails.length && !lead.phone && !lead.website && !f.address ? <p className="dr-muted">No contact details yet.</p> : null}
          {!emails.length && !blocked && (lead.website || lead.name) ? <button type="button" className="btn small glass dr-find" disabled={!editable || finding} onClick={onFind}>{finding ? "Finding…" : "Find email with Hunter"}</button> : null}
        </section>

        {f.contacts?.length ? (
          <section className="dr-block">
            <h3>People</h3>
            {f.contacts.map((c, i) => <div className="dr-line" key={i}><span>{c.position || c.role || "Contact"}</span><b>{c.name}{c.email ? ` · ${c.email}` : ""}</b></div>)}
          </section>
        ) : null}

        {f.hiring?.jobs?.length ? (
          <section className="dr-block">
            <h3>Hiring now</h3>
            {f.hiring.jobs.map((j, i) => <div className="dr-line" key={i}><span>Job</span>{j.url ? <a href={j.url} target="_blank" rel="noreferrer">{j.title}</a> : <b>{j.title}</b>}</div>)}
          </section>
        ) : null}

        <section className="dr-block">
          <h3>Email history</h3>
          <LeadTimeline leadId={lead.id} demo={demo} />
        </section>

        <section className="dr-block">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
            <h3 style={{ margin: 0 }}>Email draft</h3>
            {!(lead.outreach_approved || f.outreach_approved) ? (
              <span style={{ fontSize: "11px", padding: "1px 8px", borderRadius: 9999, background: "rgba(217, 119, 6, 0.12)", color: "#D97706", fontWeight: 500 }}>
                Approval required to write/send
              </span>
            ) : null}
          </div>
          {draftText && blocked ? <p className="dr-muted">This lead is on your Do-not-contact list, so its draft is hidden.</p> : editingDraft ? (
            <div className="dr-custom-draft" style={{ display: "grid", gap: "10px", margin: "12px 0" }}>
              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "4px" }}>Subject</label>
                <input
                  type="text"
                  value={customSubject}
                  onChange={(e) => { setCustomSubject(e.target.value); setDraftWarn(""); }}
                  placeholder="Email subject..."
                  aria-label="Email subject"
                  style={{ width: "100%", padding: "8px 12px", borderRadius: "10px", border: "1px solid var(--k-border, #E5E3DC)", background: "var(--k-surface, #fff)" }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "4px" }}>Body</label>
                <textarea
                  rows={8}
                  value={customBody}
                  onChange={(e) => { setCustomBody(e.target.value); setDraftWarn(""); }}
                  placeholder="Email body..."
                  aria-label="Email body"
                  style={{ width: "100%", padding: "8px 12px", borderRadius: "10px", border: "1px solid var(--k-border, #E5E3DC)", background: "var(--k-surface, #fff)", resize: "vertical", fontFamily: "inherit", fontSize: "13.5px" }}
                />
              </div>

              {(() => {
                const sc = scoreEmail({ subject: customSubject, body: customBody });
                return (
                  <div className="sg-step" style={{ margin: "4px 0" }}>
                    <div className="sg-head">
                      <ScoreBadge score={sc} />
                      <div>
                        <b>Spam score: Grade {sc.grade} ({sc.score} pts)</b>
                        <small>{sc.blocked ? "Red items block saving" : sc.grade === "A" ? "Ready to save" : "Contains warnings"}</small>
                      </div>
                    </div>
                    <IssueList score={sc} limit={4} />
                  </div>
                );
              })()}

              {draftWarn ? (
                <p className="dr-reason" role="alert" style={{ color: "var(--k-danger, #DC2626)", margin: "4px 0", fontSize: "13px", fontWeight: 500 }}>
                  {draftWarn}
                </p>
              ) : null}

              <div style={{ display: "flex", gap: "8px", marginTop: "4px" }}>
                <button
                  type="button"
                  className="btn go small"
                  style={{ borderRadius: 9999 }}
                  disabled={customSaving}
                  onClick={saveCustomDraft}
                >
                  {customSaving ? "Saving…" : "Save draft"}
                </button>
                <button
                  type="button"
                  className="btn glass small"
                  style={{ borderRadius: 9999 }}
                  onClick={() => { setEditingDraft(false); setDraftWarn(""); }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : draftText ? (
            <>
              {draft?.qc?.status === "hold" ? (
                <div className="dr-qc hold" role="status"><b>Held by the QC bot</b><span>Campaigns leave this email out until you approve it or write it again.</span>
                  {draft.qc.issues?.length ? <ul>{draft.qc.issues.map((x, i) => <li key={i}>{x}</li>)}</ul> : null}
                  {editable ? <button type="button" className="btn small go" onClick={approveQc}>It&apos;s fine, approve it</button> : null}</div>
              ) : draft?.qc?.status === "passed" || draft?.qc?.status === "approved" ? (
                <p className="dr-qc ok"><b>{draft.qc.status === "approved" ? "Approved by you" : "Checked by the QC bot ✓"}</b>{draft.qc.rounds ? <span> after {draft.qc.rounds} fix{draft.qc.rounds === 1 ? "" : "es"}</span> : null}</p>
              ) : null}
              <pre className="dr-draft">{draftText}</pre>
              {(() => { const first = draft?.steps?.[0] ?? { subject: draft?.subject ?? "", body: draft?.body ?? "" }; const sc = scoreEmail({ subject: first.subject, body: first.body });
                return <div className="sg-step"><div className="sg-head"><ScoreBadge score={sc} /><div><b>Spam score</b><small>{sc.blocked ? "Fix the red items before a campaign sends it" : sc.grade === "A" ? "Ready to send" : "Can be better"}</small></div>
                  <button type="button" className="link-btn" onClick={() => window.dispatchEvent(new CustomEvent("kestrel-spam-check", { detail: { subject: first.subject, body: first.body, mode: "email" } }))}>Open in Spam check</button></div>
                  <IssueList score={sc} limit={3} /></div>; })()}
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", margin: "8px 0" }}>
                <button type="button" className="btn small go" style={{ borderRadius: 9999 }} onClick={() => copy("draft", draftText)}>{copied === "draft" ? "Copied" : "Copy draft"}</button>
                {editable ? (
                  <button type="button" className="btn small glass" style={{ borderRadius: 9999 }} onClick={startEditDraft}>
                    Edit draft
                  </button>
                ) : null}
              </div>
              {followUps.map((x, i) => {
                const text = [x.subject ? `Subject: ${x.subject}` : "", x.body].filter(Boolean).join("\n\n");
                return (
                  <div key={i} className="dr-fu">
                    <h4>Follow-up {i + 1} · day {x.day}, if no reply</h4>
                    <pre className="dr-draft">{text}</pre>
                    <button type="button" className="btn small glass" onClick={() => copy(`fu${i}`, text)}>{copied === `fu${i}` ? "Copied" : `Copy follow-up ${i + 1}`}</button>
                  </div>
                );
              })}
            </>
          ) : (
            <div>
              <p className="dr-muted">No draft yet. Write one in AI → Write emails (or in the extension), and it appears here.</p>
              {editable ? (
                <button type="button" className="btn small glass" style={{ borderRadius: 9999, marginTop: 8 }} onClick={startEditDraft}>
                  Write custom draft
                </button>
              ) : null}
            </div>
          )}
        </section>

        {f.description || f.keyword || f.url ? (
          <section className="dr-block">
            <h3>More</h3>
            {f.description ? (junkText(f.description) ? <p className="dr-muted">No usable description (the page gave “{f.description.slice(0, 40)}”).</p> : <p className="dr-desc">{f.description}</p>) : null}
            {f.keyword ? <div className="dr-line"><span>Keyword</span><b>{f.keyword}</b></div> : null}
            {f.url ? <div className="dr-line"><span>Profile</span><a href={f.url} target="_blank" rel="noreferrer">Open</a></div> : null}
          </section>
        ) : null}
      </aside>
    </div>
  );
}
