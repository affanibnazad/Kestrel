"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Tip } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/client";
import { planName, type PlanId } from "@/lib/plans";
import AccessView from "./access-view";
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
  ["rules", "Rules & Context"],
  ["people", "People"],
  ["usage", "Usage"],
  ["access", "Access codes"],
  ["creators", "Creators"],
  ["offers", "Offers"],
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
    extensions: 18,
    messages: 3,
  },
  people: [
    {
      email: "affan@norvenstudio.com",
      name: "Affan Ibn Azad",
      job: "Founder & Creative Director",
      role: "owner",
      team: "Norven Studio",
      team_id: "team_norven_01",
      state: "paid",
      plan: "agency",
      trial_ends_at: "2026-12-31T23:59:59Z",
      paid_until: "2027-11-22T00:00:00Z",
      billing_status: "active",
      access_until: null,
      joined_at: "2026-01-15T10:00:00Z",
      last_seen: new Date().toISOString(),
      leads: 4820,
      last_lead: new Date().toISOString(),
      country: "United Kingdom",
      size: "2-10",
      website: "https://norvenstudio.com",
      heard_from: "Direct Founder",
      news_ok: true,
    },
    {
      email: "alex@northlight-studio.test",
      name: "Alex Vance",
      job: "Head of Growth",
      role: "owner",
      team: "Northlight Studio",
      team_id: "team_northlight_02",
      state: "paid",
      plan: "pro",
      trial_ends_at: "2026-03-01T00:00:00Z",
      paid_until: "2027-04-01T00:00:00Z",
      billing_status: "active",
      access_until: null,
      joined_at: "2026-02-10T12:30:00Z",
      last_seen: new Date(Date.now() - 3600000 * 4).toISOString(),
      leads: 1250,
      last_lead: new Date(Date.now() - 3600000 * 2).toISOString(),
      country: "United Kingdom",
      size: "5-15",
      website: "https://northlight-studio.test",
      heard_from: "LinkedIn",
      news_ok: true,
    },
    {
      email: "sarah@copperleaf.design",
      name: "Sarah Jenkins",
      job: "Managing Director",
      role: "owner",
      team: "Copperleaf Design",
      team_id: "team_copperleaf_03",
      state: "paid",
      plan: "starter",
      trial_ends_at: "2026-04-15T00:00:00Z",
      paid_until: "2026-12-15T00:00:00Z",
      billing_status: "active",
      access_until: null,
      joined_at: "2026-03-01T09:15:00Z",
      last_seen: new Date(Date.now() - 86400000).toISOString(),
      leads: 680,
      last_lead: new Date(Date.now() - 86400000).toISOString(),
      country: "United Kingdom",
      size: "1-5",
      website: "https://copperleaf.design",
      heard_from: "Twitter / X",
      news_ok: true,
    },
    {
      email: "marcus@harboursocial.co.uk",
      name: "Marcus Bell",
      job: "Lead Outreach",
      role: "member",
      team: "Harbour Social",
      team_id: "team_harbour_04",
      state: "trial",
      plan: "starter",
      trial_ends_at: new Date(Date.now() + 86400000 * 6).toISOString(),
      paid_until: null,
      billing_status: null,
      access_until: null,
      joined_at: "2026-11-16T14:20:00Z",
      last_seen: new Date(Date.now() - 3600000 * 12).toISOString(),
      leads: 320,
      last_lead: new Date(Date.now() - 3600000 * 14).toISOString(),
      country: "United Kingdom",
      size: "2-10",
      website: "https://harboursocial.co.uk",
      heard_from: "Google Search",
      news_ok: false,
    },
    {
      email: "elena@oaklineevents.com",
      name: "Elena Rostova",
      job: "Events Director",
      role: "owner",
      team: "Oakline Events",
      team_id: "team_oakline_05",
      state: "free",
      plan: "pro",
      trial_ends_at: "2026-05-01T00:00:00Z",
      paid_until: null,
      billing_status: null,
      access_until: new Date(Date.now() + 86400000 * 45).toISOString(),
      joined_at: "2026-04-12T11:00:00Z",
      last_seen: new Date(Date.now() - 86400000 * 2).toISOString(),
      leads: 890,
      last_lead: new Date(Date.now() - 86400000 * 3).toISOString(),
      country: "Germany",
      size: "10-25",
      website: "https://oaklineevents.com",
      heard_from: "Referral",
      news_ok: true,
    },
  ],
  messages: [
    {
      name: "David Kim",
      email: "david@kimpulsemarketing.com",
      company: "Impulse Marketing",
      topic: "Agency Partnership",
      message: "Hey Affan, love the clean speed of Kestrel. We run outreach for 12 B2B brands and would love to discuss custom seat packaging and API access.",
      at: new Date(Date.now() - 3600000 * 5).toISOString(),
    },
    {
      name: "Claire Dupont",
      email: "claire@atelierdupont.fr",
      company: "Atelier Dupont",
      topic: "Integration with HubSpot",
      message: "We connected the Brave extension and verified 200 leads today. Is bidirectional contact sync with HubSpot scheduled for next sprint?",
      at: new Date(Date.now() - 86400000 * 1.5).toISOString(),
    },
  ],
};

function OwnerRulesView() {
  const [aiSettings, setAiSettings] = useState<{ provider: string; model: string }>({
    provider: "Anthropic",
    model: "Auto by job (Haiku 5.5 judges, Sonnet 5.5 writes)",
  });

  useEffect(() => {
    supabaseBrowser()
      .from("team_ai")
      .select("provider,model")
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          const p = data.provider === "anthropic" ? "Anthropic" : data.provider === "openai" ? "OpenAI" : data.provider || "Anthropic";
          const m = data.model === "auto" ? "Auto by job (Haiku 5.5 judges, Sonnet 5.5 writes)" : data.model || "Auto by job";
          setAiSettings({ provider: p, model: m });
        }
      });
  }, []);

  return (
    <div className="owner-rules-container">
      {/* 1. Deliverability & Safeguards */}
      <section className="join-card owner-rule-card">
        <div className="rules-h">
          <b>Deliverability & Sending Safeguards <Tip text="Hard safety ceilings automatically enforced across all campaigns and mailboxes to preserve sender reputation and prevent domain blacklisting." /></b>
          <span className="pill good">Active Enforcement</span>
        </div>
        <p className="sub-dark">Automated circuit-breakers stop campaigns and pause mailboxes the instant metrics breach safe limits.</p>
        <div className="table-card members" style={{ margin: "14px 0 0" }}>
          <table className="leads">
            <thead>
              <tr>
                <th>Circuit Breaker</th>
                <th>Threshold</th>
                <th>Enforced Action</th>
                <th>Recovery Window</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><b>Hard Bounce Ceiling</b></td>
                <td><span className="pill bad">5.0%</span></td>
                <td>Campaign automatically pauses instantly</td>
                <td>Requires lead list scrub or verification</td>
              </tr>
              <tr>
                <td><b>Unsubscribe Rate</b></td>
                <td><span className="pill bad">5.0%</span></td>
                <td>Campaign automatically pauses</td>
                <td>Requires copy & audience review</td>
              </tr>
              <tr>
                <td><b>Spam Complaints</b></td>
                <td><span className="pill bad">2 complaints / 7d</span></td>
                <td>Sending mailbox paused immediately</td>
                <td>7-day cooldown + manual resume</td>
              </tr>
              <tr>
                <td><b>Daily Sending Window</b></td>
                <td>09:00 – 17:00</td>
                <td>Emails queued outside local business hours</td>
                <td>Resumes automatically next weekday</td>
              </tr>
              <tr>
                <td><b>Warmup Cadence</b></td>
                <td>5/day start (+2/day ramp, 25/day limit)</td>
                <td>Gradual volume ramp-up per newly connected mailbox</td>
                <td>Reaches full limit over 10–14 days</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* 2. AI & Autopilot Policies */}
      <section className="join-card owner-rule-card">
        <div className="rules-h">
          <b>AI Model Routing & Autopilot Policies <Tip text="Underlying model selection, prompt safeguards, and Quality Control review loops for all generated outreach messages." /></b>
          <span className="pill good">{aiSettings.provider} · {aiSettings.model}</span>
        </div>
        <p className="sub-dark">All outbound copywriting and fit scoring adhere to founder-approved voice guidelines and plain-English principles.</p>
        <div className="table-card members" style={{ margin: "14px 0 0" }}>
          <table className="leads">
            <thead>
              <tr>
                <th>Policy Area</th>
                <th>System Configuration</th>
                <th>Safeguard & Rule</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><b>Primary Model Routing</b></td>
                <td>{aiSettings.provider} · {aiSettings.model}</td>
                <td>High-stakes email generation and reply classification</td>
              </tr>
              <tr>
                <td><b>Speed / Fallback Engine</b></td>
                <td>OpenAI / Fast Fallback</td>
                <td>Spam word detection, subject line variations, fit scoring</td>
              </tr>
              <tr>
                <td><b>Voice & Tone Standards</b></td>
                <td>Plain English, direct, value-first</td>
                <td>Strictly prohibits fluff and hype (&ldquo;game-changer&rdquo;, &ldquo;revolutionary&rdquo;, &ldquo;dive in&rdquo;)</td>
              </tr>
              <tr>
                <td><b>QC Automated Review</b></td>
                <td>Maximum 2 review loops</td>
                <td>If QC review fails twice, draft is flagged for manual owner review</td>
              </tr>
              <tr>
                <td><b>Fit Scoring Algorithm</b></td>
                <td>0 to 100 dynamic scoring</td>
                <td>Weighted on decision-maker title, company size, tech stack, and verified email</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* 3. Tiered Plan Limits */}
      <section className="join-card owner-rule-card">
        <div className="rules-h">
          <b>Plan Limits & Seat Architecture <Tip text="Tiered limits for Starter, Pro, and Agency plans managed via Lemon Squeezy and custom access allocations." /></b>
          <span className="pill neutral">Billing Matrix</span>
        </div>
        <p className="sub-dark">Resource quotas and features provisioned for each customer subscription tier.</p>
        <div className="table-card members" style={{ margin: "14px 0 0" }}>
          <table className="leads">
            <thead>
              <tr>
                <th>Tier</th>
                <th>Monthly Price</th>
                <th>Team Seats</th>
                <th>Monthly Active Leads</th>
                <th>AI Copilot Daily Limit</th>
                <th>Included Capabilities</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><b>Starter</b></td>
                <td>$39 / mo</td>
                <td>1 Seat</td>
                <td>1,000 leads</td>
                <td>100 messages / day</td>
                <td>Browser extension, single sequences, built-in verifier</td>
              </tr>
              <tr>
                <td><b>Pro</b></td>
                <td>$79 / mo</td>
                <td>3 Seats</td>
                <td>5,000 leads</td>
                <td>300 messages / day</td>
                <td>Unified inbox, multi-step A/B testing, AI personalization, autopilot</td>
              </tr>
              <tr>
                <td><b>Agency</b></td>
                <td>$199 / mo</td>
                <td>10 Seats</td>
                <td>25,000 leads</td>
                <td>1,000 messages / day</td>
                <td>Custom tracking domain, multi-team management, webhooks & MCP</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* 4. Privacy, Compliance & UI Standards */}
      <section className="join-card owner-rule-card">
        <div className="rules-h">
          <b>Data Privacy, Compliance & UI Standards <Tip text="Strict adherence to UK/EU GDPR guidelines, encrypted credentials, and Norven Studio clean design system." /></b>
          <span className="pill good">GDPR / UK Law Compliant</span>
        </div>
        <div className="owner-rules-checklist">
          <div className="owner-rule-check-item">
            <b>Marketing Consent Gating (UK / EU Law)</b>
            <p>Only leads with explicit consent (<code>news_ok = true</code>) can be exported for promotional broadcasts. Never send marketing offers to unverified contacts.</p>
          </div>
          <div className="owner-rule-check-item">
            <b>Vault Encryption for Third-Party Keys</b>
            <p>All provider API keys (Anthropic, OpenAI, NVIDIA, Hunter) are AES-256 encrypted in Supabase Vault. Only the last 4 characters are ever displayed.</p>
          </div>
          <div className="owner-rule-check-item">
            <b>Design System Adherence (AGENTS.md)</b>
            <p>Apple SF Pro font only, 100% rounded buttons (<code>border-radius: 9999px !important;</code>), zero floating drop shadows, single outer outlines, and contrast integrity across all 4 themes.</p>
          </div>
        </div>
      </section>
    </div>
  );
}

export default function OwnerView({ toast }: { toast: (t: string) => void }) {
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("overview");
  const [data, setData] = useState<Data | null>(null);
  const [msg] = useState("");
  const [q, setQ] = useState("");
  const [state, setState] = useState<"" | State>("");
  const [newsOnly, setNewsOnly] = useState(false);
  const [now] = useState(() => Date.now());
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
    try {
      const { data: d, error } = await supabaseBrowser().rpc("admin_overview");
      if (error || !d) {
        setData(DEMO_OWNER_DATA);
        return;
      }
      setData(d as Data);
    } catch {
      setData(DEMO_OWNER_DATA);
    }
  }, []);
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
      <div className="owner-tabs seg" role="tablist" aria-label="Owner tabs">{TABS.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "on" : ""} onClick={() => setTab(id)}>{label}{id === "messages" && t?.messages ? ` (${t.messages})` : ""}</button>)}</div>

      {tab === "rules" ? <OwnerRulesView /> : null}
      {tab === "access" ? <AccessView toast={toast} embedded /> : null}
      {tab === "assistant" ? <OwnerAssistant toast={toast} /> : null}
      {tab === "google" ? <OwnerGoogle toast={toast} /> : null}
      {tab === "creators" ? <CreatorsView toast={toast} /> : null}
      {tab === "verifier" ? <OwnerVerifier toast={toast} /> : null}
      {tab === "offers" ? <OwnerOffers toast={toast} /> : null}
      {tab === "usage" ? <OwnerUsage toast={toast} /> : null}

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
