"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Tip } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/client";
import { planName, type PlanId } from "@/lib/plans";
import AccessView from "./access-view";
import OwnerAi from "./owner-ai";
import OwnerAssistant from "./owner-assistant";
import OwnerGoogle from "./owner-google";
import CreatorsView from "./creators-view";
import OwnerVerifier from "./owner-verifier";
import OwnerOffers from "./owner-offers";
import OwnerUsage from "./owner-usage";
import { csvCell } from "@/lib/csv-cell";

// The owner panel (Kestrel admins only): the business at a glance, everyone using Kestrel, access codes and messages.
// Only people who said yes to news and offers may get marketing emails (UK/EU law), so exports mark that clearly.
type State = "trial" | "ended" | "paid" | "free";
type Person = {
  email: string; name: string | null; job: string | null; role: string; team: string; team_id?: string; state: State; plan: string;
  trial_ends_at: string; paid_until: string | null; billing_status: string | null; access_until: string | null;
  joined_at: string; last_seen: string | null; leads: number; last_lead: string | null; country: string | null;
  size: string | null; website: string | null; heard_from: string | null; news_ok: boolean;
};
type Message = { name: string; email: string; company: string | null; topic: string; message: string; at: string };
type Totals = Record<"people" | "teams" | "trial" | "ended" | "paid" | "free" | "starter" | "pro" | "agency" | "mrr" | "new7" | "new30" | "leads" | "news_ok" | "extensions" | "messages", number>;
type Data = { totals: Totals; people: Person[]; messages: Message[] };

const TABS = [
  ["overview", "Overview"],
  ["people", "People"],
  ["usage", "Usage"],
  ["access", "Access codes"],
  ["creators", "Creators"],
  ["offers", "Offers"],
  ["ai", "AI"],
  ["assistant", "Assistant"],
  ["google", "Google sign-in"],
  ["verifier", "Email verifier"],
  ["messages", "Messages"],
] as const;
const STATE_NAMES: Record<State, string> = { trial: "On trial", ended: "Trial ended", paid: "Paying", free: "Free access" };
const day = (s: string | null) => (s ? new Date(s).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—");

const DEMO_OWNER_DATA: Data = {
  totals: {
    people: 38,
    teams: 14,
    trial: 12,
    ended: 8,
    paid: 14,
    free: 4,
    starter: 5,
    pro: 7,
    agency: 2,
    mrr: 2840,
    new7: 9,
    new30: 24,
    leads: 18450,
    news_ok: 29,
    extensions: 6,
    messages: 3,
  },
  people: [
    { email: "david.kim@summit-agency.test", name: "David Kim", job: "Founder & Lead Strategist", role: "owner", team: "Summit Media Group", state: "paid", plan: "pro", trial_ends_at: "2026-11-20T00:00:00.000Z", paid_until: "2027-11-20T00:00:00.000Z", billing_status: "active", access_until: null, joined_at: "2026-10-15T09:30:00.000Z", last_seen: "2026-11-23T08:15:00.000Z", leads: 420, last_lead: "2026-11-23T08:10:00.000Z", country: "United States", size: "6–10", website: "summit-agency.test", heard_from: "Twitter / X recommendation", news_ok: true },
    { email: "claire.dupont@atelier-motion.test", name: "Claire Dupont", job: "Creative Director", role: "owner", team: "Atelier Motion Studio", state: "free", plan: "agency", trial_ends_at: "2026-11-10T00:00:00.000Z", paid_until: null, billing_status: null, access_until: "2027-02-10T00:00:00.000Z", joined_at: "2026-11-02T11:20:00.000Z", last_seen: "2026-11-23T07:45:00.000Z", leads: 890, last_lead: "2026-11-23T07:40:00.000Z", country: "France", size: "2–5", website: "atelier-motion.test", heard_from: "Affan YouTube breakdown", news_ok: true }
  ],
  messages: []
};

export default function OwnerView({ toast, demo }: { toast: (t: string) => void; demo?: boolean }) {
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("overview");
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [msg] = useState("");
  const [q, setQ] = useState("");
  const [state, setState] = useState<"" | State>("");
  const [newsOnly, setNewsOnly] = useState(false);
  const [now] = useState(() => Date.now());
  const [allSlotsSet, setAllSlotsSet] = useState(false);
  const [planFor, setPlanFor] = useState<{ team: string; name: string; plan: PlanId; days: number } | null>(null);
  // Owner → People → Change plan (database 049): free access of Starter, Pro or Agency for some days, or take it back.
  async function changePlan(clear = false) {
    if (!planFor) return;
    const { error } = clear ? await supabaseBrowser().rpc("admin_clear_team_plan", { t: planFor.team })
      : await supabaseBrowser().rpc("admin_set_team_plan", { t: planFor.team, p: planFor.plan, days: planFor.days });
    if (error) { toast(/admin_set_team_plan|admin_clear_team_plan|schema cache/i.test(error.message) ? "Changing plans needs database 049." : error.message); return; }
    toast(clear ? `${planFor.name}: free access taken back.` : `${planFor.name}: ${planName(planFor.plan)} for ${planFor.days} days.`);
    setPlanFor(null); load();
  }

  const load = useCallback(async () => {
    if (demo) {
      setData(DEMO_OWNER_DATA);
      setLoading(false);
      setErrorMsg(null);
      return;
    }
    setLoading(true);
    setErrorMsg(null);
    try {
      const { data: d, error } = await supabaseBrowser().rpc("admin_overview");
      if (error) {
        setErrorMsg(error.message || "You don't have access.");
        setData(null);
        setLoading(false);
        return;
      }
      if (!d) {
        setErrorMsg("You don't have access.");
        setData(null);
        setLoading(false);
        return;
      }
      setData(d as Data);
      setLoading(false);
      // Check if all 3 AI slots are set to hide legacy Assistant tab
      try {
        const { data: slotRows } = await supabaseBrowser().from("ai_slots").select("slot,model,secret_id,enabled");
        if (Array.isArray(slotRows)) {
          const readyCount = slotRows.filter(
            (r: { slot: string; model?: string; secret_id?: string | null; enabled?: boolean }) =>
              r.enabled !== false && Boolean(r.secret_id) && Boolean(r.model?.trim())
          ).length;
          setAllSlotsSet(readyCount >= 3);
        }
      } catch {
        // 077 not applied yet
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "You don't have access.";
      setErrorMsg(msg);
      setData(null);
      setLoading(false);
    }
  }, [demo]);
  useEffect(() => { Promise.resolve().then(load); }, [load]);

  const people = useMemo(() => (data?.people ?? []).filter((p) =>
    (!state || p.state === state) && (!newsOnly || p.news_ok) &&
    (!q || [p.email, p.name, p.team, p.country, p.job].some((v) => String(v ?? "").toLowerCase().includes(q.toLowerCase())))), [data, state, newsOnly, q]);

  function exportCsv() {
    const head = ["Email", "Name", "Job title", "Role", "Team", "Status", "Plan", "Trial ends", "Paid until", "Free access until", "Joined", "Last sign-in", "Leads", "Country", "Team size", "Website", "Found us", "News and offers"];
    const rows = people.map((p) => [p.email, p.name, p.job, p.role, p.team, STATE_NAMES[p.state], p.state === "paid" ? planName(p.plan as PlanId) : "", day(p.trial_ends_at), p.paid_until ? day(p.paid_until) : "",
      p.access_until ? day(p.access_until) : "", day(p.joined_at), p.last_seen ? day(p.last_seen) : "", p.leads, p.country, p.size, p.website, p.heard_from, p.news_ok ? "yes" : "no"]);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([[head, ...rows].map((r) => r.map(csvCell).join(",")).join("\n")], { type: "text/csv" }));
    a.download = `kestrel-people-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    toast(`Exported ${people.length} people.`);
  }
  async function copyEmails() {
    const list = [...new Set(people.filter((p) => p.news_ok).map((p) => p.email))];
    await navigator.clipboard.writeText(list.join(", "));
    toast(`Copied ${list.length} emails of people who said yes to offers.`);
  }

  const t = data?.totals;
  const tiles: [string, string | number, string][] = t ? [
    ["Monthly revenue", `$${t.mrr.toLocaleString()}`, "From paying teams at full price (the launch discount is not taken off)."],
    ["Paying teams", t.paid, `${t.starter} Starter · ${t.pro} Pro · ${t.agency} Agency`],
    ["On free trial", t.trial, "Trial still running."],
    ["Trial ended, not paying", t.ended, "Good people to send an offer to (if they said yes to offers)."],
    ["Free access", t.free, "Teams using an access code right now."],
    ["People", t.people, `${t.teams} teams · ${t.new7} new this week · ${t.new30} this month`],
    ["Said yes to offers", t.news_ok, "Only these people may get news and discount emails."],
    ["Leads collected", t.leads.toLocaleString(), `${t.extensions} extensions active this week`],
  ] : [];

  return (
    <div className="app-page">
      <header className="head"><div><h1>Owner <Tip text="Only you (Kestrel admins) can see this page: the business at a glance, everyone using Kestrel, access codes and contact messages." /></h1>
        <span className="sub">{t ? `${t.people} people · ${t.paid} paying · $${t.mrr} a month` : "Loading…"}</span></div></header>
      <div className="owner-tabs seg" role="tablist" aria-label="Owner tabs">{TABS.filter(([id]) => !(allSlotsSet && id === "assistant")).map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "on" : ""} onClick={() => setTab(id)}>{label}{id === "messages" && t?.messages ? ` (${t.messages})` : ""}</button>)}</div>

      {tab === "access" ? <AccessView toast={toast} embedded /> : null}
      {tab === "ai" ? <OwnerAi toast={toast} demo={demo} onSlotsStatus={setAllSlotsSet} /> : null}
      {tab === "assistant" ? <OwnerAssistant toast={toast} demo={demo} /> : null}
      {tab === "google" ? <OwnerGoogle toast={toast} /> : null}
      {tab === "creators" ? <CreatorsView toast={toast} /> : null}
      {tab === "verifier" ? <OwnerVerifier toast={toast} /> : null}
      {tab === "offers" ? <OwnerOffers toast={toast} /> : null}
      {tab === "usage" ? <OwnerUsage toast={toast} /> : null}

      {tab === "overview" && errorMsg ? (
        <div className="join-card" style={{ margin: "20px 0", padding: "24px", textAlign: "center" }}>
          <p className="plan-msg" style={{ margin: 0, color: "var(--bad, #dc2626)" }}><b>Access Denied:</b> {errorMsg}</p>
          <p className="sub" style={{ margin: "8px 0 0" }}>Only platform administrators have access to Kestrel overview metrics.</p>
        </div>
      ) : null}

      {tab === "overview" && loading && !errorMsg ? (
        <p className="sub" style={{ margin: "20px 0" }}>Loading platform metrics…</p>
      ) : null}

      {tab === "overview" && t ? (
        <>
          <div className="owner-tiles">{tiles.map(([label, value, note]) => <div className="owner-tile" key={label}><small>{label}</small><b>{value}</b><span>{note}</span></div>)}</div>
          <div className="table-card members">
            <table className="leads">
              <thead><tr><th>Newest people</th><th>Team</th><th>Status</th><th>Joined</th></tr></thead>
              <tbody>{(data?.people ?? []).slice(0, 8).map((p) => <tr key={p.email + p.team}><td>{p.email}</td><td>{p.team}</td><td>{STATE_NAMES[p.state]}</td><td>{day(p.joined_at)}</td></tr>)}</tbody>
            </table>
          </div>
        </>
      ) : null}

      {tab === "people" && data ? (
        <>
          <div className="owner-bar">
            <input className="owner-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search email, name, team, country" aria-label="Search people" />
            <div className="seg">{([["", "All"], ["paid", "Paying"], ["trial", "Trial"], ["ended", "Ended"], ["free", "Free"]] as const).map(([v, l]) => <button key={v} type="button" className={state === v ? "on" : ""} onClick={() => setState(v)}>{l}</button>)}</div>
            <label className="owner-check"><input type="checkbox" checked={newsOnly} onChange={(e) => setNewsOnly(e.target.checked)} /> Said yes to offers</label>
            <button className="btn small glass" type="button" onClick={exportCsv}>Export CSV ({people.length})</button>
            <button className="btn small go" type="button" onClick={copyEmails}>Copy emails for an offer</button>
          </div>
          <p className="plan-msg owner-note">To send a special discount: copy the emails (only people who said yes to offers are copied), make a code in Lemon Squeezy → Discounts, and send it from your email tool. Always include a way to unsubscribe.</p>
          <div className="table-card members">
            <table className="leads">
              <thead><tr><th>Person</th><th>Team</th><th>Status</th><th>Leads</th><th>Joined</th><th>Last sign-in</th><th>Offers</th><th><span className="sr-only">Plan</span></th></tr></thead>
              <tbody>{people.map((p) => (
                <tr key={p.email + p.team}>
                  <td><b>{p.email}</b><small className="muted-line">{[p.name, p.job, p.country].filter(Boolean).join(" · ")}</small></td>
                  <td>{p.team}<small className="muted-line">{p.role}{p.size ? ` · ${p.size} people` : ""}</small></td>
                  <td>{STATE_NAMES[p.state]}<small className="muted-line">{p.state === "paid" ? `${planName(p.plan as PlanId)} · until ${day(p.paid_until)}` : p.state === "free" ? `until ${day(p.access_until)}` : p.state === "trial" ? `${Math.max(0, Math.ceil((Date.parse(p.trial_ends_at) - now) / 864e5))} days left` : `ended ${day(p.trial_ends_at)}`}</small></td>
                  <td>{p.leads.toLocaleString()}</td><td>{day(p.joined_at)}</td><td>{day(p.last_seen)}</td><td>{p.news_ok ? "Yes" : "No"}</td>
                  <td>{p.team_id && p.role === "owner" ? <button type="button" className="link-btn" onClick={() => setPlanFor({ team: p.team_id!, name: p.team, plan: (["starter", "pro", "agency"].includes(p.plan) ? p.plan : "pro") as PlanId, days: 30 })}>Change plan</button> : null}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          {planFor ? (
            <section className="join-card owner-plan" role="dialog" aria-label={`Change plan: ${planFor.name}`}>
              <b>Change plan: {planFor.name} <Tip text="Gives this team the plan as free access for the days you choose (like an access code, without a code). It replaces their current free access. A paying team's Lemon Squeezy subscription is not changed: that stays in Lemon Squeezy." /></b>
              <div className="join-row">
                <label className="in"><span>Plan</span><select value={planFor.plan} onChange={(e) => setPlanFor({ ...planFor, plan: e.target.value as PlanId })}>
                  <option value="starter">Starter</option><option value="pro">Pro</option><option value="agency">Agency</option></select></label>
                <label className="in"><span>For how long</span><select value={planFor.days} onChange={(e) => setPlanFor({ ...planFor, days: Number(e.target.value) })}>
                  {[7, 14, 30, 90, 180, 365, 730].map((d) => <option key={d} value={d}>{d < 365 ? `${d} days` : `${d / 365} year${d > 365 ? "s" : ""}`}</option>)}</select></label>
                <button type="button" className="btn go small" onClick={() => changePlan()}>Save</button>
                <button type="button" className="link-btn bad" onClick={() => changePlan(true)}>Take back free access</button>
                <button type="button" className="link-btn" onClick={() => setPlanFor(null)}>Cancel</button>
              </div>
            </section>
          ) : null}
        </>
      ) : null}

      {tab === "messages" && data ? (
        data.messages.length ? (
          <div className="owner-msgs">{data.messages.map((m, i) => (
            <article className="join-card" key={i}>
              <div className="owner-msg-top"><b>{m.name}{m.company ? ` · ${m.company}` : ""}</b><span>{m.topic} · {new Date(m.at).toLocaleString()}</span></div>
              <p className="owner-msg">{m.message}</p>
              <div className="join-row"><a className="btn small glass" href={`mailto:${m.email}?subject=${encodeURIComponent("Re: your message to Kestrel")}`}>Reply to {m.email}</a></div>
            </article>
          ))}</div>
        ) : <p className="plan-msg">No contact messages yet.</p>
      ) : null}

      {msg ? <p className="plan-msg" role="alert">{msg}</p> : null}
    </div>
  );
}
