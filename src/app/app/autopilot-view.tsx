"use client";

import { askConfirm } from "@/components/dialog";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Line, Tip } from "@/components/ui";
import type { LeadRow } from "@/lib/leads";
import { GOAL_DEFAULTS, PER_DAY, lines, searchesLeft, type ApGoal } from "@/lib/autopilot";
import { BizAvatar } from "./biz";

// Autopilot (database 042, plan: Outreach Engine/13). The team saves one goal: who to find, its offer, sequence and campaign,
// and how many leads a day. Then it runs by itself:
//   1. the Kestrel extension runs the goal's searches (side panel → Run Autopilot searches, or by itself),
//   2. every 10 minutes Kestrel's server takes new leads: find email → score with AI → write the emails (Good fit only),
//   3. ready leads wait here for the team's OK; Approve adds them to the campaign, which sends inside its hours and limits.
// Nothing is ever sent without Approve. This page shows the pipeline, today's work, the run history and any problem.
type Acct = { team_id: string; role: string } | null;
type Camp = { id: string; name: string; status: string; tested_at: string | null };
type Named = { id: string; name: string };
type Run = { at: string; worked: number; emails: number; scored: number; good: number; written: number; note: string | null };
type Row = { is_on: boolean; goal: ApGoal; done_today: number; run_day: string | null; last_run_at: string | null; last_note: string | null };
const ago = (iso: string | null) => {
  if (!iso) return "never";
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(iso).toLocaleDateString();
};
const today = () => new Date().toISOString().slice(0, 10);

export default function AutopilotView({ account, leads, demo, editable, toast, go, blocked, onChanged }: {
  account: Acct; leads: LeadRow[]; demo: boolean; editable: boolean; toast: (t: string) => void; go: (view: string) => void;
  blocked: (l: LeadRow) => boolean; lists?: Named[]; inList?: Record<string, string[]>; onChanged: () => void;
}) {
  const manage = Boolean(account && ["owner", "manager"].includes(account.role)) || demo;
  const [row, setRow] = useState<Row | null>(null);
  const [goal, setGoal] = useState<ApGoal>(GOAL_DEFAULTS);
  const [kwText, setKwText] = useState(""), [plText, setPlText] = useState("");
  const [runs, setRuns] = useState<Run[]>([]);
  const [done, setDone] = useState<Set<string>>(new Set());          // finished searches (team progress)
  const [drafted, setDrafted] = useState<Set<string>>(new Set());
  const [contacted, setContacted] = useState<Set<string>>(new Set());
  const [offers, setOffers] = useState<Named[]>([]), [seqs, setSeqs] = useState<Named[]>([]), [camps, setCamps] = useState<Camp[]>([]);
  const [missing, setMissing] = useState("");
  const [saving, setSaving] = useState(false), [approving, setApproving] = useState(false), [editing, setEditing] = useState(false);
  const [unticked, setUnticked] = useState<Set<string>>(new Set());
  const [now] = useState(() => Date.now());

  const fill = (g: ApGoal) => { setGoal(g); setKwText(g.keywords.join("\n")); setPlText(g.places.join("\n")); };
  const load = useCallback(async () => {
    if (demo || !account) {
      const g: ApGoal = { ...GOAL_DEFAULTS, keywords: ["Video production company", "Marketing agency"], places: ["London, United Kingdom", "Manchester, United Kingdom", "Dublin, Ireland"], offer_id: "demo-offer", campaign_id: "demo-c" };
      setRow({ is_on: true, goal: g, done_today: 18, run_day: today(), last_run_at: new Date(Date.now() - 4 * 60000).toISOString(), last_note: null });
      fill(g); setOffers([{ id: "demo-offer", name: "Video editing for agencies" }]); setSeqs([]);
      setCamps([{ id: "demo-c", name: "Video agencies, UK (example)", status: "running", tested_at: new Date().toISOString() }]);
      setDone(new Set(["maps||video production company|london, united kingdom", "maps||marketing agency|london, united kingdom"]));
      setDrafted(new Set(leads.filter((l) => l.verdict === "Good").slice(0, 3).map((l) => l.id)));
      setRuns([0, 1, 2].map((i) => ({ at: new Date(Date.now() - (4 + i * 10) * 60000).toISOString(), worked: 6, emails: 4 - i, scored: 6, good: 3 - i, written: 3 - i, note: null })));
      return;
    }
    const sb = supabaseBrowser();
    const [a, r, pr, d, o, q, c, cl, ai] = await Promise.all([
      sb.from("autopilot").select("is_on,goal,done_today,run_day,last_run_at,last_note").maybeSingle(),
      sb.from("autopilot_runs").select("at,worked,emails,scored,good,written,note").order("at", { ascending: false }).limit(12),
      sb.from("progress").select("key").eq("status", "done").limit(20000),
      sb.from("leads").select("id,at:data->outreach->>at").eq("team_id", account.team_id).not("data->outreach", "is", null).limit(5000),
      sb.from("offer_profiles").select("id,name").order("name"),
      sb.from("sequences").select("id,name").order("name"),
      sb.from("campaigns").select("id,name,status,tested_at").in("status", ["draft", "running", "paused"]).order("created_at", { ascending: false }),
      sb.from("campaign_leads").select("lead_id").not("lead_id", "is", null).limit(20000),
      sb.from("team_ai").select("offer_id,sender_name,address").maybeSingle(),
    ]);
    if (a.error && /autopilot/.test(a.error.message)) { setMissing("Autopilot is coming soon to your workspace."); return; }
    const saved = a.data as Row | null;
    const ta = ai.data as { offer_id: string | null; sender_name: string; address: string } | null;
    setRow(saved);
    fill(saved ? { ...GOAL_DEFAULTS, ...saved.goal } : { ...GOAL_DEFAULTS, offer_id: ta?.offer_id ?? null });
    setRuns((r.data ?? []) as Run[]);
    setDone(new Set(((pr.data ?? []) as { key: string }[]).map((x) => x.key)));
    setDrafted(new Set(((d.data ?? []) as { id: string; at: string | null }[]).filter((x) => x.at).map((x) => x.id)));
    setOffers((o.data ?? []) as Named[]); setSeqs((q.data ?? []) as Named[]); setCamps((c.data ?? []) as Camp[]);
    setContacted(new Set(((cl.data ?? []) as { lead_id: string }[]).map((x) => x.lead_id)));
    if (!saved) setEditing(true);
  }, [account, demo, leads]);
  useEffect(() => { Promise.resolve().then(load); }, [load]);

  const on = Boolean(row?.is_on);
  const g = row?.goal ? { ...GOAL_DEFAULTS, ...row.goal } : goal;
  const search = searchesLeft(g, done);
  const doneToday = row && row.run_day === today() ? row.done_today : 0;
  const live = leads.filter((l) => l.status !== "removed" && !blocked(l));
  const week = now - 7 * 864e5;
  const ready = live.filter((l) => l.email && drafted.has(l.id) && !contacted.has(l.id) && (!g.only_good || l.verdict === "Good"));
  const chosen = ready.filter((l) => !unticked.has(l.id));
  const stages = useMemo(() => [
    { n: search.left, label: "Searches left", note: search.total ? `of ${search.total} in your goal` : "set who to find", tip: "Keyword × place searches the Kestrel extension still has to run. Open its side panel: Run Autopilot searches." },
    { n: live.filter((l) => Date.parse(l.created_at) > week).length, label: "New leads", note: "last 7 days", tip: "Leads the extension collected this week." },
    { n: live.filter((l) => l.email).length, label: "With an email", note: g.find_emails ? "Hunter, Apollo, Findymail" : "finding off", tip: "Leads that have an email address. Autopilot finds missing ones with your team's keys." },
    { n: live.filter((l) => l.verdict === "Good").length, label: "Good fit", note: "by AI or by hand", tip: "Leads judged a Good fit for your offer, by the AI or by you in Review." },
    { n: ready.length, label: "Waiting for your OK", note: "emails written", tip: "Written and ready. Approve them below to start sending." },
    { n: contacted.size, label: "In campaigns", note: "sending or sent", tip: "Leads in a campaign. Sending follows each campaign's hours, daily limits and Spam Guard." },
  ], [search.left, search.total, live, week, g.find_emails, ready.length, contacted.size]);

  async function save(turnOn: boolean) {
    const next: ApGoal = { ...goal, keywords: lines(kwText, 50, 80), places: lines(plText, 300, 120) };
    if (turnOn && (!next.keywords.length || !next.places.length)) { toast("Add at least one keyword and one place."); return; }
    if (turnOn && !next.offer_id) { toast("Choose your offer: Autopilot scores and writes for it."); return; }
    if (demo) { setRow((r) => ({ ...(r as Row), is_on: turnOn, goal: next })); fill(next); setEditing(false); toast(turnOn ? "Autopilot is on (example)." : "Autopilot paused (example)."); return; }
    setSaving(true);
    const { data, error } = await supabaseBrowser().rpc("autopilot_save", { goal: next, turn_on: turnOn });
    setSaving(false);
    if (error) { toast(/autopilot_save|schema cache/.test(error.message) ? "Autopilot is coming soon to your workspace." : error.message.replace(/^PLAN_NEEDED:\s*/, "")); return; }
    const d = data as { is_on: boolean; goal: ApGoal };
    setRow((r) => ({ ...(r ?? { done_today: 0, run_day: null, last_run_at: null, last_note: null }), is_on: d.is_on, goal: d.goal }));
    fill({ ...GOAL_DEFAULTS, ...d.goal }); setEditing(false);
    toast(d.is_on ? "Autopilot is on. It works new leads every 10 minutes; ready ones wait here for your OK." : "Saved. Autopilot is paused.");
  }

  async function approve() {
    const c = camps.find((x) => x.id === (goal.campaign_id ?? ""));
    if (!c) { toast("Choose a campaign, or make one in Mail → Campaigns."); return; }
    if (!chosen.length) { toast("Tick at least one lead."); return; }
    if (c.status === "draft" && !c.tested_at) { toast("Send a test to yourself in that campaign first (Campaigns → Options → Test)."); go("campaigns"); return; }
    if (!await askConfirm(`${c.status === "draft" ? "Start" : "Add to"} “${c.name}” with ${chosen.length} ${chosen.length === 1 ? "lead" : "leads"}? Emails go out inside the campaign's sending hours and daily limits.`)) return;
    if (demo) { toast(`Added ${chosen.length} leads (example).`); return; }
    setApproving(true);
    const ids = chosen.map((l) => l.id);
    const { data, error } = c.status === "draft" ? await supabaseBrowser().rpc("start_campaign", { campaign: c.id, lead_ids: ids })
      : await supabaseBrowser().rpc("campaign_add_leads", { campaign: c.id, lead_ids: ids });
    setApproving(false);
    if (error) { toast(error.message); return; }
    const r = data as { added: number; skipped: number };
    setContacted((cur) => new Set([...cur, ...ids]));
    toast(`${r.added} ${r.added === 1 ? "lead" : "leads"} joined “${c.name}”.${r.skipped ? ` ${r.skipped} skipped (already in a campaign, on Do-not-contact, or no written email).` : ""}`);
    onChanged(); load();
  }

  const note = row?.last_note;
  const fixView = note ? (/key|Hunter|Apollo|Findymail|AI:/i.test(note) ? "connections" : /offer|address|sender|name/i.test(note) ? "rules" : /sequence/i.test(note) ? "sequences" : "") : "";
  const offerName = offers.find((o) => o.id === g.offer_id)?.name;

  if (missing) return <div className="app-page"><header className="head"><div><h1>Autopilot</h1></div></header><p className="plan-msg">{missing}</p></div>;
  return (
    <div className="app-page autopilot">
      <header className="head">
        <div><h1>Autopilot <Tip text="Set your goal once. The Kestrel extension finds the leads, and every 10 minutes Kestrel finds their emails, scores them with AI and writes the emails. Ready leads wait here for your OK: nothing is sent until you approve." /></h1>
          <span className="sub"><i className={`ap-state ${on ? "on" : ""}`} aria-hidden="true" />{on ? `On · last worked ${ago(row?.last_run_at ?? null)} · ${doneToday} of ${g.per_day} leads today` : row ? "Paused" : "Not set up yet"}</span></div>
        {manage ? (
          <div className="head-actions">
            {!editing ? <button type="button" className="btn glass small" onClick={() => setEditing(true)}>Edit goal</button> : null}
            {on ? <button type="button" className="btn glass small" disabled={saving || !editable} onClick={() => save(false)}>Pause</button>
              : <button type="button" className="btn go small" disabled={saving || !editable} onClick={() => save(true)}><Line name="bolt" /> Turn on Autopilot</button>}
          </div>
        ) : null}
      </header>

      <ol className="ap-pipe" aria-label="Autopilot pipeline">
        {stages.map((s, i) => (
          <li key={s.label} className={i === 4 && s.n ? "hot" : ""}>
            <small>{s.label} <Tip text={s.tip} /></small><b>{s.n.toLocaleString()}</b><span>{s.note}</span>
          </li>
        ))}
      </ol>

      {note ? (
        <p className="rules-warn ap-note" role="status">{note}{fixView ? <> <button type="button" className="link-btn" onClick={() => go(fixView)}>Fix it</button></> : null}</p>
      ) : null}

      <div className="ap-grid">
        <section className="join-card prof-form">
          <div className="rules-h"><b>Your goal</b>{!editing && manage ? <button type="button" className="link-btn" onClick={() => setEditing(true)}>Edit</button> : null}</div>
          {editing && manage ? (
            <>
              <div className="row2">
                <label className="in"><span>Keywords <Tip text="One per line, like you would type in Google Maps: Marketing agency, Dentist…" /></span>
                  <textarea rows={5} value={kwText} onChange={(e) => setKwText(e.target.value)} placeholder={"Marketing agency\nVideo production company"} /></label>
                <label className="in"><span>Places <Tip text="One per line: a city and its country works best (Dublin, Ireland)." /></span>
                  <textarea rows={5} value={plText} onChange={(e) => setPlText(e.target.value)} placeholder={"Dublin, Ireland\nLondon, United Kingdom"} /></label>
              </div>
              <div className="row2">
                <label className="in"><span>Search on</span><select value={goal.source} onChange={(e) => setGoal({ ...goal, source: e.target.value === "osm" ? "osm" : "maps" })}>
                  <option value="maps">Google Maps</option><option value="osm">OpenStreetMap (no Google limits)</option></select></label>
                <label className="in"><span>Leads a day <Tip text="The most leads Autopilot works per day (find email, score, write). It keeps your Hunter credits and AI costs in check." /></span>
                  <select value={goal.per_day} onChange={(e) => setGoal({ ...goal, per_day: Number(e.target.value) })}>{PER_DAY.map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
              </div>
              <div className="row2">
                <label className="in"><span>Offer <Tip text="What you sell and who buys it. The AI judges fit and writes for it. Edit it in Kestrel AI → Score and write." /></span>
                  <select value={goal.offer_id ?? ""} onChange={(e) => setGoal({ ...goal, offer_id: e.target.value || null })}>
                    <option value="">Choose your offer</option>{offers.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
                <label className="in"><span>Emails</span>
                  <select value={goal.sequence} onChange={(e) => setGoal({ ...goal, sequence: e.target.value })}>
                    <option value="default">First email + 3 follow-ups (Kestrel&apos;s)</option><option value="none">First email only</option>
                    {seqs.map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}</select></label>
              </div>
              <label className="in"><span>Send from campaign <Tip text="When you approve leads, they join this campaign. It sends from its tested email accounts, inside its hours and limits." /></span>
                <select value={goal.campaign_id ?? ""} onChange={(e) => setGoal({ ...goal, campaign_id: e.target.value || null })}>
                  <option value="">Choose when you approve</option>
                  {camps.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.status === "running" ? "sending" : c.status === "paused" ? "paused" : c.tested_at ? "not started, tested" : "not started, needs a test"}</option>)}</select></label>
              <div className="ap-checks">
                <label className="agree"><input type="checkbox" checked={goal.find_emails} onChange={(e) => setGoal({ ...goal, find_emails: e.target.checked })} /> <span>Find missing emails (uses your finder credits)</span></label>
                <label className="agree"><input type="checkbox" checked={goal.only_good} onChange={(e) => setGoal({ ...goal, only_good: e.target.checked })} /> <span>Write emails for Good-fit leads only</span></label>
              </div>
              <div className="join-row">
                <button type="button" className="btn go small" disabled={saving || !editable} onClick={() => save(true)}>{saving ? "Saving…" : on ? "Save" : "Save and turn on"}</button>
                <button type="button" className="btn glass small" disabled={saving || !editable} onClick={() => save(false)}>Save, keep paused</button>
                {row ? <button type="button" className="link-btn" onClick={() => { fill({ ...GOAL_DEFAULTS, ...row.goal }); setEditing(false); }}>Cancel</button> : null}
              </div>
            </>
          ) : (
            <dl className="ap-goal">
              <div><dt>Find</dt><dd>{g.keywords.length ? g.keywords.join(", ") : "—"}</dd></div>
              <div><dt>In</dt><dd>{g.places.length ? `${g.places.slice(0, 6).join(" · ")}${g.places.length > 6 ? ` +${g.places.length - 6} more` : ""}` : "—"}</dd></div>
              <div><dt>On</dt><dd>{g.source === "osm" ? "OpenStreetMap" : "Google Maps"}</dd></div>
              <div><dt>Offer</dt><dd>{offerName ?? "Not chosen"}</dd></div>
              <div><dt>Each day</dt><dd>Up to {g.per_day} leads{g.find_emails ? " · find emails" : ""} · score · write{g.only_good ? " (Good fit)" : ""}</dd></div>
            </dl>
          )}
        </section>

        <section className="join-card">
          <div className="rules-h"><b>How it runs <Tip text="Searches need your browser (Google Maps does not allow servers). The rest runs on Kestrel's server, even when your computer is off." /></b></div>
          <ol className="ap-how">
            <li><b>Find leads</b><span>In the Kestrel extension&apos;s side panel: <em>Run Autopilot searches</em>, or tick &ldquo;Start by itself&rdquo;. {search.left ? `${search.left} searches left.` : search.total ? "All searches done: add places to find more." : ""}</span>
              <button type="button" className="link-btn" onClick={() => go("get")}>Extension</button></li>
            <li><b>Find emails, score, write</b><span>Every 10 minutes, up to {g.per_day} leads a day. {on ? `Today: ${doneToday} done.` : "Turn Autopilot on to start."}</span></li>
            <li><b>You approve</b><span>Ready leads wait below. Nothing is sent without your OK.</span></li>
          </ol>
          {runs.length ? (
            <table className="ap-runs"><thead><tr><th>When</th><th>Worked</th><th>Emails</th><th>Good</th><th>Written</th></tr></thead>
              <tbody>{runs.slice(0, 6).map((r, i) => <tr key={i} title={r.note ?? ""}><td>{ago(r.at)}</td><td>{r.worked}</td><td>{r.emails}</td><td>{r.good}</td><td>{r.written}</td></tr>)}</tbody></table>
          ) : <p className="dr-muted">No runs yet. {on ? "The first one starts within 10 minutes when new leads are in." : ""}</p>}
        </section>
      </div>

      <section className="join-card ap-ready">
        <div className="rules-h"><b>Ready for your OK <Tip text="Leads with an email and written emails. Untick any you do not want and click Approve. A campaign that has not started yet needs a test email to yourself first." /></b>
          <span className="sub-dark">{chosen.length} of {ready.length} ticked</span></div>
        {ready.length ? (
          <>
            <ul className="ap-list">{ready.slice(0, 200).map((l) => (
              <li key={l.id}><label><input type="checkbox" checked={!unticked.has(l.id)} onChange={(e) => { const n = new Set(unticked); if (e.target.checked) n.delete(l.id); else n.add(l.id); setUnticked(n); }} />
                <BizAvatar name={l.name} website={l.website} size={28} /><span className="biz-txt"><b>{l.name || l.email}</b><small>{l.email}</small></span></label>
                {l.verdict ? <em className={`pill ${l.verdict.toLowerCase()}`}>{l.verdict}</em> : null}</li>
            ))}</ul>
            <div className="ap-approve">
              <select value={goal.campaign_id ?? ""} onChange={(e) => setGoal({ ...goal, campaign_id: e.target.value || null })} aria-label="Campaign">
                <option value="">Choose a campaign</option>
                {camps.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.status === "running" ? "sending" : c.status === "paused" ? "paused" : c.tested_at ? "not started, tested" : "not started, needs a test"}</option>)}
              </select>
              <button type="button" className="link-btn" onClick={() => go("campaigns")}>New campaign</button>
              <button type="button" className="btn go small" disabled={!manage || approving || !chosen.length || !goal.campaign_id} onClick={approve}>{approving ? "Adding…" : `Approve and send ${chosen.length}`}</button>
            </div>
          </>
        ) : <p className="home-empty">{on ? "Nothing waiting yet. As leads come in, Autopilot finds emails, scores and writes, and they show here." : "Turn Autopilot on: written leads show here for your OK."}</p>}
      </section>
    </div>
  );
}
