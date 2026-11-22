"use client";

import { useEffect, useState } from "react";
import { Tip } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/client";
import { STATUS_NAMES, rate, type CampaignLeadStatus, type CampaignStatus } from "@/lib/campaign";

// Mail → Analytics, like the leading tools: the team's numbers for a period (sent, replies, positive replies, bounces,
// unsubscribes), each campaign side by side, and the class's Daily Tracker (per day). Decide by replies, not opens.
type Day = { day: string; first_sent: number; follow_ups: number; replies: number; bounces: number; unsubscribes: number; auto_replies: number; opened?: number };
type Camp = { id: string; name: string; status: CampaignStatus; track_opens: boolean };
type Row = { campaign_id: string; status: CampaignLeadStatus; first_sent_at: string | null; stage?: string | null };
type Period = 7 | 30 | 90;
const POSITIVE = ["interested", "meeting", "won"];

export default function AnalyticsView({ demo }: { demo: boolean }) {
  const [period, setPeriod] = useState<Period>(30);
  const [days, setDays] = useState<Day[] | null>(null);
  const [camps, setCamps] = useState<Camp[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [since, setSince] = useState(0);

  useEffect(() => {
    let live = true;
    (async () => {
      if (demo) {
        const d = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
        if (!live) return;
        setSince(Date.now() - period * 86400000);
        setDays([0, 1, 2, 3, 4].map((n) => ({ day: d(n), first_sent: 25 - n * 2, follow_ups: 6 + n, replies: n % 2, bounces: n === 2 ? 1 : 0, unsubscribes: n === 3 ? 1 : 0, auto_replies: 1, opened: 9 - n })));
        setCamps([{ id: "c", name: "Video agencies, London (example)", status: "running", track_opens: true }]);
        setRows([...Array(30)].map((_, i) => ({ campaign_id: "c", status: (i < 3 ? "replied" : i < 4 ? "bounced" : "active") as CampaignLeadStatus, first_sent_at: d(1), stage: i < 2 ? "interested" : null })));
        return;
      }
      const sb = supabaseBrowser();
      const [t, c, r0] = await Promise.all([
        sb.rpc("mail_daily", { days: period }),
        sb.from("campaigns").select("id,name,status,track_opens").order("created_at", { ascending: false }),
        sb.from("campaign_leads").select("campaign_id,status,first_sent_at,stage").limit(20000),
      ]);
      const r = r0.error ? await sb.from("campaign_leads").select("campaign_id,status,first_sent_at").limit(20000) : r0;   // before database 020
      if (!live) return;
      setSince(Date.now() - period * 86400000);
      setDays((t.data as Day[] | null) ?? []); setCamps((c.data as Camp[] | null) ?? []); setRows((r.data as Row[] | null) ?? []);
    })();
    return () => { live = false; };
  }, [demo, period]);

  const sum = (k: keyof Omit<Day, "day">) => (days ?? []).reduce((n, d) => n + Number(d[k] || 0), 0);
  const sent = sum("first_sent") + sum("follow_ups"), first = sum("first_sent");
  const inPeriod = rows.filter((r) => r.first_sent_at && Date.parse(r.first_sent_at) >= since);
  const positive = inPeriod.filter((r) => POSITIVE.includes(r.stage ?? "")).length;
  const tracked = camps.some((c) => c.track_opens);

  return (
    <div className="app-page">
      <header className="head">
        <div><h1>Analytics <Tip text="Numbers from every campaign. Cold email usually gets a 1–2% reply rate; keep bounces under 1% and unsubscribes low. Opens are estimates, so decide by replies." /></h1>
          <span className="sub">Last {period} days</span></div>
        <div className="seg" role="group" aria-label="Period">
          {([7, 30, 90] as Period[]).map((p) => <button key={p} type="button" className={period === p ? "on" : ""} aria-pressed={period === p} onClick={() => setPeriod(p)}>{p} days</button>)}
        </div>
      </header>

      <div className="kpis">
        <div><small>Emails sent</small><b>{sent.toLocaleString()}</b></div>
        <div><small>New leads contacted</small><b>{first.toLocaleString()}</b></div>
        {tracked ? <div><small>Opened <Tip text="Estimate; only campaigns with Track opens on." /></small><b>{sum("opened").toLocaleString()}<i>{rate(sum("opened"), first)}</i></b></div> : null}
        <div><small>Replies</small><b>{sum("replies").toLocaleString()}<i>{rate(sum("replies"), first)}</i></b></div>
        <div><small>Positive replies <Tip text="Conversations you marked Interested, Meeting booked or Won on the Replies page." /></small><b>{positive.toLocaleString()}<i>{rate(positive, first)}</i></b></div>
        <div><small>Bounced</small><b className={first && sum("bounces") / first > 0.01 ? "dlv-bad" : ""}>{sum("bounces").toLocaleString()}<i>{rate(sum("bounces"), first)}</i></b></div>
        <div><small>Unsubscribed</small><b>{sum("unsubscribes").toLocaleString()}<i>{rate(sum("unsubscribes"), first)}</i></b></div>
      </div>

      <h2 className="an-h">Campaigns</h2>
      <div className="table-card members acct-table">
        <table className="leads">
          <thead><tr><th>Campaign</th><th>Status</th><th>Contacted</th><th>Replied</th><th>Positive</th><th>Bounced</th><th>Unsubscribed</th></tr></thead>
          <tbody>{camps.map((c) => {
            const mine = rows.filter((r) => r.campaign_id === c.id), started = mine.filter((r) => r.first_sent_at).length;
            const k = (s: CampaignLeadStatus) => mine.filter((r) => r.status === s).length;
            const pos = mine.filter((r) => POSITIVE.includes(r.stage ?? "")).length;
            return <tr key={c.id}><td><b>{c.name}</b></td><td>{STATUS_NAMES[c.status]}</td><td>{started.toLocaleString()}</td><td>{k("replied")}<small className="muted-line">{rate(k("replied"), started)}</small></td>
              <td>{pos}</td><td>{k("bounced")}<small className="muted-line">{rate(k("bounced"), started)}</small></td><td>{k("unsubscribed")}</td></tr>;
          })}</tbody>
        </table>
        {!camps.length ? <div className="empty"><div><b>No campaigns yet</b></div></div> : null}
      </div>

      {days && days.length ? <SentChart days={days} /> : null}
      <h2 className="an-h">Daily tracker <Tip text="Daily tracker: per day, first emails, follow-ups, replies, bounces, unsubscribes and out-of-office answers." /></h2>
      <div className="table-card members acct-table">
        <table className="leads">
          <thead><tr><th>Day</th><th>First emails</th><th>Follow-ups</th>{tracked ? <th>Opened</th> : null}<th>Replies</th><th>Bounced</th><th>Unsubscribed</th><th>Out of office</th></tr></thead>
          <tbody>{(days ?? []).map((d) => <tr key={d.day}><td>{new Date(d.day).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}</td><td>{d.first_sent}</td><td>{d.follow_ups}</td>{tracked ? <td>{d.opened ?? 0}</td> : null}<td>{d.replies}</td><td>{d.bounces}</td><td>{d.unsubscribes}</td><td>{d.auto_replies}</td></tr>)}</tbody>
        </table>
        {days && !days.length ? <div className="empty"><div><b>No emails sent in this period</b></div></div> : days === null ? <div className="empty"><div><b>Loading…</b></div></div> : null}
      </div>
    </div>
  );
}

// Emails per day as stacked bars (first emails, follow-ups), the kit's "Statistics" chart, in Kestrel blue. Oldest left.
function SentChart({ days }: { days: Day[] }) {
  const list = [...days].sort((a, b) => a.day.localeCompare(b.day)).slice(-30);
  const max = Math.max(1, ...list.map((d) => d.first_sent + d.follow_ups));
  const step = max > 50 ? 20 : max > 20 ? 10 : 5, top = Math.max(step * 2, Math.ceil(max / (step * 2)) * step * 2), W = 1100, H = 230, L = 36, B = 26, bw = Math.min(28, ((W - L) / list.length) * 0.5);
  const x = (i: number) => L + ((W - L) / list.length) * (i + 0.5), y = (v: number) => (H - B) - ((H - B - 10) * v) / top;
  const label = (d: string) => new Date(d).toLocaleDateString(undefined, list.length > 10 ? { day: "numeric", month: "short" } : { weekday: "short" });
  return (
    <section className="an-chart join-card" aria-label="Emails sent per day">
      <div className="an-chart-head"><b>Emails sent</b><span><i className="k1" /> First emails <i className="k2" /> Follow-ups</span></div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Emails sent per day, up to ${max} a day`}>
        {[0, 0.5, 1].map((t) => <g key={t}><line x1={L} x2={W} y1={y(top * t)} y2={y(top * t)} className="grid" /><text x={L - 8} y={y(top * t) + 4} textAnchor="end">{Math.round(top * t)}</text></g>)}
        {list.map((d, i) => {
          const a = y(d.first_sent), b = y(d.first_sent + d.follow_ups);
          return (
            <g key={d.day}>
              <title>{`${label(d.day)}: ${d.first_sent} first emails, ${d.follow_ups} follow-ups`}</title>
              <rect x={x(i) - bw / 2} y={a} width={bw} height={Math.max(0, (H - B) - a)} rx={Math.min(6, bw / 2)} className="b1" />
              {d.follow_ups ? <rect x={x(i) - bw / 2} y={b} width={bw} height={Math.max(0, a - b)} rx={Math.min(6, bw / 2)} className="b2" /> : null}
              {list.length <= 14 || i % Math.ceil(list.length / 10) === 0 ? <text x={x(i)} y={H - 6} textAnchor="middle">{label(d.day)}</text> : null}
            </g>
          );
        })}
      </svg>
    </section>
  );
}
