"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Line, Tip } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/client";
import { STAGES, stageName, type Stage } from "@/lib/campaign";
import LeadTimeline from "./lead-timeline";
import { BizAvatar, siteOfEmail } from "./biz";
import { LABEL_NAME, LABEL_TONE, isLabel, type Label } from "@/lib/inbox";
import { useAlertsSetting } from "./reply-alerts";
import ReplyBox from "./reply-box";

// Replies → Modern 2-card inbox layout matching the reference UI:
// Card 1 (Left): Pill search + filter, Segmented tabs [All Mails | Unread | Archive], rich conversation list with avatars, bold subjects, snippets, tags and star.
// Card 2 (Right): Thread header with avatar, name, email, time and action pills [Reply | Mark done | Snooze], bold subject, LeadTimeline, and docked composer.
type Conv = { id: string; lead_id: string | null; lead_name: string | null; to_email: string; status: string; first_sent_at: string | null; campaign_id: string; mailbox_id: string | null; stage?: Stage | null;
  note?: string | null; assigned_to?: string | null; snoozed_until?: string | null };
type Ev = { campaign_lead_id: string; kind: string; at: string };
type Rep = { id: string; campaign_lead_id: string; kind: string; handled: boolean; received_at: string | null; snippet?: string | null; ai_label?: string | null; ai_reason?: string | null; ai_by?: string | null };
type Person = { id: string; name: string | null; email: string };
type Filter = "all" | "answer" | "replied" | Stage | "seen" | "unseen" | "auto" | "unsubscribed" | "bounced" | "mine" | "snoozed" | `label:${Label}`;
const PRO_COLS = "stage,note,assigned_to,snoozed_until";

const SNOOZES: [string, () => Date][] = [
  ["Until tomorrow 9:00", () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d; }],
  ["For 3 days", () => new Date(Date.now() + 3 * 86400000)],
  ["For a week", () => new Date(Date.now() + 7 * 86400000)],
  ["Until next Monday 9:00", () => { const d = new Date(); d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7)); d.setHours(9, 0, 0, 0); return d; }],
];

const ago = (s: string | null) => {
  if (!s) return "";
  const m = Math.round((Date.now() - Date.parse(s)) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : new Date(s).toLocaleDateString(undefined, { day: "numeric", month: "short" });
};
const SEEN_HELP = "Seen = the email's tracking image was loaded (only campaigns with Track opens on). An estimate: Gmail counts only the first open; Apple Mail can load emails by itself.";
const STAGE_HELP = "Your own label for each conversation: it powers the Positive replies number in Analytics. Not interested also stops any follow-ups still planned.";
const CONV_COLS = "id,lead_id,lead_name,to_email,status,first_sent_at,campaign_id,mailbox_id";

export default function InboxView({ account, demo, editable, toast }: { account: { role: string; team_id?: string } | null; demo: boolean; editable: boolean; toast: (t: string) => void }) {
  const [convs, setConvs] = useState<Conv[] | null>(null);
  const [events, setEvents] = useState<Ev[]>([]);
  const [replies, setReplies] = useState<Rep[]>([]);
  const [names, setNames] = useState<{ camps: Record<string, string>; boxes: Record<string, string> }>({ camps: {}, boxes: {} });
  const [pick, setPick] = useState<string>("");
  const [filter, setFilter] = useState<Filter>("answer");
  const [camp, setCamp] = useState("");
  const [box, setBox] = useState("");
  const [q, setQ] = useState("");
  const [updated, setUpdated] = useState<Date | null>(null);
  const [noStage, setNoStage] = useState(false);
  const [noPro, setNoPro] = useState(false);
  const [people, setPeople] = useState<Person[]>([]);
  const [me, setMe] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [alerts, setAlerts] = useAlertsSetting();
  const [labelling, setLabelling] = useState(false);
  const [booking, setBooking] = useState("");
  const [composing, setComposing] = useState(false);
  const [composeTo, setComposeTo] = useState("");
  const [composeSubj, setComposeSubj] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [sending, setSending] = useState(false);

  const activeTeamRef = useRef(account?.team_id);
  const reqGenRef = useRef(0);
  useEffect(() => {
    if (account?.team_id !== activeTeamRef.current) {
      activeTeamRef.current = account?.team_id;
      reqGenRef.current += 1;
    }
  }, [account?.team_id]);
  useEffect(() => {
    if (demo) { Promise.resolve().then(() => setBooking("https://cal.com/example/15min")); return; }
    supabaseBrowser().from("team_ai").select("booking_link").maybeSingle().then(({ data }) => setBooking(String((data as { booking_link?: string } | null)?.booking_link ?? "")));
  }, [demo]);
  const manage = Boolean(account && ["owner", "manager"].includes(account.role));
  const kitBox = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (demo) {
      const now = Date.now(), d = (m: number) => new Date(now - m * 60000).toISOString();
      setConvs([
        { id: "s1", lead_id: null, lead_name: "Sophia Wilson", to_email: "sophia.wilson@innovatorx.test", status: "replied", first_sent_at: d(9), campaign_id: "c1", mailbox_id: "b", stage: "meeting", note: "Excited about the product launch reels.", assigned_to: "me" },
        { id: "s2", lead_id: null, lead_name: "Alexandra Smith", to_email: "alexandra.smith@growthmedia.test", status: "replied", first_sent_at: d(10), campaign_id: "c2", mailbox_id: "b", stage: "interested", assigned_to: "me" },
        { id: "s3", lead_id: null, lead_name: "Michael Brown", to_email: "michael.brown@northlight.test", status: "replied", first_sent_at: d(18), campaign_id: "c3", mailbox_id: "b", stage: "meeting" },
        { id: "s4", lead_id: null, lead_name: "James Johnson", to_email: "jamesjohnson1786@gmail.com", status: "replied", first_sent_at: d(15), campaign_id: "c4", mailbox_id: "b", stage: "interested", note: "Asked for video examples. Send 2 reels.", assigned_to: "me" },
        { id: "s5", lead_id: null, lead_name: "Daniel Martinez", to_email: "daniel.martinez@kuromi.test", status: "active", first_sent_at: d(14), campaign_id: "c5", mailbox_id: "b", stage: null },
        { id: "s6", lead_id: null, lead_name: "Emily Smith", to_email: "emily.smith@discoverymag.test", status: "active", first_sent_at: d(12), campaign_id: "c6", mailbox_id: "b", stage: null }
      ]);
      setEvents([
        { campaign_lead_id: "s1", kind: "opened", at: d(8) },
        { campaign_lead_id: "s2", kind: "opened", at: d(7) },
        { campaign_lead_id: "s3", kind: "opened", at: d(12) },
        { campaign_lead_id: "s4", kind: "opened", at: d(14) }
      ]);
      setPeople([{ id: "me", name: "Alex Example", email: "alex@example.test" }, { id: "sam", name: "Sam Teammate", email: "sam@example.test" }]); setMe("me");
      setReplies([
        { id: "r1", campaign_lead_id: "s1", kind: "reply", handled: false, received_at: d(9), snippet: "Hey there, I am thrilled to introduce our new campaign...", ai_label: "meeting", ai_reason: "Booked a demo call", ai_by: "claude-haiku-5-5" },
        { id: "r2", campaign_lead_id: "s2", kind: "reply", handled: false, received_at: d(10), snippet: "Hi Cansaas, Just a quick update regarding our upcoming video collaboration...", ai_label: "interested" },
        { id: "r3", campaign_lead_id: "s3", kind: "reply", handled: true, received_at: d(18), snippet: "Good day team, I had the opportunity to review your reel...", ai_label: "meeting" },
        { id: "r4", campaign_lead_id: "s4", kind: "reply", handled: false, received_at: d(15), snippet: "Hello Cansaas! I hope you're doing well! I'm reaching out to discuss an exciting opportunity to collaborate on a new initiative. At Innovate Solutions, we've been working on a project that aligns closely with your expertise.", ai_label: "interested", ai_reason: "Asks for collaboration scope", ai_by: "claude-haiku-5-5" }
      ]);
      setNames({
        camps: {
          c1: "Product Launch: The Innovator X",
          c2: "Exciting Collaboration Opportunity",
          c3: "Exclusive Interview with CEO",
          c4: "It's Here! The Jeez",
          c5: "Company Retreat Recap",
          c6: "Breaking News: New Discovery"
        },
        boxes: { b: "alex@northlight-studio.test" }
      });
      setUpdated(new Date());
      return;
    }
    const sb = supabaseBrowser();
    const convQ = (cols: string) => sb.from("campaign_leads").select(cols).not("first_sent_at", "is", null).order("first_sent_at", { ascending: false }).limit(2000);
    const repQ = (extra: string) => sb.from("mail_replies").select(`id,campaign_lead_id,kind,handled,received_at,snippet${extra}`).order("received_at", { ascending: false }).limit(2000);
    const currentGen = reqGenRef.current;
    const currentTeam = account?.team_id;
    const isCurrent = () => reqGenRef.current === currentGen && activeTeamRef.current === currentTeam;

    const [c0, e, r0, cs, bs, pp, u] = await Promise.all([
      convQ(`${CONV_COLS},${PRO_COLS}`),
      sb.from("mail_events").select("campaign_lead_id,kind,at").in("kind", ["opened", "sent"]).order("at", { ascending: false }).limit(10000),
      repQ(",ai_label,ai_reason,ai_by"),
      sb.from("campaigns").select("id,name"),
      sb.from("mailboxes").select("id,email"),
      sb.rpc("team_people"),
      sb.auth.getUser(),
    ]);
    if (!isCurrent()) return;
    let c = c0, r = r0;
    if (c0.error) {
      setNoPro(true); c = await convQ(`${CONV_COLS},stage`);
      if (c.error) { c = await convQ(CONV_COLS); setNoStage(true); }
    }
    if (r0.error) { r = await repQ(""); setNoPro(true); }
    if (!isCurrent()) return;
    setPeople((pp.data as Person[] | null) ?? []); setMe(u.data.user?.id ?? "");
    setConvs((c.data as unknown as Conv[] | null) ?? []); setEvents((e.data as Ev[] | null) ?? []); setReplies((r.data as Rep[] | null) ?? []);
    setNames({ camps: Object.fromEntries(((cs.data ?? []) as { id: string; name: string }[]).map((x) => [x.id, x.name])), boxes: Object.fromEntries(((bs.data ?? []) as { id: string; email: string }[]).map((x) => [x.id, x.email])) });
    setUpdated(new Date());
  }, [demo, account]);

  useEffect(() => {
    Promise.resolve().then(load);
    const t = setInterval(() => { if (document.visibilityState === "visible") load(); }, 15000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (pick && convs && !convs.some((c) => c.id === pick)) {
      Promise.resolve().then(() => setPick(""));
    }
  }, [convs, pick]);

  const [tried, setTried] = useState<Set<string>>(() => new Set());
  const waitingIds = demo || noPro ? "" : replies.filter((r) => r.kind === "reply" && !r.ai_label && !tried.has(r.id)).map((r) => r.id).join(",");
  useEffect(() => {
    if (!waitingIds || labelling) return;
    Promise.resolve().then(async () => {
      setTried((t) => new Set([...t, ...waitingIds.split(",")]));
      setLabelling(true);
      const out = await fetch("/api/mail/label", { method: "POST" }).then((x) => x.json()).catch(() => null) as { labelled?: unknown[] } | null;
      setLabelling(false);
      if (out?.labelled?.length) load();
    });
  }, [waitingIds, labelling, load]);

  const nowMs = updated ? updated.getTime() : 0;
  const all = useMemo(() => (convs ?? []).map((c) => {
    const opens = events.filter((e) => e.campaign_lead_id === c.id && e.kind === "opened");
    const reps = replies.filter((r) => r.campaign_lead_id === c.id);
    const real = reps.filter((r) => r.kind === "reply");
    const last = [c.first_sent_at, opens[0]?.at, reps[0]?.received_at].filter(Boolean).sort().pop() ?? null;
    const snoozed = Boolean(c.snoozed_until && Date.parse(c.snoozed_until) > nowMs);
    const label = real.find((r) => isLabel(r.ai_label))?.ai_label as Label | undefined;
    return { c, opens: opens.length, lastOpen: opens[0]?.at ?? null, reps, waiting: real.some((r) => !r.handled) && !snoozed, snoozed, label, replied: real.length > 0, auto: reps.some((r) => r.kind === "auto"), last, preview: reps[0]?.snippet ?? "" };
  }), [convs, events, replies, nowMs]);

  const scoped = all.filter((x) => (!camp || x.c.campaign_id === camp) && (!box || x.c.mailbox_id === box)
    && (!q || `${x.c.lead_name ?? ""} ${x.c.to_email} ${names.camps[x.c.campaign_id] ?? ""}`.toLowerCase().includes(q.trim().toLowerCase())));

  const test = (f: Filter, x: (typeof all)[number]) => f === "all" ? true : f === "answer" ? x.waiting : f === "replied" ? x.replied : f === "seen" ? x.opens > 0
    : f === "unseen" ? x.opens === 0 && !x.replied : f === "auto" ? x.auto : f === "unsubscribed" || f === "bounced" ? x.c.status === f
    : f === "mine" ? Boolean(me) && x.c.assigned_to === me : f === "snoozed" ? x.snoozed : f.startsWith("label:") ? x.label === f.slice(6) : x.c.stage === f;

  const rows = scoped.filter((x) => test(filter, x)).sort((a, b) => Number(b.waiting) - Number(a.waiting) || String(b.last).localeCompare(String(a.last)));
  const n = (f: Filter) => scoped.filter((x) => test(f, x)).length;
  const open = all.find((x) => x.c.id === pick) ?? null;
  const answerable = open?.reps.find((r) => r.kind === "reply") ?? null;

  const firstId = rows[0]?.c.id ?? "";
  useEffect(() => {
    if (!pick && firstId && window.innerWidth > 900) Promise.resolve().then(() => setPick(firstId));
  }, [pick, firstId]);

  const choose = (id: string) => { setPick(id); setNote(null); setComposing(false); };
  const when = (s: string | null) => s ? new Date(s).toLocaleString("en-GB", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }).replace(", ", ", ") : "";

  async function setStage(stage: Stage | null) {
    if (!open) return;
    const before = open.c.stage ?? null;
    setConvs((cs) => cs && cs.map((c) => (c.id === open.c.id ? { ...c, stage, status: stage === "not_interested" && c.status === "active" ? "stopped" : c.status } : c)));
    if (demo) return;
    const { error } = await supabaseBrowser().rpc("set_lead_stage", { cl: open.c.id, stage });
    if (error) { toast(/set_lead_stage|schema cache/i.test(error.message) ? "Lead status is coming soon to your workspace." : error.message); setConvs((cs) => cs && cs.map((c) => (c.id === open.c.id ? { ...c, stage: before } : c))); }
  }

  async function setConv(patch: Partial<Pick<Conv, "note" | "assigned_to" | "snoozed_until">>, done: string) {
    if (!open) return;
    const before = open.c;
    setConvs((cs) => cs && cs.map((c) => (c.id === open.c.id ? { ...c, ...patch } : c)));
    if (demo) { toast(done); return; }
    const { error } = await supabaseBrowser().rpc("set_conversation", { cl: open.c.id,
      set_note: "note" in patch, note: patch.note ?? null, set_assignee: "assigned_to" in patch, assignee: patch.assigned_to ?? null,
      set_snooze: "snoozed_until" in patch, snooze_until: patch.snoozed_until ?? null });
    if (error) { toast(/set_conversation|schema cache/i.test(error.message) ? "Notes, assign and snooze are coming soon to your workspace." : error.message); setConvs((cs) => cs && cs.map((c) => (c.id === before.id ? before : c))); return; }
    toast(done);
  }

  function toggleAlerts() {
    const next = !alerts;
    setAlerts(next);
    toast(next ? "Reply alerts ON." : "Reply alerts OFF.");
    if (next && "Notification" in window && Notification.permission === "default") {
      Notification.requestPermission().catch(() => "denied");
    }
  }

  const personName = (id: string | null | undefined) => { const p = people.find((x) => x.id === id); return p ? (p.id === me ? "you" : p.name || p.email) : ""; };

  const assignUi = open ? (
    <label className="kinbox-meta-select">
      <span>Assigned to</span>
      <select value={open.c.assigned_to ?? ""} disabled={!editable} onChange={(e) => setConv({ assigned_to: e.target.value || null }, e.target.value ? `Assigned to ${personName(e.target.value)}.` : "Nobody is assigned now.")}>
        <option value="">Nobody</option>
        {people.map((p) => <option key={p.id} value={p.id}>{p.id === me ? `${p.name || p.email} (you)` : p.name || p.email}</option>)}
      </select>
    </label>
  ) : null;

  const snoozeUi = open ? (
    <select value="" className="kinbox-snooze-select" disabled={!editable} onChange={(e) => { const i = Number(e.target.value); if (e.target.value === "off") setConv({ snoozed_until: null }, "Back in To answer."); else if (SNOOZES[i]) { const t = SNOOZES[i][1](); setConv({ snoozed_until: t.toISOString() }, `Snoozed until ${t.toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}.`); } }}>
      <option value="">{open.snoozed ? `Snoozed` : "Snooze"}</option>
      {SNOOZES.map(([name], i) => <option key={name} value={i}>{name}</option>)}
      {open.snoozed ? <option value="off">Stop snoozing</option> : null}
    </select>
  ) : null;

  const noteUi = !open ? null : note !== null ? (
    <div className="ubx-note">
      <textarea rows={3} autoFocus value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} aria-label="Note for your team" placeholder="Only your team sees notes." />
      <div className="join-row">
        <button type="button" className="btn go small" onClick={() => { setConv({ note: note.trim() || null }, note.trim() ? "Note saved." : "Note removed."); setNote(null); }}>Save note</button>
        <button type="button" className="link-btn" onClick={() => setNote(null)}>Cancel</button>
      </div>
    </div>
  ) : open.c.note ? (
    <p className="ubx-note-text"><b>Note</b> {open.c.note} {editable ? <button type="button" className="link-btn" onClick={() => setNote(open.c.note ?? "")}>Edit</button> : null}</p>
  ) : editable ? <button type="button" className="link-btn ubx-add-note" onClick={() => setNote("")}>Add a note</button> : null;

  const labelRep = open?.reps.find((x) => x.kind === "reply" && isLabel(x.ai_label)) ?? null;
  const campSel = <label className="in"><span>Campaign</span><select value={camp} onChange={(e) => setCamp(e.target.value)}><option value="">All campaigns</option>{Object.entries(names.camps).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>;
  const boxSel = <label className="in"><span>Email account</span><select value={box} onChange={(e) => setBox(e.target.value)}><option value="">All accounts</option>{Object.entries(names.boxes).map(([id, email]) => <option key={id} value={id}>{email}</option>)}</select></label>;

  const MORE: [Filter, string][] = [...(noStage ? [] : STAGES.map(([id, label]) => [id, label] as [Filter, string])), ["seen", "Seen"], ["unseen", "Not seen"], ["auto", "Out of office"], ["unsubscribed", "Unsubscribed"], ["bounced", "Bounced"]];
  const moreOn = MORE.find(([id]) => id === filter);
  const filterCount = (moreOn ? 1 : 0) + (camp ? 1 : 0) + (box ? 1 : 0);

  async function markDone(done: boolean) {
    if (!open) return;
    const ids = open.reps.filter((r) => r.kind === "reply").map((r) => r.id);
    setReplies((rs) => rs.map((r) => (ids.includes(r.id) ? { ...r, handled: done } : r)));
    if (demo || !ids.length) return;
    const { error } = await supabaseBrowser().from("mail_replies").update({ handled: done }).in("id", ids);
    if (error) { toast(error.message); load(); }
  }

  return (
    <div className="app-page kpage kmail-page kinbox-page">
      {convs === null ? <p className="plan-msg">Loading conversations…</p> : (
        <div className="kinbox-container">
          {/* Card 1: Mail List & Filters */}
          <aside className="kinbox-card kinbox-list-card">
            {/* Top Search & Filter Bar */}
            <div className="kinbox-top-bar">
              <button
                type="button"
                className={`kinbox-compose-btn${composing ? " on" : ""}`}
                title="Write new email"
                onClick={() => {
                  setComposing(true);
                  setPick("");
                }}
              >
                <Line name="pencil" />
                <span>Write Email</span>
              </button>
              <div className="kinbox-search-wrap">
                <Line name="search" />
                <input
                  type="search"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search..."
                  aria-label="Search conversations"
                />
              </div>
              <button
                type="button"
                className="kinbox-filter-btn"
                aria-label="Refresh conversations"
                title="Refresh"
                onClick={() => { load(); toast("Refreshed."); }}
              >
                <Line name="refresh" />
              </button>
              <button
                type="button"
                className={`kinbox-filter-btn${alerts ? " on" : ""}`}
                aria-label="Reply alerts"
                title={alerts ? "Reply alerts ON (click to turn OFF)" : "Reply alerts OFF (click to turn ON)"}
                onClick={toggleAlerts}
              >
                <Line name="bell" filled={alerts} />
              </button>
              <details className="kdrop kinbox-filter-drop">
                <summary className="kinbox-filter-btn" aria-label="Filter conversations" title="Filter by campaign, account or status">
                  <Line name="filter" />
                  {filterCount ? <i className="kinbox-badge">{filterCount}</i> : null}
                </summary>
                <div className="kmenu">
                  {noStage ? null : <p className="kmenu-h">Lead status <Tip text={STAGE_HELP} /></p>}
                  {MORE.slice(0, noStage ? 0 : STAGES.length).map(([id, label]) => (
                    <button key={id} type="button" className={filter === id ? "on" : ""} aria-pressed={filter === id} onClick={() => setFilter(filter === id ? "all" : id)}>
                      {label} <small>{n(id)}</small>
                    </button>
                  ))}
                  <hr /><p className="kmenu-h">Activity <Tip text={SEEN_HELP} /></p>
                  {MORE.slice(noStage ? 0 : STAGES.length).map(([id, label]) => (
                    <button key={id} type="button" className={filter === id ? "on" : ""} aria-pressed={filter === id} onClick={() => setFilter(filter === id ? "all" : id)}>
                      {label} <small>{n(id)}</small>
                    </button>
                  ))}
                  <hr />{campSel}{boxSel}
                  {filterCount ? <><hr /><button type="button" onClick={() => { if (moreOn) setFilter("all"); setCamp(""); setBox(""); }}>Clear filters</button></> : null}
                </div>
              </details>
            </div>

            {/* Segmented Filter Pills */}
            <div className="kinbox-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                className={`kinbox-tab${filter === "all" ? " on" : ""}`}
                aria-selected={filter === "all"}
                onClick={() => setFilter("all")}
              >
                All Mails
              </button>
              <button
                type="button"
                role="tab"
                className={`kinbox-tab${filter === "answer" ? " on" : ""}`}
                aria-selected={filter === "answer"}
                onClick={() => setFilter("answer")}
              >
                Unread {n("answer") > 0 ? <span className="kinbox-tab-num">{n("answer")}</span> : null}
              </button>
              <button
                type="button"
                role="tab"
                className={`kinbox-tab${filter === "replied" ? " on" : ""}`}
                aria-selected={filter === "replied"}
                onClick={() => setFilter("replied")}
              >
                Archive
              </button>
            </div>

            {/* Active filter chips */}
            {filterCount ? (
              <div className="kinbox-chips">
                {moreOn ? <button type="button" onClick={() => setFilter("all")}>{moreOn[1]} ×</button> : null}
                {camp ? <button type="button" onClick={() => setCamp("")}>{names.camps[camp] ?? "Campaign"} ×</button> : null}
                {box ? <button type="button" onClick={() => setBox("")}>{names.boxes[box] ?? "Email account"} ×</button> : null}
              </div>
            ) : null}

            {/* Conversation List */}
            <ul className="kinbox-list" aria-label="Conversations">
              {rows.map((x) => {
                const isSelected = pick === x.c.id;
                const isUnread = x.waiting;
                const leadTitle = names.camps[x.c.campaign_id] || x.c.lead_name || x.c.to_email;
                return (
                  <li key={x.c.id}>
                    <div
                      role="button"
                      tabIndex={0}
                      className={`kinbox-item${isSelected ? " on" : ""}${isUnread ? " unread" : ""}`}
                      onClick={() => choose(x.c.id)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") choose(x.c.id); }}
                    >
                      <div className="kinbox-item-head">
                        <div className="kinbox-item-sender">
                          {isUnread ? <span className="kinbox-unread-dot" title="Unread" /> : null}
                          <BizAvatar name={x.c.lead_name || x.c.to_email} website={siteOfEmail(x.c.to_email)} size={34} />
                          <span className="kinbox-item-name">{x.c.lead_name || x.c.to_email}</span>
                          <span className="kinbox-item-time">· {ago(x.last)}</span>
                        </div>
                        <details className="kdrop kdrop-right kinbox-item-menu" onClick={(e) => e.stopPropagation()}>
                          <summary className="kinbox-item-more" aria-label="More options" title="More options">
                            <Line name="more" />
                          </summary>
                          <div className="kmenu" onClick={(e) => { (e.currentTarget.closest("details") as HTMLDetailsElement).open = false; }}>
                            <button
                              type="button"
                              onClick={() => {
                                const ids = x.reps.filter((r) => r.kind === "reply").map((r) => r.id);
                                if (ids.length) {
                                  setReplies((rs) => rs.map((r) => (ids.includes(r.id) ? { ...r, handled: isUnread } : r)));
                                  if (!demo) supabaseBrowser().from("mail_replies").update({ handled: isUnread }).in("id", ids);
                                }
                                toast(isUnread ? "Marked as handled." : "Marked to answer.");
                              }}
                            >
                              {isUnread ? "Mark handled" : "Mark to answer"}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                navigator.clipboard?.writeText(x.c.to_email);
                                toast(`Copied ${x.c.to_email}`);
                              }}
                            >
                              Copy email address
                            </button>
                            <hr />
                            <button
                              type="button"
                              onClick={() => {
                                const t = new Date(Date.now() + 86400000);
                                setConv({ snoozed_until: t.toISOString() }, "Snoozed 1 day.");
                              }}
                            >
                              Snooze 1 day
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                const t = new Date(Date.now() + 7 * 86400000);
                                setConv({ snoozed_until: t.toISOString() }, "Snoozed 1 week.");
                              }}
                            >
                              Snooze 1 week
                            </button>
                          </div>
                        </details>
                      </div>

                      <div className="kinbox-item-subj">
                        {leadTitle}
                      </div>

                      <div className="kinbox-item-snippet">
                        {x.preview || "No preview text available."}
                      </div>

                      <div className="kinbox-item-foot">
                        <div className="kinbox-item-tags">
                          {x.label ? <span className={`kinbox-tag ${LABEL_TONE[x.label]}`}>{LABEL_NAME[x.label]}</span> : null}
                          {x.c.stage && x.c.stage !== x.label ? <span className="kinbox-tag stage">{stageName(x.c.stage)}</span> : null}
                          {x.opens ? <span className="kinbox-tag seen">Seen {x.opens}×</span> : null}
                          {x.snoozed ? <span className="kinbox-tag">Snoozed</span> : null}
                        </div>
                        <button
                          type="button"
                          className={`kinbox-star-btn${isUnread ? " active" : ""}`}
                          aria-label={isUnread ? "Mark done" : "Mark to answer"}
                          title={isUnread ? "Mark done" : "Mark to answer"}
                          onClick={(e) => {
                            e.stopPropagation();
                            const ids = x.reps.filter((r) => r.kind === "reply").map((r) => r.id);
                            if (ids.length) {
                              setReplies((rs) => rs.map((r) => (ids.includes(r.id) ? { ...r, handled: isUnread } : r)));
                              if (!demo) supabaseBrowser().from("mail_replies").update({ handled: isUnread }).in("id", ids);
                            }
                          }}
                        >
                          <Line name="star" filled={isUnread} />
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
              {!rows.length ? (
                <li className="kinbox-empty">
                  {all.length ? "No matching conversations." : "No conversations yet. They appear as soon as a campaign sends an email."}
                </li>
              ) : null}
            </ul>
          </aside>

          {/* Card 2: Reading Pane & Reply Composer */}
          <section className="kinbox-card kinbox-pane-card">
            {composing ? (
              <>
                <div className="kinbox-pane-header">
                  <div className="kinbox-pane-sender">
                    <div className="kinbox-new-mail-avatar">
                      <Line name="pencil" />
                    </div>
                    <div className="kinbox-pane-sender-info">
                      <b className="kinbox-pane-name">New Message</b>
                      <span className="kinbox-pane-email">Send direct email to any contact</span>
                    </div>
                  </div>
                  <div className="kinbox-pane-actions">
                    <button
                      type="button"
                      className="kinbox-pill-btn"
                      onClick={() => {
                        setComposing(false);
                        if (rows[0]) choose(rows[0].c.id);
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
                <div className="kinbox-compose-body">
                  <div className="kc-modern-card kinbox-direct-compose">
                    <div className="kc-to-row">
                      <div className="kc-to-left">
                        <span className="kc-label">To:</span>
                        <input
                          type="email"
                          className="kinbox-direct-input"
                          placeholder="recipient@example.com"
                          value={composeTo}
                          onChange={(e) => setComposeTo(e.target.value)}
                          autoFocus
                        />
                      </div>
                    </div>
                    <div className="kc-subj-row">
                      <span className="kc-label">Subject:</span>
                      <input
                        type="text"
                        className="kinbox-direct-input"
                        placeholder="Subject..."
                        value={composeSubj}
                        onChange={(e) => setComposeSubj(e.target.value)}
                      />
                    </div>
                    <textarea
                      className="kinbox-direct-editor"
                      rows={10}
                      placeholder="Write your email here..."
                      value={composeBody}
                      onChange={(e) => setComposeBody(e.target.value)}
                    />
                    <div className="kc-modern-foot">
                      <button
                        type="button"
                        className="btn glass small kc-trash-btn"
                        title="Discard"
                        onClick={() => {
                          setComposeTo("");
                          setComposeSubj("");
                          setComposeBody("");
                          setComposing(false);
                          if (rows[0]) choose(rows[0].c.id);
                        }}
                      >
                        <Line name="trash" />
                      </button>
                      <div style={{ marginLeft: "auto" }}>
                        <button
                          type="button"
                          className="btn go small"
                          style={{ borderRadius: 9999, height: 38, padding: "0 22px", background: "#111827", color: "#fff", fontWeight: 600, border: 0 }}
                          disabled={!composeTo.trim() || !composeBody.trim() || sending}
                          onClick={async () => {
                            if (!composeTo.trim() || !composeBody.trim()) return;
                            setSending(true);
                            try {
                              if (demo) {
                                await new Promise((r) => setTimeout(r, 400));
                              } else {
                                await fetch("/api/mail/reply", {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({
                                    to_email: composeTo.trim(),
                                    subject: composeSubj.trim() || "No subject",
                                    body_text: composeBody.trim(),
                                  }),
                                }).catch(() => null);
                              }
                              toast(`Email sent to ${composeTo.trim()}`);
                              setComposeTo("");
                              setComposeSubj("");
                              setComposeBody("");
                              setComposing(false);
                              if (rows[0]) choose(rows[0].c.id);
                            } catch {
                              toast("Could not send email.");
                            } finally {
                              setSending(false);
                            }
                          }}
                        >
                          {sending ? "Sending…" : "Send Message"}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </>
            ) : open ? (
              <>
                {/* Sender Header */}
                <div className="kinbox-pane-header">
                  <div className="kinbox-pane-sender">
                    <BizAvatar name={open.c.lead_name || open.c.to_email} website={siteOfEmail(open.c.to_email)} size={42} />
                    <div className="kinbox-pane-sender-info">
                      <b className="kinbox-pane-name">{open.c.lead_name || open.c.to_email}</b>
                      <a href={`mailto:${open.c.to_email}`} className="kinbox-pane-email">{open.c.to_email}</a>
                    </div>
                  </div>

                  <div className="kinbox-pane-actions">
                    <span className="kinbox-pane-date">{when(open.last)}</span>
                    <div className="kinbox-action-pills">
                      <button
                        type="button"
                        className="kinbox-pill-btn"
                        disabled={!answerable}
                        onClick={() => kitBox.current?.focus()}
                        title="Reply"
                      >
                        <Line name="arrow" /> <span>Reply</span>
                      </button>
                      <button
                        type="button"
                        className={`kinbox-pill-btn${open.waiting ? " active" : ""}`}
                        disabled={!editable || !answerable}
                        onClick={() => markDone(open.waiting)}
                        title={open.waiting ? "Mark as done" : "Mark as to answer"}
                      >
                        <Line name="bookmark" /> <span>{open.waiting ? "Mark done" : "To answer"}</span>
                      </button>
                      <div className="kinbox-snooze-pill">
                        <Line name="clock" />
                        {snoozeUi}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Scrollable conversation thread */}
                <div className="kinbox-pane-scroll">
                  <h1 className="kinbox-subj-title">
                    {names.camps[open.c.campaign_id] ?? "Campaign Conversation"}
                  </h1>

                  <div className="kinbox-meta-strip">
                    {open.c.mailbox_id && names.boxes[open.c.mailbox_id] ? (
                      <span className="kinbox-meta-chip">
                        via <b>{names.boxes[open.c.mailbox_id]}</b>
                      </span>
                    ) : null}
                    {labelRep && !noPro ? (
                      <span className={`kinbox-tag ${LABEL_TONE[labelRep.ai_label as Label]}`} title={`Reply label by ${labelRep.ai_by === "rules" ? "word rules" : "AI"}`}>
                        {LABEL_NAME[labelRep.ai_label as Label]}
                      </span>
                    ) : null}
                    {noStage ? null : (
                      <label className="kinbox-meta-select">
                        <span>Lead status:</span>
                        <select
                          value={open.c.stage ?? ""}
                          disabled={!editable}
                          onChange={(e) => setStage((e.target.value || null) as Stage | null)}
                        >
                          <option value="">No status</option>
                          {STAGES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                        </select>
                      </label>
                    )}
                    {noPro ? null : assignUi}
                  </div>

                  {noPro ? null : noteUi}

                  {/* Timeline Messages */}
                  <div className="kinbox-timeline-container">
                    {open.c.lead_id || demo ? (
                      <LeadTimeline leadId={open.c.lead_id ?? "demo"} demo={demo} />
                    ) : (
                      <p className="dr-muted">This lead was deleted; its campaign history is kept.</p>
                    )}
                  </div>

                  {/* Attachment Cards mockup */}
                  <div className="kinbox-attachments-sec">
                    <span className="kinbox-attach-header">Attachment</span>
                    <div className="kinbox-attach-grid">
                      <div className="kinbox-attach-card">
                        <span className="kinbox-attach-badge pdf">PDF</span>
                        <div className="kinbox-attach-info">
                          <b>Collaboration-Overview.pdf</b>
                          <small>2 MB · Download</small>
                        </div>
                      </div>
                      <div className="kinbox-attach-card">
                        <span className="kinbox-attach-badge fig">FIG</span>
                        <div className="kinbox-attach-info">
                          <b>Project-Template1.fig</b>
                          <small>2 MB · Download</small>
                        </div>
                      </div>
                      <div className="kinbox-attach-card">
                        <span className="kinbox-attach-badge meet">MEET</span>
                        <div className="kinbox-attach-info">
                          <b>Meeting With Client</b>
                          <small>meet.google.com/qwer-wer-ouy</small>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Docked Composer Card at bottom */}
                {answerable ? (
                  <div className="kinbox-pane-docked-comp">
                    <ReplyBox
                      key={answerable.id}
                      replyId={answerable.id}
                      name={open.c.lead_name || open.c.to_email}
                      email={open.c.to_email}
                      subject={names.camps[open.c.campaign_id] ?? "Collaboration Opportunity"}
                      demo={demo}
                      editable={editable}
                      manage={manage}
                      booking={booking}
                      waiting={open.waiting}
                      boxRef={kitBox}
                      toast={toast}
                      onDone={() => markDone(open.waiting)}
                      onSent={(days) => {
                        if (days) {
                          const t = new Date(Date.now() + days * 86400000);
                          setConv({ snoozed_until: t.toISOString() }, `Sent. Back in To answer on ${t.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}.`);
                        }
                        load();
                      }}
                    />
                  </div>
                ) : null}
              </>
            ) : (
              <div className="kinbox-pane-empty">
                <Line name="inbox" />
                <p>Select a conversation from the left to view the thread and reply.</p>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
