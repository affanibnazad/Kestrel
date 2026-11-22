"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Line, Tip } from "@/components/ui";
import type { LeadRow } from "@/lib/leads";
import { MAILBOX_COLUMNS, type Mailbox } from "@/lib/mail";
import { CAMPAIGN_COLUMNS, CAMPAIGN_COLUMNS_M2, CAMPAIGN_COLUMNS_M3, STATUS_NAMES, TIME_ZONES, rate, testOk, type BoxToday, type Campaign, type CampaignLeadStatus, type CampaignStatus } from "@/lib/campaign";
import { cleanSteps } from "@/lib/sequence";
import CampaignDetail, { type Count, type Draft, type Seq } from "./campaign-detail";

// Mail → Campaigns, organised like the leading tools: a list with each campaign's progress and replies; click one for
// its tabs (Analytics · Leads · Sequences · Schedule · Options). The database's timer sends a few emails every minute
// inside the sending hours, at most each account's daily limit, follow-ups only to people who did not reply.
type Acct = { team_id: string; role: string } | null;
type Show = "all" | CampaignStatus;
const HELP = "A campaign sends each lead's written emails (first email, then follow-ups) from your email accounts. Kestrel sends a few each minute inside your sending hours, at most each account's daily limit (25 is safe), one email every 3 to 7 minutes per account. Follow-ups stop when someone replies. Do-not-contact leads are never emailed.";
const tally = (rows: { campaign_id: string; status: CampaignLeadStatus; first_sent_at: string | null }[]) => {
  const out: Record<string, Count> = {};
  for (const r of rows) {
    const k = (out[r.campaign_id] ??= {}); k[r.status] = (k[r.status] ?? 0) + 1; k.total = (k.total ?? 0) + 1;
    if (r.first_sent_at) k.started = (k.started ?? 0) + 1;
  }
  return out;
};
// Waiting or finished = grey, sending = green, paused = amber, stopped = red (a "not started" draft is not an error).
const PILL: Record<CampaignStatus, string> = { running: "good", paused: "maybe", draft: "muted", stopped: "no", done: "muted" };

export default function CampaignsView({ account, leads, demo, editable, toast, blocked, go, me = "", lists = [], inList = {} }: {
  account: Acct; leads: LeadRow[]; demo: boolean; editable: boolean; toast: (t: string) => void; blocked: (l: LeadRow) => boolean; go: (view: string) => void;
  me?: string; lists?: { id: string; name: string }[]; inList?: Record<string, string[]>;
}) {
  const [list, setList] = useState<Campaign[]>([]);
  const [counts, setCounts] = useState<Record<string, Count>>({});
  // Which campaigns each lead is already in (a lead is added to campaign_leads only when its campaign starts).
  const [usedIn, setUsedIn] = useState<Map<string, string[]>>(new Map());
  const [sequences, setSequences] = useState<Seq[]>([]);
  const [boxes, setBoxes] = useState<Mailbox[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [tracking, setTracking] = useState(false);
  const [today, setToday] = useState<Record<string, BoxToday>>({});
  const [hunter, setHunter] = useState(false);
  const [now, setNow] = useState(0);   // set after the first render (no clock during prerender)
  useEffect(() => { Promise.resolve().then(() => setNow(Date.now())); }, []);
  const [missing, setMissing] = useState(false);
  // The open campaign is in the address (?view=campaigns&c=<id>), so it can be bookmarked and Back closes it.
  const [open, setOpenState] = useState<string | null>(null);
  const setOpen = useCallback((id: string | null) => {
    setOpenState(id);
    try { const u = new URL(location.href); if (id) u.searchParams.set("c", id); else u.searchParams.delete("c"); history.pushState(null, "", `${u.pathname}${u.search}`); } catch { /* fine */ }
  }, []);
  // Tell the sidebar which campaign was opened, so it can show it under "Recent".
  useEffect(() => {
    if (!open) return;
    const c = list.find((x) => x.id === open);
    if (c?.name) window.dispatchEvent(new CustomEvent("kestrel-open-campaign", { detail: { name: c.name, id: c.id } }));
  }, [open, list]);
  // The sidebar's "New campaign" button, and a "Recent" link that opens a campaign by id.
  const [naming, setNaming] = useState<string | null>(null);
  useEffect(() => {
    const onNew = () => setNaming("");
    const onId = (e: Event) => { const id = (e as CustomEvent).detail?.id as string | undefined; if (id) setOpen(id); };
    window.addEventListener("kestrel-new-campaign", onNew);
    window.addEventListener("kestrel-open-campaign-id", onId);
    return () => { window.removeEventListener("kestrel-new-campaign", onNew); window.removeEventListener("kestrel-open-campaign-id", onId); };
  }, [setOpen]);
  useEffect(() => {
    const read = () => { const c = new URLSearchParams(location.search).get("c"); setOpenState(c && /^([0-9a-f-]{36}|demo-[a-z])$/i.test(c) ? c : null); };
    read(); window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, []);
  useEffect(() => {
    if (open && list.length > 0 && !list.some((c) => c.id === open)) {
      Promise.resolve().then(() => setOpenState(null));
      try {
        const u = new URL(location.href);
        if (u.searchParams.has("c")) {
          u.searchParams.delete("c");
          history.replaceState(null, "", `${u.pathname}${u.search}`);
        }
      } catch { /* fine */ }
    }
  }, [list, open]);
  const [q, setQ] = useState("");
  const [show, setShow] = useState<Show>("all");
  const [layout, setLayoutState] = useState<"grid" | "list">("grid");
  useEffect(() => { try { const v = localStorage.getItem("kestrel-camp-layout"); if (v === "list") Promise.resolve().then(() => setLayoutState("list")); } catch { /* fine */ } }, []);
  const setLayout = (v: "grid" | "list") => { setLayoutState(v); try { localStorage.setItem("kestrel-camp-layout", v); } catch { /* fine */ } };
  const sb = supabaseBrowser;

  const activeTeamRef = useRef(account?.team_id);
  const reqGenRef = useRef(0);
  useEffect(() => {
    if (account?.team_id !== activeTeamRef.current) {
      activeTeamRef.current = account?.team_id;
      reqGenRef.current += 1;
    }
  }, [account?.team_id]);

  // The campaign list with the M2 options (026); the older columns before 026 is run.
  const campaignsQuery = useCallback(async () => {
    // Newest columns first (051), then M2 (026), then the oldest set: the App works before each database step.
    for (const cols of [CAMPAIGN_COLUMNS_M3, CAMPAIGN_COLUMNS_M2]) {
      const r = await sb().from("campaigns").select(cols).order("created_at", { ascending: false });
      if (!r.error) return r;
    }
    return sb().from("campaigns").select(CAMPAIGN_COLUMNS).order("created_at", { ascending: false });
  }, [sb]);

  // Recently deleted campaigns, with who and when (database 054). Missing function = older database: just hidden.
  type Deleted = { campaign_id: string; name: string; status: string; leads: number; sent: number; deleted_at: string; deleted_by: string; can_restore: boolean };
  const [deleted, setDeleted] = useState<Deleted[] | null>(null);
  const loadDeleted = useCallback(async () => {
    if (demo || !account) return;
    const currentGen = reqGenRef.current;
    const currentTeam = account.team_id;
    const { data, error } = await sb().rpc("campaign_deletions_list");
    if (reqGenRef.current !== currentGen || activeTeamRef.current !== currentTeam) return;
    if (!error) setDeleted((data ?? []) as Deleted[]);
  }, [demo, account, sb]);
  const load = useCallback(async () => {
    if (demo || !account) {
      setSequences([{ id: "demo-seq", name: "Agencies (example)", weekdays_only: true }]);
      setBoxes([{ id: "demo-1", email: "alex@northlight-studio.test", status: "ok", imap_ok: true, daily_limit: 25 } as Mailbox]);
      const t = new Date().toISOString();
      setList([
        { id: "demo-c", team_id: "demo", name: "Video agencies, London (example)", sequence_id: "demo-seq", mailbox_ids: ["demo-1"], status: "running", time_zone: "Europe/London",
          window_start: 9, window_end: 17, weekdays_only: true, track_opens: true, verify_emails: true, lead_time_zone: true, stop_company: true, paused_reason: null, tested_at: t, started_at: t, created_at: t },
        { id: "demo-d", team_id: "demo", name: "Cafés, Manchester (example)", sequence_id: "demo-seq", mailbox_ids: ["demo-1"], status: "draft", time_zone: "Europe/London",
          window_start: 9, window_end: 17, weekdays_only: true, track_opens: false, verify_emails: true, lead_time_zone: true, stop_company: true, paused_reason: null, tested_at: null, started_at: null, created_at: t },
      ]);
      setCounts({ "demo-c": { total: 40, started: 30, active: 31, done: 4, replied: 3, unsubscribed: 1, bounced: 1 } });
      setDrafts(leads.filter((l) => l.email).map((l) => ({ id: l.id, email: l.email, name: l.name, outreach: { body: "Hey…", steps: [{ day: 0, subject: "quick question", body: `Hey ${l.name},\n\nSaw your work…\n\nNot relevant? Reply "no" and I won't write again.` }, { day: 5, subject: "", body: `Hey ${l.name},\n\nA quick follow-up…\n\nNot relevant? Reply "no" and I won't write again.` }] } })));
      return;
    }
    const currentGen = reqGenRef.current;
    const currentTeam = account.team_id;
    const isCurrent = () => reqGenRef.current === currentGen && activeTeamRef.current === currentTeam;

    const [c, s, b, t, k] = await Promise.all([
      campaignsQuery(),
      sb().from("sequences").select("id,name,weekdays_only,steps").order("name"),
      sb().from("mailboxes").select(`${MAILBOX_COLUMNS},ramp_up`).eq("team_id", account.team_id).order("created_at"),
      sb().rpc("mailbox_today"),
      sb().rpc("list_team_keys"),
    ]);
    if (!isCurrent()) return;
    if (c.error) { setMissing(true); return; }
    setList((c.data as unknown as Campaign[]) ?? []);
    setSequences(((s.data ?? []) as (Seq & { steps?: unknown })[]).map((x) => ({ ...x, steps: cleanSteps(x.steps) })));
    // ramp_up is read when the database has it (019); otherwise the plain columns.
    const boxRows = b.error ? (await sb().from("mailboxes").select(MAILBOX_COLUMNS).eq("team_id", account.team_id).order("created_at")).data : b.data;
    if (!isCurrent()) return;
    setBoxes((boxRows as Mailbox[] | null) ?? []);
    const ramp = new Map(((boxRows ?? []) as { id: string; ramp_up?: boolean }[]).map((x) => [x.id, x.ramp_up]));
    setToday(Object.fromEntries(((t.data ?? []) as { id: string; limit_today: number }[]).map((x) => [x.id, { daily_limit: 0, limit_today: x.limit_today, ramp_up: ramp.get(x.id) ?? true }])));
    setHunter(((k.data ?? []) as { service: string }[]).some((x) => x.service === "hunter"));
    const { data: rows } = await sb().from("campaign_leads").select("campaign_id,lead_id,status,first_sent_at").limit(20000);
    if (!isCurrent()) return;
    setCounts(tally((rows ?? []) as Parameters<typeof tally>[0]));
    const used = new Map<string, string[]>();
    for (const r of (rows ?? []) as { campaign_id: string; lead_id: string | null }[]) if (r.lead_id) used.set(r.lead_id, [...(used.get(r.lead_id) ?? []), r.campaign_id]);
    setUsedIn(used);
    const { data: tr } = await sb().rpc("my_tracking");
    if (!isCurrent()) return;
    setTracking(Boolean((tr as { ok?: boolean } | null)?.ok));
    // The written emails of every lead (only what a campaign needs).
    const got: Draft[] = [];
    for (let from = 0; from < 20000; from += 1000) {
      const { data } = await sb().from("leads").select("id,email,name,outreach:data->outreach").range(from, from + 999);
      if (!isCurrent()) return;
      got.push(...(((data ?? []) as Draft[]).map((d) => ({ ...d, sequence: (d.outreach as { sequence?: string } | null)?.sequence ?? null }))));
      if (!data || data.length < 1000) break;
    }
    if (!isCurrent()) return;
    setDrafts(got);
  }, [account, demo, leads, sb, campaignsQuery]);
  useEffect(() => { Promise.resolve().then(load); }, [load]);
  useEffect(() => { Promise.resolve().then(loadDeleted); }, [loadDeleted, list.length]);
  // Every 15 seconds while the page is visible: the campaign list and its numbers (not the drafts).
  const refresh = useCallback(async () => {
    if (demo || !account) return;
    const currentGen = reqGenRef.current;
    const currentTeam = account.team_id;
    const [{ data: cs }, { data: rows }] = await Promise.all([
      campaignsQuery(),
      sb().from("campaign_leads").select("campaign_id,status,first_sent_at").limit(20000),
    ]);
    if (reqGenRef.current !== currentGen || activeTeamRef.current !== currentTeam) return;
    if (cs) setList(cs as unknown as Campaign[]);
    setCounts(tally((rows ?? []) as Parameters<typeof tally>[0]));
  }, [account, demo, sb, campaignsQuery]);
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === "visible") refresh(); }, 15000);
    return () => clearInterval(t);
  }, [refresh]);

  const byId = useMemo(() => new Map(leads.map((l) => [l.id, l])), [leads]);
  const okBoxes = boxes.filter((b) => b.status === "ok" && b.imap_ok === true);

  // Like the leading tools: a new campaign starts with just a name, then opens on its Leads tab.
  async function create(e: React.FormEvent) {
    e.preventDefault();
    const name = (naming ?? "").trim().slice(0, 80);
    if (!name) { toast("Give the campaign a name."); return; }
    if (demo || !account) { toast("Making a campaign needs a signed-in team."); return; }
    const seq = sequences[0];
    // Defaults: this computer's time zone (when Kestrel knows it), and Verify on when the team has a Hunter key.
    let zone = "Europe/London";
    try { const z = Intl.DateTimeFormat().resolvedOptions().timeZone; if (TIME_ZONES.includes(z)) zone = z; } catch { /* keep London */ }
    const { data, error } = await sb().from("campaigns").insert({ team_id: account.team_id, name, sequence_id: seq?.id ?? null, mailbox_ids: okBoxes.map((b) => b.id),
      time_zone: zone, window_start: 9, window_end: 17, weekdays_only: seq?.weekdays_only ?? true, track_opens: false, verify_emails: hunter }).select("id").single();
    if (error) { toast(/duplicate|unique/.test(error.message) ? "A campaign with that name already exists." : error.message); return; }
    setNaming(null);
    await load();
    setOpen((data as { id: string }).id);
  }

  if (missing) return <div className="app-page"><p className="plan-msg">Campaigns are coming soon to your workspace. Please check back shortly.</p></div>;
  const current = list.find((c) => c.id === open);
  const boxLine = (c: Campaign) => { const mailboxIds = c.mailbox_ids ?? []; const em = boxes.filter((b) => mailboxIds.includes(b.id)).map((b) => b.email); return em.length ? `${em[0]}${em.length > 1 ? ` +${em.length - 1}` : ""}` : "no email account"; };
  const detail = current ? <CampaignDetail key={`${current.id}-${current.status}`} campaign={current} count={counts[current.id] ?? {}} sequences={sequences} boxes={boxes} today={today} drafts={drafts} usedIn={usedIn} byId={byId} blocked={blocked}
    tracking={tracking} demo={demo} editable={editable} tested={testOk(current, list, now)} me={me} lists={lists} inList={inList}
    toast={toast} go={go} onBack={() => setOpen(null)} onOpen={setOpen} reload={load} /> : null;
  // Design v2: the kit's "Project Management - Project Details": the campaign list on the left, the campaign in the middle,
  // its status, email accounts and numbers on the right.
  if (current) {
    const k = counts[current.id] ?? {}, seq = sequences.find((x) => x.id === current.sequence_id);
    const isSending = current.status === "running";
    const isPaused = current.status === "paused";
    const statusTone = isSending ? "#10B981" : isPaused ? "#F59E0B" : current.status === "stopped" ? "#EF4444" : "#64748B";

    return (
      <div className="kpd-redesign">
        {/* Left Column: Clean Campaign Switcher */}
        <aside className="kpd-left-rail" aria-label="Campaigns list">
          <div className="kpd-rail-head">
            <div className="kpd-rail-title-row">
              <span className="kpd-rail-heading">Campaigns</span>
              <span className="kpd-rail-count">{list.length}</span>
            </div>
            <label className="kpd-rail-search">
              <Line name="search" />
              <input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search campaigns…"
                aria-label="Search campaigns"
                style={{ border: "none", background: "transparent", outline: "none", boxShadow: "none" }}
              />
            </label>
          </div>
          <div className="kpd-rail-list">
            {list
              .filter((c) => !q || (c.name ?? "").toLowerCase().includes(q.trim().toLowerCase()))
              .map((c) => {
                const active = c.id === current.id;
                const cSent = counts[c.id]?.started ?? 0;
                const cRep = counts[c.id]?.replied ?? 0;
                const cRunning = c.status === "running";
                const cTone = cRunning ? "#10B981" : c.status === "paused" ? "#F59E0B" : c.status === "stopped" ? "#EF4444" : "#94A3B8";

                return (
                  <button
                    key={c.id}
                    type="button"
                    className={`kpd-rail-item${active ? " active" : ""}`}
                    onClick={() => setOpen(c.id)}
                  >
                    <div className="kpd-rail-item-top">
                      <b className="kpd-rail-item-name" title={c.name}>{c.name}</b>
                      <span className="kpd-rail-status-pill">
                        <span className="kpd-status-dot" style={{ backgroundColor: cTone }} />
                        <span className="kpd-status-text">{STATUS_NAMES[c.status]}</span>
                      </span>
                    </div>
                    <div className="kpd-rail-item-sub">{boxLine(c)}</div>
                    <div className="kpd-rail-item-foot">
                      <span>{cSent.toLocaleString()} sent</span>
                      <span>·</span>
                      <span>{cRep.toLocaleString()} replied</span>
                    </div>
                  </button>
                );
              })}
          </div>
        </aside>

        {/* Center: Main Campaign Detail Workspace */}
        <div className="kpd-center-workspace">
          {detail}
        </div>

        {/* Right Column: Sleek Inspector Panel */}
        <aside className="kpd-right-inspector" aria-label="Campaign overview">
          <div className="kpd-insp-section">
            <h3 className="kpd-insp-heading">Status</h3>
            <div className="kpd-insp-status-card">
              <div className="kpd-insp-status-now">
                <span className="kpd-status-dot-lg" style={{ backgroundColor: statusTone }} />
                <span className="kpd-insp-status-title">{STATUS_NAMES[current.status]}</span>
              </div>
              <p className="kpd-insp-status-desc">
                {isSending
                  ? "Emails are going out inside your sending hours."
                  : isPaused
                  ? "Campaign is paused. Click Resume to continue sending."
                  : current.status === "draft"
                  ? "Campaign is not started yet. Ready leads will be sent."
                  : current.status === "stopped"
                  ? "Campaign is stopped."
                  : "All emails and follow-ups are finished."}
              </p>
            </div>
          </div>

          <div className="kpd-insp-section">
            <h3 className="kpd-insp-heading">Sender Inboxes</h3>
            <div className="kpd-insp-box-list">
              {boxes
                .filter((b) => (current.mailbox_ids ?? []).includes(b.id))
                .map((b) => (
                  <div key={b.id} className="kpd-insp-box-card">
                    <span className="kpd-insp-box-av">{b.email.slice(0, 2).toUpperCase()}</span>
                    <div className="kpd-insp-box-info">
                      <b className="kpd-insp-box-email" title={b.email}>{b.email}</b>
                      <small className="kpd-insp-box-sub">
                        {today[b.id]?.limit_today ?? b.daily_limit} today · up to {b.daily_limit}/day
                      </small>
                    </div>
                  </div>
                ))}
              {!(current.mailbox_ids?.length) ? <p className="kpd-insp-empty">No email account linked.</p> : null}
            </div>
          </div>

          <div className="kpd-insp-section">
            <h3 className="kpd-insp-heading">Schedule</h3>
            <div className="kpd-insp-meta-row">
              <span className="kpd-insp-meta-label">Sending window</span>
              <span className="kpd-insp-meta-val">
                {current.window_start}:00 – {current.window_end}:00
              </span>
            </div>
            <div className="kpd-insp-meta-row">
              <span className="kpd-insp-meta-label">Days</span>
              <span className="kpd-insp-meta-val">
                {current.weekdays_only ? "Weekdays only" : "Every day"}
              </span>
            </div>
            <div className="kpd-insp-meta-row">
              <span className="kpd-insp-meta-label">Time zone</span>
              <span className="kpd-insp-meta-val">{current.time_zone || "Local"}</span>
            </div>
          </div>

          <div className="kpd-insp-section">
            <h3 className="kpd-insp-heading">Campaign Info</h3>
            <div className="kpd-insp-meta-row">
              <span className="kpd-insp-meta-label">Sequence</span>
              <span className="kpd-insp-meta-val">{seq?.name ?? "None"}</span>
            </div>
            <div className="kpd-insp-meta-row">
              <span className="kpd-insp-meta-label">Total leads</span>
              <span className="kpd-insp-meta-val">{(k.total ?? 0).toLocaleString()}</span>
            </div>
            <div className="kpd-insp-meta-row">
              <span className="kpd-insp-meta-label">Bounced</span>
              <span className="kpd-insp-meta-val">{String(k.bounced ?? 0)}</span>
            </div>
            <div className="kpd-insp-meta-row">
              <span className="kpd-insp-meta-label">Unsubscribed</span>
              <span className="kpd-insp-meta-val">{String(k.unsubscribed ?? 0)}</span>
            </div>
          </div>
        </aside>
      </div>
    );
  }
  if (current) return detail;

  async function restore(id: string, name: string) {
    const { error } = await sb().rpc("restore_campaign", { campaign: id });
    if (error) { toast(error.message); return; }
    toast(`Restored "${name}" as not started.`);
    setDeleted((d) => (d ?? []).filter((x) => x.campaign_id !== id));
    await load(); setOpen(id);
  }
  const shown = list.filter((c) => (show === "all" || c.status === show) && (!q || (c.name ?? "").toLowerCase().includes(q.trim().toLowerCase())));
  const SHOWS = [["all", "All"], ["running", "Sending"], ["draft", "Not started"], ["paused", "Paused"], ["stopped", "Stopped"], ["done", "Finished"]] as [Show, string][];
  const pct = (c: Campaign) => { const k = counts[c.id] ?? {}; return k.total ? Math.round(((k.started ?? 0) / k.total) * 100) : 0; };
  const STATUS_IC: Record<CampaignStatus, string> = { running: "send", paused: "clock", draft: "edit", stopped: "block", done: "check" };
  return (
    <div className="app-page kpage kcamp">
      <header className="khead">
        <h1>Campaigns <Tip text={HELP} /></h1>
        <div className="kcamp-tools">
          <label className="kcamp-search"><Line name="search" /><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search campaigns" aria-label="Search campaigns" /></label>
          <button type="button" className="kd-iconbtn" aria-label="Refresh" title="Refresh (also refreshes by itself every 15 seconds)" onClick={() => { load(); toast("Refreshed."); }}><Line name="sliders" /></button>
          {editable ? <button type="button" className="kcamp-add" onClick={() => setNaming("")}><Line name="plus" /> Add campaign</button> : null}
        </div>
      </header>
      {!okBoxes.length ? <p className="plan-msg">Add and test an email account first. <button type="button" className="link-btn" onClick={() => go("mailboxes")}>Open Email accounts</button></p> : null}
      {naming !== null ? (
        <form className="join-card prof-form camp-new" onSubmit={create}>
          <label className="in"><span>Campaign name</span><input autoFocus value={naming} maxLength={80} placeholder="Video agencies, London" onChange={(e) => setNaming(e.target.value)} /></label>
          <div className="join-row"><button type="submit" className="btn go">Continue</button><button type="button" className="link-btn" onClick={() => setNaming(null)}>Cancel</button></div>
        </form>
      ) : null}
      <div className="kcamp-tabs">
        <div role="tablist" aria-label="Show">
          {SHOWS.map(([id, name]) => (
            <button key={id} type="button" role="tab" aria-selected={show === id} className={show === id ? "on" : ""} onClick={() => setShow(id)}>
              {name} <i>{id === "all" ? list.length : list.filter((c) => c.status === id).length}</i></button>
          ))}
        </div>
        <div className="kcamp-views" role="group" aria-label="Layout">
          <button type="button" aria-pressed={layout === "list"} className={layout === "list" ? "on" : ""} aria-label="List" onClick={() => setLayout("list")}><Line name="list" /></button>
          <button type="button" aria-pressed={layout === "grid"} className={layout === "grid" ? "on" : ""} aria-label="Grid" onClick={() => setLayout("grid")}><Line name="grid" filled={layout === "grid"} /></button>
        </div>
      </div>
      {layout === "grid" ? (
        <div className="kcamp-grid">
          {shown.map((c) => {
            const k = counts[c.id] ?? {}, started = k.started ?? 0, p = pct(c), seq = sequences.find((x) => x.id === c.sequence_id);
            return (
              <article key={c.id} className="kcamp-card">
                <div className="kcamp-top">
                  <span className={`kcamp-logo ${PILL[c.status]}`} aria-hidden="true"><Line name={STATUS_IC[c.status]} filled /></span>
                  <button type="button" className="kcamp-name" onClick={() => setOpen(c.id)}>
                    <b>{c.name}</b>
                    <small>{boxLine(c)}</small>
                  </button>
                  <button type="button" className="kcamp-more" aria-label={`Open ${c.name}`} onClick={() => setOpen(c.id)}><Line name="more" /></button>
                </div>
                <p className="kcamp-desc">
                  {c.paused_reason ? <span className="dlv-bad">{c.paused_reason}</span>
                    : <>{seq ? `Sequence “${seq.name}”` : "No sequence yet"} · sends {c.window_start}:00–{c.window_end}:00{c.weekdays_only ? " on weekdays" : " every day"}{c.status === "draft" && !testOk(c, list, now) ? " · test not sent" : ""}</>}
                </p>
                <div className="kcamp-clean-bar" role="progressbar" aria-valuenow={p} aria-valuemin={0} aria-valuemax={100} aria-label="Progress">
                  <div className="kcamp-clean-bar-fill" style={{ width: `${p}%` }} />
                </div>
                <div className="kcamp-foot">
                  <span className={`kcamp-chip ${PILL[c.status]}`}>
                    <span className="kcamp-status-dot" />
                    <span>{STATUS_NAMES[c.status]}</span>
                  </span>
                  <span className="kcamp-nums" title={`${started} of ${k.total ?? 0} leads emailed · ${k.replied ?? 0} replied`}>
                    <b>{started.toLocaleString()}</b> sent · <b>{k.replied ?? 0}</b> replied
                  </span>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="kd-card kcamp-listcard">
          <table className="kd-table kcamp-table">
            <thead><tr><th>Campaign</th><th>Status</th><th>Progress</th><th>Sent</th><th>Replied</th><th>Bounced</th><th>Unsubscribed</th></tr></thead>
            <tbody>{shown.map((c) => { const k = counts[c.id] ?? {}, started = k.started ?? 0, p = pct(c); return (
              <tr key={c.id} onClick={() => setOpen(c.id)}>
                <td><button type="button" className="kcamp-name" onClick={(e) => { e.stopPropagation(); setOpen(c.id); }}><b>{c.name}</b><small>{boxLine(c)}</small></button></td>
                <td><em className={`kpill ${PILL[c.status] === "muted" ? "mute" : PILL[c.status]}`}>{STATUS_NAMES[c.status]}</em></td>
                <td><span className="kcamp-mini"><span className="kcamp-bar"><i style={{ width: `${p}%` }} /></span>{k.total ? `${p}%` : "—"}</span></td>
                <td>{started.toLocaleString()}{k.total ? <small className="kmuted"> of {k.total.toLocaleString()}</small> : null}</td>
                <td>{k.replied ?? 0}{started ? <small className="kmuted"> {rate(k.replied ?? 0, started)}</small> : null}</td>
                <td>{k.bounced ?? 0}</td><td>{k.unsubscribed ?? 0}</td>
              </tr>); })}</tbody>
          </table>
        </div>
      )}
      {!list.length ? <div className="kd-card kcamp-empty"><b>No campaigns yet</b><span>Click Add campaign, give it a name, then choose leads, check the sequence, set the schedule and send a test to yourself.</span>{editable ? <button type="button" className="kcamp-add" onClick={() => setNaming("")}><Line name="plus" /> Make your first campaign</button> : null}</div>
        : !shown.length ? <div className="kd-card kcamp-empty"><b>No campaigns match</b></div> : null}
      {deleted?.length ? (
        <details className="camp-deleted">
          <summary>Recently deleted ({deleted.length}) <Tip text="Every deleted campaign is kept here for 90 days with who deleted it. A campaign that never had leads can be restored for 30 days; one that had leads lost its sending history when it was deleted." /></summary>
          <ul className="kcamp-deleted">{deleted.map((d) => (
            <li key={d.campaign_id}><b>{d.name}</b><small>{STATUS_NAMES[d.status as keyof typeof STATUS_NAMES] ?? d.status} · deleted {new Date(d.deleted_at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} by {d.deleted_by}{d.leads ? ` · ${d.leads} leads, ${d.sent} emailed` : ""}</small>
              {d.can_restore && editable ? <button type="button" className="link-btn" onClick={() => restore(d.campaign_id, d.name)}>Restore</button> : <small className="kmuted">{d.leads ? "Had leads" : "Too old"}</small>}</li>
          ))}</ul>
        </details>) : null}
    </div>
  );
}
