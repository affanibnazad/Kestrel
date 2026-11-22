"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Line } from "@/components/ui";
import { BarChart, Donut, LineChart } from "@/components/kit-charts";
import { RANGES, change, countByDay, dayLabel, mailByDay, pctLabel, type Change, type MailDay, type Range } from "@/lib/dashboard";
import { csvCell } from "@/lib/csv-cell";
import type { LeadRow } from "@/lib/leads";
import { BizAvatar, siteOfEmail } from "./biz";

// Home in design v2 (?look=v2): laid out exactly like the Flower kit's "Dashboard #1" (Overview, three stat cards,
// Statistics bars + Analytics line, Sales donut + horizontal Statistics, Last Orders table + Transactions list), with
// Kestrel's own numbers: leads added, emails sent, replies, AI fit, latest leads and latest replies.
type Reply = { id: string; campaign_lead_id: string | null; from_email: string; snippet: string | null; received_at: string | null; handled: boolean; name?: string | null; stage?: string | null };
const SOURCE: Record<string, string> = { maps: "Google Maps", search: "Google Search", youtube: "YouTube", osm: "OpenStreetMap", jobs: "Job boards", companies: "Companies House",
  podcasts: "Listen Notes", page: "Web page", sites: "Website list", site: "Website", import: "Imported", csv: "CSV import" };
const STAGE: Record<string, [string, string]> = { interested: ["Interested", "up"], meeting: ["Meeting", "up"], won: ["Won", "up"], not_now: ["Not now", "flat"],
  not_interested: ["Not interested", "down"], wrong_person: ["Wrong person", "down"], lost: ["Lost", "down"] };

// The example workspace (?preview=1): steady made-up numbers, the same on every load.
function demoMail(range: Range): MailDay[] {
  const out: MailDay[] = [];
  for (let i = 0; i < range * 2; i++) {
    const d = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10), s = 28 + ((i * 37) % 23);
    out.push({ day: d, first_sent: s, follow_ups: Math.round(s * 0.6), replies: 1 + ((i * 7) % 5) });
  }
  return out;
}
// Example leads per day (the example leads themselves are only a handful, all made today).
function demoDates(range: Range, good: boolean, now: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < range * 2; i++) {
    const n = good ? 1 + ((i * 3) % 4) : 4 + ((i * 5) % 9), d = new Date(now - i * 864e5).toISOString();
    for (let k = 0; k < n; k++) out.push(d);
  }
  return out;
}
const DEMO_REPLIES: Reply[] = [
  { id: "r1", campaign_lead_id: "c1", from_email: "maya@northlight-example.test", snippet: "Yes, happy to talk next week.", received_at: new Date(Date.now() - 3 * 3600e3).toISOString(), handled: false, name: "Northlight Studio (example)", stage: "interested" },
  { id: "r2", campaign_lead_id: "c2", from_email: "tom@harbour-example.test", snippet: "Not right now, thanks.", received_at: new Date(Date.now() - 26 * 3600e3).toISOString(), handled: true, name: "Harbour Social (example)", stage: "not_now" },
  { id: "r3", campaign_lead_id: "c3", from_email: "ana@fieldhouse-example.test", snippet: "Can you send examples?", received_at: new Date(Date.now() - 50 * 3600e3).toISOString(), handled: false, name: "Fieldhouse Media (example)", stage: "meeting" },
];

function Delta({ c }: { c: Change }) {
  const label = pctLabel(c);
  if (label === "—") return <span className="kd-delta flat">—</span>;
  return <span className={`kd-delta ${c.up ? "up" : "down"}`}><i aria-hidden="true">{c.up ? "↑" : "↓"}</i>{label.replace(/^[+-]/, "")}</span>;
}
function RangeChip({ label }: { label: string }) {
  return <span className="kd-chip"><Line name="clock" /> {label} <i className="kcaret" aria-hidden="true" /></span>;
}

export default function HomeKit({ leads, demo, go, onLead, teamId }: { leads: LeadRow[]; demo: boolean; go: (id: string) => void; onLead: (id: string) => void; teamId?: string }) {
  const [range, setRange] = useState<Range>(7);
  const [mail, setMail] = useState<MailDay[]>([]);
  const [replies, setReplies] = useState<Reply[]>([]);
  // Today, read after the page opens (the page is first drawn on the server, where the clock must not be read).
  const [now, setNow] = useState(0);
  useEffect(() => { Promise.resolve().then(() => setNow(Date.now())); }, []);

  useEffect(() => {
    if (demo || !teamId) { Promise.resolve().then(() => { setMail(demoMail(range)); setReplies(DEMO_REPLIES); }); return; }
    const sb = supabaseBrowser();
    sb.rpc("mail_daily", { days: Math.min(90, range * 2) }).then(({ data }) => setMail((data ?? []) as MailDay[]));
    sb.from("mail_replies").select("id,campaign_lead_id,from_email,snippet,received_at,handled").eq("kind", "reply").order("received_at", { ascending: false }).limit(6)
      .then(async ({ data }) => {
        const list = (data ?? []) as Reply[];
        const ids = [...new Set(list.map((r) => r.campaign_lead_id).filter(Boolean))] as string[];
        const { data: cl } = ids.length ? await sb.from("campaign_leads").select("id,lead_name,stage").in("id", ids) : { data: [] };
        const by = new Map(((cl ?? []) as { id: string; lead_name: string | null; stage: string | null }[]).map((x) => [x.id, x]));
        setReplies(list.map((r) => ({ ...r, name: r.campaign_lead_id ? by.get(r.campaign_lead_id)?.lead_name : null, stage: r.campaign_lead_id ? by.get(r.campaign_lead_id)?.stage : null })));
      });
  }, [demo, teamId, range]);

  const live = useMemo(() => leads.filter((l) => l.status !== "removed"), [leads]);
  const added = useMemo(() => countByDay(demo ? (now ? demoDates(range, false, now) : []) : live.map((l) => l.created_at), range, now), [demo, live, range, now]);
  const goodAdded = useMemo(() => countByDay(demo ? (now ? demoDates(range, true, now) : []) : live.filter((l) => l.verdict === "Good").map((l) => l.created_at), range, now), [demo, live, range, now]);
  const m = useMemo(() => mailByDay(mail, range, now), [mail, range, now]);
  const labels = added.days.map((d) => dayLabel(d, range));
  const fit = { Good: 0, Maybe: 0, No: 0, none: 0 };
  for (const l of live) fit[(l.verdict ?? "none") as keyof typeof fit]++;
  const latest = useMemo(() => [...live].sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, 5), [live]);
  const span = `${new Date(`${added.days[0]}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })} – ${new Date(`${added.days[added.days.length - 1]}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}`;

  function download() {
    const rows = [["Day", "Leads added", "Good fit added", "Emails sent", "Replies"], ...added.days.map((d, i) => [d, added.counts[i], goodAdded.counts[i], m.sent[i], m.replies[i]])];
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([rows.map((r) => r.map(csvCell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" }));
    a.download = `kestrel-overview-${added.days[added.days.length - 1]}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  // The kit's horizontal Statistics: one row per day (newest at the top), leads added to the left, emails sent to the right.
  const days = added.days.map((d, i) => ({ d, left: added.counts[i], right: m.sent[i] })).slice(-7).reverse();
  const sideMax = Math.max(1, ...days.map((x) => Math.max(x.left, x.right)));

  const stats: [string, string, Change, string, string][] = [
    ["Leads added", added.total.value.toLocaleString(), added.total, "people", "all"],
    ["Emails sent", m.totalSent.value.toLocaleString(), m.totalSent, "send", "analytics"],
    ["Replies", m.totalReplies.value.toLocaleString(), m.totalReplies, "inbox", "inbox"],
  ];
  return (
    <div className="kpage kdash">
      <header className="khead">
        <h1>Overview</h1>
        <div className="kd-head-tools">
          <button type="button" className="kd-iconbtn" aria-label="Download these numbers (CSV)" title="Download these numbers (CSV)" onClick={download}><Line name="down" /></button>
          <label className="kd-select"><span className="sr-only">Period</span>
            <select value={range} onChange={(e) => setRange(Number(e.target.value) as Range)}>{RANGES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select>
            <i className="kcaret" aria-hidden="true" />
          </label>
        </div>
      </header>

      <div className="kd-grid">
        {stats.map(([label, value, c, icon, to]) => (
          <button key={label} type="button" className="kd-card kd-stat" onClick={() => go(to)}>
            <span className="kd-stat-t"><small>{label}</small><b>{value} <Delta c={c} /></b></span>
            <span className="kd-tile" aria-hidden="true"><Line name={icon} /></span>
          </button>
        ))}

        <section className="kd-card kd-half">
          <div className="kd-card-h"><h2>Statistics</h2><RangeChip label={span} /></div>
          <BarChart stacked title="Emails sent and replies per day" labels={labels} series={[{ name: "Emails sent", values: m.sent, tone: "a" }, { name: "Replies", values: m.replies, tone: "b" }]} />
          <div className="kd-legend"><span><i className="a" />Emails sent</span><span><i className="b" />Replies</span></div>
        </section>

        <section className="kd-card kd-half">
          <div className="kd-card-h"><h2>Analytics</h2><RangeChip label={span} /></div>
          <div className="kd-pills">
            <span className="kd-pill"><i className={added.total.up ? "up" : "down"} aria-hidden="true">{added.total.up ? "↑" : "↓"}</i><b>{added.total.value.toLocaleString()}</b><small>leads</small></span>
            <span className="kd-pill"><i className={goodAdded.total.up ? "up" : "down"} aria-hidden="true">{goodAdded.total.up ? "↑" : "↓"}</i><b>{goodAdded.total.value.toLocaleString()}</b><small>good fit</small></span>
          </div>
          <LineChart kit title="Leads and good-fit leads added per day" labels={labels} series={[{ name: "Leads added", values: added.counts, tone: "a" }, { name: "Good fit", values: goodAdded.counts, tone: "b" }]} />
        </section>

        <section className="kd-card kd-third">
          <div className="kd-card-h"><h2>AI fit</h2><button type="button" className="kd-more" aria-label="Open leads" onClick={() => go("all")}><Line name="more" /></button></div>
          <div className="kd-donut">
            <Donut title="Leads by AI fit" center={live.length.toLocaleString()} sub="Leads"
              parts={[{ name: "Good", value: fit.Good, tone: "a" }, { name: "Maybe", value: fit.Maybe, tone: "b" }, { name: "No", value: fit.No, tone: "c" }, { name: "Not scored", value: fit.none, tone: "d" }]} />
          </div>
          <ul className="kd-rows">
            <li><span><i className="a" />Good fit</span><b>{fit.Good.toLocaleString()}</b><Delta c={goodAdded.total} /></li>
            <li><span><i className="b" />Maybe</span><b>{fit.Maybe.toLocaleString()}</b><Delta c={change(0, 0)} /></li>
          </ul>
        </section>

        <section className="kd-card kd-two3">
          <div className="kd-card-h"><h2>Statistics</h2><div className="kd-legend top"><span><i className="a" />Leads added</span><span><i className="b" />Emails sent</span></div><RangeChip label={span} /></div>
          <div className="kd-diverge" role="img" aria-label={`Last 7 days: ${days.map((x) => `${x.d}: ${x.left} leads, ${x.right} emails`).join("; ")}`}>
            {days.map((x) => (
              <div key={x.d} className="kd-dv-row" title={`${dayLabel(x.d, 30)}: ${x.left} leads added, ${x.right} emails sent`}>
                <span className="kd-dv-day">{new Date(`${x.d}T12:00:00Z`).getUTCDate()}</span>
                <span className="kd-dv-l"><i style={{ width: `${(x.left / sideMax) * 100}%` }} /></span>
                <span className="kd-dv-r"><i style={{ width: `${(x.right / sideMax) * 100}%` }} /></span>
              </div>
            ))}
            <div className="kd-dv-axis" aria-hidden="true"><span />{[sideMax, Math.round(sideMax / 2), 0, Math.round(sideMax / 2), sideMax].map((v, i) => <span key={i}>{v.toLocaleString()}</span>)}</div>
          </div>
        </section>

        <section className="kd-card kd-two3">
          <div className="kd-card-h"><h2>Latest leads</h2><button type="button" className="kd-chip as-btn" onClick={() => go("all")}>All leads <i className="kcaret" aria-hidden="true" /></button></div>
          <div className="kd-tablewrap">
            <table className="kd-table">
              <colgroup><col className="w-who" /><col className="w-cat" /><col className="w-fit" /><col className="w-src" /><col className="w-date" /><col className="w-more" /></colgroup>
              <thead><tr><th>Business</th><th>Category</th><th>AI fit</th><th>Source</th><th>Added</th><th aria-label="Open" /></tr></thead>
              <tbody>{latest.length ? latest.map((l) => (
                <tr key={l.id} onClick={() => onLead(l.id)}>
                  <td><span className="kd-who"><BizAvatar name={l.name} website={l.website || siteOfEmail(l.email)} size={32} /><b>{l.name || l.email || "Unnamed"}</b></span></td>
                  <td className="kmuted">{l.category || "—"}</td>
                  <td>{l.verdict ? <span className={`kpill ${l.verdict === "Good" ? "good" : l.verdict === "Maybe" ? "maybe" : "mute"}`}>{l.verdict}</span> : <span className="kmuted">Not scored</span>}</td>
                  <td className="kmuted">{SOURCE[l.source ?? ""] ?? (l.source || "—")}</td>
                  <td>{new Date(l.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</td>
                  <td><button type="button" className="kd-more" aria-label={`Open ${l.name ?? "lead"}`} onClick={(e) => { e.stopPropagation(); onLead(l.id); }}><Line name="more" /></button></td>
                </tr>
              )) : <tr><td colSpan={6} className="kmuted kd-empty">No leads yet. Collect some with the Kestrel extension.</td></tr>}</tbody>
            </table>
          </div>
        </section>

        <section className="kd-card kd-third">
          <div className="kd-card-h"><h2>Latest replies</h2><button type="button" className="kd-more" aria-label="Open Replies" onClick={() => go("inbox")}><Line name="more" /></button></div>
          <ul className="kd-feed">
            {replies.length ? replies.slice(0, 5).map((r) => {
              const [stage, tone] = STAGE[r.stage ?? ""] ?? [r.handled ? "Answered" : "New reply", r.handled ? "flat" : "up"];
              const t = r.received_at ? new Date(r.received_at) : null;
              return (
                <li key={r.id}><button type="button" onClick={() => go("inbox")}>
                  <BizAvatar name={r.name || r.from_email} website={siteOfEmail(r.from_email)} size={40} />
                  <span className="kd-feed-t"><b>{r.name || r.from_email}</b><small>{t ? `${t.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })} — ${t.toLocaleDateString("en-GB", { day: "numeric", month: "long" })}` : ""}</small></span>
                  <span className="kd-feed-r"><b className={tone}>{stage}</b><small>Reply</small></span>
                </button></li>
              );
            }) : <li className="kmuted kd-empty">No replies yet. They show here as soon as someone answers a campaign.</li>}
          </ul>
        </section>
      </div>
    </div>
  );
}
