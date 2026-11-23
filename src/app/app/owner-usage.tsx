"use client";

import { askConfirm } from "@/components/dialog";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Tip } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/client";

// Owner → Usage (Kestrel admins, database 050). How every company uses Kestrel and who breaks the rules:
// searches, leads, sending (bounces, unsubscribes, spam complaints, emails to Do-not-contact), AI use, and flags.
// Open a team to see its searches (keyword and place), leads by day and source, sending by day, email accounts,
// members and lock history. Lock makes the team read-only (no sending, no AI, no extension) and shows them the reason.
// Never shows email text, passwords or keys.
type Flag = { level: "red" | "amber"; text: string };
type Team = {
  id: string; name: string; owner: string | null; state: string; plan: string; locked_at: string | null; locked_reason: string | null; created_at: string;
  people: number; seen: string | null; searches: number; leads_new: number; leads_total: number; leads_top_day: number; sent: number; bounced: number;
  unsubs: number; paused: number; replies: number; complaints: number; dnc_sent: number; ai_messages: number; mailboxes: number; last_active: string | null; flags: Flag[];
};
type Detail = {
  searches: { key: string; status: string; found: number | null; saved: number | null; at: string; who: string | null }[];
  leads_by_day: { day: string; n: number }[]; leads_by_source: { source: string; n: number }[];
  mail_by_day: { day: string; sent: number; bounced: number; unsubs: number }[];
  mailboxes: { email: string; status: string; note: string | null }[];
  members: { email: string; role: string; joined_at: string; seen: string | null }[];
  actions: { action: string; reason: string | null; at: string; by: string | null }[];
};
const MODES: Record<string, string> = { maps: "Google Maps", search: "Google Search", osm: "OpenStreetMap", companies: "Companies House", youtube: "YouTube" };
const day = (s: string | null) => (s ? new Date(s).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "—");
const pct = (a: number, b: number) => (b ? `${Math.round((a * 1000) / b) / 10}%` : "—");
const NEEDS = /admin_usage|admin_team_usage|admin_lock_team|schema cache/i;


export default function OwnerUsage({ toast }: { toast: (t: string) => void }) {
  const [days, setDays] = useState(30);
  const [rows, setRows] = useState<Team[] | null>(null);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [only, setOnly] = useState<"all" | "flagged" | "locked">("all");
  const [open, setOpen] = useState<Team | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    try {
      const { data, error } = await supabaseBrowser().rpc("admin_usage", { days });
      if (error) {
        setErr(error.message || "You don't have access.");
        setRows([]);
        return;
      }
      setErr(""); setRows((data as Team[] | null) ?? []);
    } catch (err: unknown) {
      setErr(err instanceof Error ? err.message : "You don't have access.");
      setRows([]);
    }
  }, [days]);
  useEffect(() => { Promise.resolve().then(load); }, [load]);

  async function openTeam(t: Team) {
    setOpen(t); setDetail(null); setReason("");
    const { data, error } = await supabaseBrowser().rpc("admin_team_usage", { t: t.id, days });
    if (error) { toast(error.message); return; }
    setDetail(data as Detail);
  }
  async function lock(t: Team) {
    if (!await askConfirm(`Lock ${t.name}? The team becomes read-only at once: no sending, no AI, no extension. They see your reason.`)) return;
    const { error } = await supabaseBrowser().rpc("admin_lock_team", { t: t.id, reason });
    if (error) { toast(NEEDS.test(error.message) ? "Locking needs database 050." : error.message); return; }
    toast(`${t.name} is locked.`); setOpen(null); load();
  }
  async function unlock(t: Team) {
    const { error } = await supabaseBrowser().rpc("admin_unlock_team", { t: t.id });
    if (error) { toast(error.message); return; }
    toast(`${t.name} is unlocked.`); setOpen(null); load();
  }

  const list = useMemo(() => (rows ?? []).filter((r) =>
    (only === "all" || (only === "flagged" ? r.flags.length > 0 : Boolean(r.locked_at)))
    && (!q || `${r.name} ${r.owner ?? ""}`.toLowerCase().includes(q.trim().toLowerCase()))), [rows, only, q]);
  const flagged = (rows ?? []).filter((r) => r.flags.length).length;
  const red = (rows ?? []).filter((r) => r.flags.some((f) => f.level === "red")).length;

  if (err) return <p className="plan-msg">{err}</p>;
  return (
    <>
      <div className="kpis owner-kpis">
        <div><small>Teams</small><b>{(rows?.length ?? 0).toLocaleString()}</b></div>
        <div><small>With a flag</small><b>{flagged}</b><i className="kpi-note">{red} red</i></div>
        <div><small>Locked</small><b>{(rows ?? []).filter((r) => r.locked_at).length}</b></div>
        <div><small>Emails sent</small><b>{(rows ?? []).reduce((n, r) => n + r.sent, 0).toLocaleString()}</b><i className="kpi-note">last {days} days</i></div>
      </div>
      <div className="acct-bar">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search team or owner email" aria-label="Search teams" />
        <div className="seg" role="group" aria-label="Show">{([["all", "All"], ["flagged", "Flagged"], ["locked", "Locked"]] as const).map(([id, l]) =>
          <button key={id} type="button" className={only === id ? "on" : ""} aria-pressed={only === id} onClick={() => setOnly(id)}>{l}</button>)}</div>
        <label className="in usage-days"><span className="sr-only">Period</span><select value={days} onChange={(e) => setDays(Number(e.target.value))}>
          {[7, 30, 90].map((d) => <option key={d} value={d}>Last {d} days</option>)}</select></label>
        <Tip text="Red: spam complaints, emails to Do-not-contact, or bounces over 5% (20+ emails). Amber: unsubscribes over 5% (40+ emails), Kestrel paused their sending, over 5,000 leads in one day, or over 20 email accounts. Only numbers and search keywords are shown, never email text." />
      </div>
      <div className="table-card members acct-table">
        <table className="leads">
          <thead><tr><th>Team</th><th>Flags</th><th>Searches</th><th>New leads</th><th>Sent</th><th>Bounces</th><th>Unsubs</th><th>AI</th><th>Last active</th></tr></thead>
          <tbody>{list.map((r) => (
            <tr key={r.id} className="usage-row" onClick={() => openTeam(r)}>
              <td><button type="button" className="link-btn" onClick={(e) => { e.stopPropagation(); openTeam(r); }}><b>{r.name}</b></button>
                <small className="muted-line">{r.owner ?? "—"} · {r.people} {r.people === 1 ? "person" : "people"}{r.locked_at ? " · Locked" : ""}</small></td>
              <td>{r.flags.length ? <span className="usage-flags">{r.flags.map((f) => <em key={f.text} className={`pill ${f.level === "red" ? "no" : "maybe"}`}>{f.text}</em>)}</span> : <span className="dr-muted">—</span>}</td>
              <td>{r.searches.toLocaleString()}</td><td>{r.leads_new.toLocaleString()}</td><td>{r.sent.toLocaleString()}</td>
              <td>{pct(r.bounced, r.sent)}</td><td>{pct(r.unsubs, r.sent)}</td><td>{r.ai_messages.toLocaleString()}</td><td>{day(r.last_active)}</td>
            </tr>))}</tbody>
        </table>
        {rows && !list.length ? <div className="empty"><div><b>{rows.length ? "No teams match" : "No teams yet"}</b></div></div> : null}
        {!rows ? <div className="empty"><div><b>Loading…</b></div></div> : null}
      </div>

      {open ? (
        <section className="join-card usage-detail" role="dialog" aria-label={`Usage: ${open.name}`}>
          <div className="rules-h"><b>{open.name} <span className="dr-muted">· {open.owner} · {open.state}{open.locked_at ? ` · locked ${day(open.locked_at)}` : ""}</span></b>
            <button type="button" className="link-btn" onClick={() => setOpen(null)}>Close</button></div>
          {open.flags.length ? <span className="usage-flags">{open.flags.map((f) => <em key={f.text} className={`pill ${f.level === "red" ? "no" : "maybe"}`}>{f.text}</em>)}</span> : null}
          <div className="kpis owner-kpis">
            <div><small>Searches</small><b>{open.searches}</b></div><div><small>New leads</small><b>{open.leads_new.toLocaleString()}</b><i className="kpi-note">{open.leads_total.toLocaleString()} in all</i></div>
            <div><small>Sent</small><b>{open.sent.toLocaleString()}</b><i className="kpi-note">{open.replies} replies</i></div>
            <div><small>Complaints</small><b>{open.complaints}</b><i className="kpi-note">{open.dnc_sent} to Do-not-contact</i></div>
          </div>
          {!detail ? <p className="dr-muted">Loading…</p> : (
            <div className="usage-grid">
              <div className="usage-box"><b>Searches <Tip text="Keyword and place each search used (from the extension's shared search progress), newest first, up to 300." /></b>
                <div className="usage-scroll"><table className="leads"><tbody>{detail.searches.length ? detail.searches.map((s) => {
                  const [mode, site, keyword, place] = s.key.split("|");
                  return <tr key={s.key}><td className="cap"><b>{keyword}</b> {place ? `· ${place}` : ""}<small className="muted-line">{MODES[mode] ?? mode}{site ? ` · ${site}` : ""}{s.who ? ` · ${s.who}` : ""}</small></td><td>{s.saved ?? 0} saved</td><td>{day(s.at)}</td></tr>;
                }) : <tr><td className="dr-muted">No searches in this period.</td></tr>}</tbody></table></div></div>
              <div className="usage-box"><b>Leads by source</b>
                <table className="leads"><tbody>{detail.leads_by_source.map((s) => <tr key={s.source}><td className="cap">{s.source}</td><td>{s.n.toLocaleString()}</td></tr>)}</tbody></table>
                <b>Leads and emails by day</b>
                <div className="usage-scroll"><table className="leads"><thead><tr><th>Day</th><th>Leads</th><th>Sent</th><th>Bounced</th><th>Unsubs</th></tr></thead><tbody>
                  {[...new Set([...detail.leads_by_day.map((d) => d.day), ...detail.mail_by_day.map((d) => d.day)])].sort().reverse().map((d) => {
                    const l = detail.leads_by_day.find((x) => x.day === d); const m = detail.mail_by_day.find((x) => x.day === d);
                    return <tr key={d}><td>{day(d)}</td><td>{l?.n ?? 0}</td><td>{m?.sent ?? 0}</td><td>{m?.bounced ?? 0}</td><td>{m?.unsubs ?? 0}</td></tr>;
                  })}</tbody></table></div></div>
              <div className="usage-box"><b>Email accounts</b>
                <table className="leads"><tbody>{detail.mailboxes.length ? detail.mailboxes.map((m) => <tr key={m.email}><td>{m.email}{m.note ? <small className="muted-line">{m.note}</small> : null}</td><td>{m.status}</td></tr>) : <tr><td className="dr-muted">None</td></tr>}</tbody></table>
                <b>People</b>
                <table className="leads"><tbody>{detail.members.map((m) => <tr key={m.email}><td>{m.email}</td><td className="cap">{m.role}</td><td>seen {day(m.seen)}</td></tr>)}</tbody></table>
                {detail.actions.length ? <><b>Lock history</b><table className="leads"><tbody>{detail.actions.map((a) => <tr key={a.at}><td className="cap">{a.action}</td><td>{a.reason ?? ""}</td><td>{day(a.at)} · {a.by ?? ""}</td></tr>)}</tbody></table></> : null}
              </div>
            </div>)}
          {open.locked_at ? (
            <div className="join-row"><span className="dr-muted">Reason they see: {open.locked_reason}</span><button type="button" className="btn go small" onClick={() => unlock(open)}>Unlock</button></div>
          ) : (
            <div className="join-row">
              <label className="in usage-reason"><span>Reason (the team sees it)</span><input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="Spam complaints about your emails." /></label>
              <button type="button" className="btn small usage-lock" disabled={reason.trim().length < 3} onClick={() => lock(open)}>Lock team</button>
            </div>)}
        </section>
      ) : null}
    </>
  );
}
