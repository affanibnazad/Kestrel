"use client";

import { useCallback, useEffect, useState } from "react";

type HealthData = {
  funnel: {
    teams: number;
    withLeads: number;
    withMailbox: number;
    sentEmails: number;
    gotReplies: number;
    paying: number;
  };
  ai: {
    runs24h: number;
    ok24h: number;
    errors24h: number;
    cost24h: number;
    runs30d: number;
    cost30d: number;
    recentErrors: {
      id: number;
      task: string;
      slot: string | null;
      source: string;
      status: string;
      error: string | null;
      created_at: string;
    }[];
  };
  jobs: Record<"queued" | "running" | "done" | "error" | "skipped", number> | null;
};

const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : "0%");

export default function OwnerHealth({ demo }: { demo?: boolean }) {
  const [data, setData] = useState<HealthData | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (demo) {
      setLoading(false);
      setErr("Live health metrics require an admin session.");
      return;
    }
    setLoading(true);
    setErr("");
    try {
      const res = await fetch("/api/owner/health");
      const json = await res.json().catch(() => null);
      if (!res.ok || !json) {
        setErr(json?.error || "Could not load health metrics.");
        setData(null);
      } else {
        setData(json as HealthData);
      }
    } catch {
      setErr("Could not reach health endpoint.");
    } finally {
      setLoading(false);
    }
  }, [demo]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <p className="sub">Loading funnel &amp; system health…</p>;
  if (err) return <p className="plan-msg">{err}</p>;
  if (!data) return null;

  const { funnel, ai, jobs } = data;
  const funnelSteps: [string, number, string][] = [
    ["1. Signed up", funnel.teams, "Total teams"],
    ["2. Collected leads", funnel.withLeads, pct(funnel.withLeads, funnel.teams)],
    ["3. Connected mailbox", funnel.withMailbox, pct(funnel.withMailbox, funnel.teams)],
    ["4. Sent emails (30d)", funnel.sentEmails, pct(funnel.sentEmails, funnel.teams)],
    ["5. Got replies (30d)", funnel.gotReplies, pct(funnel.gotReplies, funnel.teams)],
    ["6. Paying", funnel.paying, pct(funnel.paying, funnel.teams)],
  ];

  return (
    <div style={{ display: "grid", gap: "20px", marginTop: "12px" }}>
      <section>
        <h3 style={{ margin: "0 0 10px", fontSize: "14px", fontWeight: 600 }}>Growth Funnel (Teams)</h3>
        <div className="owner-tiles">
          {funnelSteps.map(([label, val, sub]) => (
            <div className="owner-tile" key={label}>
              <small>{label}</small>
              <b>{val}</b>
              <span>{sub}</span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 style={{ margin: "0 0 10px", fontSize: "14px", fontWeight: 600 }}>AI Cost &amp; Reliability</h3>
        <div className="owner-tiles">
          <div className="owner-tile">
            <small>AI Runs (24h)</small>
            <b>{ai.runs24h}</b>
            <span>{ai.ok24h} ok · {ai.errors24h} errors</span>
          </div>
          <div className="owner-tile">
            <small>AI Cost (24h)</small>
            <b>${ai.cost24h.toFixed(4)}</b>
            <span>All providers</span>
          </div>
          <div className="owner-tile">
            <small>AI Cost (30d)</small>
            <b>${ai.cost30d.toFixed(4)}</b>
            <span>{ai.runs30d} runs (capped 1,000)</span>
          </div>
          <div className="owner-tile">
            <small>Background Queue (079)</small>
            <b>{jobs ? `${jobs.queued} queued` : "Not enabled"}</b>
            <span>
              {jobs
                ? `${jobs.running} running · ${jobs.done} done · ${jobs.error} error`
                : "Run 079_lead_brain.sql"}
            </span>
          </div>
        </div>
      </section>

      <section>
        <h3 style={{ margin: "0 0 10px", fontSize: "14px", fontWeight: 600 }}>Recent AI Failures (30d)</h3>
        {ai.recentErrors.length === 0 ? (
          <p className="sub">No AI errors or timeouts in the last 30 days.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Task</th>
                  <th>Slot</th>
                  <th>Source</th>
                  <th>Status</th>
                  <th>Error</th>
                </tr>
              </thead>
              <tbody>
                {ai.recentErrors.map((e) => (
                  <tr key={e.id}>
                    <td>{new Date(e.created_at).toLocaleString()}</td>
                    <td>{e.task}</td>
                    <td>{e.slot ?? "—"}</td>
                    <td>{e.source}</td>
                    <td><span className="tag bad">{e.status}</span></td>
                    <td>{e.error ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
