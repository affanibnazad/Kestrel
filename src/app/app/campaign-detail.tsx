"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Line, Tip } from "@/components/ui";
import { askConfirm, askText } from "@/components/dialog";
import type { LeadRow } from "@/lib/leads";
import { SAFE_DAILY, type Mailbox } from "@/lib/mail";
import { BizAvatar, siteOfEmail } from "./biz";
import { scoreEmail } from "@/lib/spamguard";
import { AI_FIELDS, LEAD_STATUS, STATUS_NAMES, TIME_ZONES, dayOfLead, firstEmailDays, firstEmailPlan, isHeld, isReady, plainName, rate, stageName, stepsOf, type BoxToday, type Campaign, type CampaignLeadStatus, type ReadyLead, type StepStat } from "@/lib/campaign";
import { emailStepsProblem, fieldsIn, isTaskStep, type Step } from "@/lib/sequence";
import { emailIssue } from "@/lib/email-check";
import { EMPTY_OFFER, EMPTY_SENDER, makeDraft, type Offer, type Sender } from "@/lib/ai";

// One campaign, organised like the leading tools: Analytics · Leads · Sequence · Schedule · Options.
// A Not started campaign shows a "Ready to start" checklist (email account, leads with written emails, test, Start) with
// the test next to Start. Stopped campaigns that sent nothing can be reopened; any campaign can be duplicated.
export type Seq = { id: string; name: string; weekdays_only: boolean; steps?: Step[] };
export type Draft = ReadyLead & { name: string | null; sequence?: string | null };
export type Count = Partial<Record<CampaignLeadStatus, number>> & { total?: number; started?: number };
type Tab = "analytics" | "leads" | "sequences" | "schedule" | "options";
type Row = { id: string; lead_id: string | null; to_email: string; lead_name: string | null; status: CampaignLeadStatus; stage?: string | null; next_step: number; next_at: string | null; first_sent_at: string | null; steps?: { day: number; subject: string; body: string }[] };
type Form = Pick<Campaign, "name" | "sequence_id" | "mailbox_ids" | "time_zone" | "window_start" | "window_end" | "weekdays_only" | "track_opens" | "verify_emails" | "lead_time_zone" | "stop_company">;
type Named = { id: string; name: string };

type VariantStat = { variant: string; leads: number; started: number; replied: number; positive: number; bounced: number; unsubscribed: number };
const HELP = {
  ab: "Each lead got one subject line (an even split). Compare reply rates, not opens. Wait for 30+ started per variant before choosing; then keep the winner in Sequences.",
  leads: "Only leads with an email and a written email are used. Write them in Kestrel AI → Score and write, or fill the sequence as written. Do-not-contact leads are never emailed.",
  hours: "Emails go out only between these hours. Best practice: weekdays only.",
  test: "Sends every step of one lead's emails to you (not to the lead), so you can check they look right and land in your inbox, not spam. Needed once; a copy of a tested campaign (same sequence and email accounts) keeps the test.",
  start: "Start freezes the written emails of the chosen leads. Changing a draft later does not change a running campaign.",
  steps: "Each lead gets its own written emails (made in Kestrel AI → Score and write with this sequence, or filled from the sequence as written). Shown here is one lead's version as an example. Follow-ups go only to people who did not reply.",
  opens: "Opens are estimates: Gmail counts the first open only, Apple Mail can open emails by itself. Decide by replies.",
  written: "Each lead's own written emails are sent. This picks which drafts count: only those written with this sequence, or any.",
  stop: "Pause: sending waits until you click Resume. Stop: the campaign ends for good (if nothing was sent yet you can reopen it; otherwise use Duplicate).",
};
const when = (s: string | null | undefined) => (s ? new Date(s).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
const day = (d: Date | null) => (d ? d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }) : "—");
const KIND_NAME: Record<string, string> = { linkedin: "LinkedIn task", call: "Call task", task: "Task" };
const stepName = (i: number, st?: object | null) => {
  const kind = (st as { kind?: string } | null | undefined)?.kind;
  return kind && kind !== "email" ? KIND_NAME[kind] ?? "Task" : i === 0 ? "First email" : `Follow-up ${i}`;
};

export default function CampaignDetail({ campaign, count, sequences, boxes, today, drafts, usedIn = new Map(), byId, blocked, tracking, demo, editable, tested, me, lists, inList, toast, go, onBack, onOpen, reload }: {
  campaign: Campaign; count: Count; sequences: Seq[]; boxes: Mailbox[]; today: Record<string, BoxToday>; drafts: Draft[]; usedIn?: Map<string, string[]>; byId: Map<string, LeadRow>; blocked: (l: LeadRow) => boolean; tracking: boolean;
  demo: boolean; editable: boolean; tested: boolean; me: string; lists: Named[]; inList: Record<string, string[]>;
  toast: (t: string) => void; go: (view: string) => void; onBack: () => void; onOpen: (id: string) => void; reload: () => Promise<void> | void;
}) {
  const c = campaign;
  const [tab, setTab] = useState<Tab>(c.status === "draft" ? "leads" : "analytics");
  const [form, setForm] = useState<Form>({ name: c.name, sequence_id: c.sequence_id, mailbox_ids: c.mailbox_ids, time_zone: c.time_zone, window_start: c.window_start,
    window_end: c.window_end, weekdays_only: c.weekdays_only, track_opens: c.track_opens, verify_emails: c.verify_emails, lead_time_zone: c.lead_time_zone, stop_company: c.stop_company });
  const [who, setWho] = useState<string>("good");   // "good" | "all" | "list:<id>"
  const [testLead, setTestLead] = useState("");
  const [testQ, setTestQ] = useState("");
  const [withBad, setWithBad] = useState(false);   // include leads whose email looks wrong (careers@, placeholders…)
  // Leads another campaign already has are left out by default (Affan, 18 Nov 2026: a new campaign showed the first one's leads).
  const [withUsed, setWithUsed] = useState(false);
  const [showBad, setShowBad] = useState(false);
  const [busy, setBusy] = useState("");
  const [stats, setStats] = useState<StepStat[] | null>(null);
  const [variants, setVariants] = useState<VariantStat[]>([]);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [q, setQ] = useState("");
  const draft = c.status === "draft", changeable = editable && (draft || c.status === "paused");
  // Accounts can also change while sending (database 054, campaign_set_accounts): unsent leads move to the new accounts.
  const [showBroken, setShowBroken] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const acctEditable = editable && ["draft", "running", "paused"].includes(c.status);
  const sb = supabaseBrowser;

  const loadMore = useCallback(async () => {
    if (demo) {
      setStats([{ step: 0, sent: 30, replies: 2, bounced: 1, unsubscribed: 1, opened: 14 }, { step: 1, sent: 12, replies: 1, bounced: 0, unsubscribed: 0, opened: 5 }]);
      setVariants([{ variant: "A", leads: 20, started: 15, replied: 1, positive: 0, bounced: 1, unsubscribed: 0 }, { variant: "B", leads: 20, started: 15, replied: 2, positive: 1, bounced: 0, unsubscribed: 1 }]);
      setRows([{ id: "x1", lead_id: null, to_email: "hello@harbour-example.test", lead_name: "Harbour Social", status: "replied", stage: "interested", next_step: 1, next_at: null, first_sent_at: new Date().toISOString() },
        { id: "x2", lead_id: null, to_email: "team@oakline-example.test", lead_name: "Oakline Media", status: "active", stage: null, next_step: 1, next_at: new Date(Date.now() + 4 * 86400000).toISOString(), first_sent_at: new Date().toISOString() }]);
      return;
    }
    const cols = "id,lead_id,to_email,lead_name,status,next_step,next_at,first_sent_at";
    const [s, r, v] = await Promise.all([
      sb().rpc("campaign_step_stats", { campaign: c.id }),
      sb().from("campaign_leads").select(`${cols},stage`).eq("campaign_id", c.id).order("first_sent_at", { ascending: false, nullsFirst: false }).limit(5000),
      sb().rpc("campaign_variant_stats", { campaign: c.id }),
    ]);
    setStats((s.data as StepStat[] | null) ?? []);
    setVariants(v.error ? [] : ((v.data as VariantStat[] | null) ?? []));
    if (r.error) {
      const r2 = await sb().from("campaign_leads").select(cols).eq("campaign_id", c.id).order("first_sent_at", { ascending: false, nullsFirst: false }).limit(5000);
      setRows((r2.data as Row[] | null) ?? []);
    } else setRows((r.data as Row[] | null) ?? []);
  }, [c.id, demo, sb]);
  const countKey = JSON.stringify(count);
  useEffect(() => { Promise.resolve().then(loadMore); }, [loadMore, countKey]);

  const seq = sequences.find((s) => s.id === form.sequence_id) ?? null;
  // Which leads Start would use, and why others are left out.
  const chosen = useMemo(() => {
    const listIds = who.startsWith("list:") ? new Set(inList[who.slice(5)] ?? []) : null;
    const out = { ready: [] as Draft[], noEmail: 0, noDraft: 0, dnc: 0, otherSeq: 0, used: 0, fillable: [] as Draft[], bad: [] as { d: Draft; reason: string }[], warn: 0, held: 0,
      broken: [] as { d: Draft; reason: string }[] };
    for (const d of drafts) {
      const l = byId.get(d.id);
      if (!l || l.status === "removed") continue;
      if (listIds ? !listIds.has(d.id) : who === "good" && l.verdict !== "Good") continue;
      if (blocked(l)) { out.dnc++; continue; }
      if (!withUsed && (usedIn.get(d.id) ?? []).some((id) => id !== c.id)) { out.used++; continue; }
      if (!d.email) { out.noEmail++; continue; }
      const issue = emailIssue(d.email, l.website);
      if (issue?.level === "bad" && !withBad) { out.bad.push({ d, reason: issue.reason }); continue; }
      if (issue?.level === "warn") out.warn++;
      if (!stepsOf(d.outreach).length) { out.noDraft++; out.fillable.push(d); continue; }
      if (form.sequence_id && d.sequence && d.sequence !== form.sequence_id) { out.otherSeq++; continue; }
      // The database would skip it at Start (email_steps_problem): say so now, with the reason (feedback #4).
      const problem = emailStepsProblem(stepsOf(d.outreach) as { subject?: string; body?: string; kind?: string }[]);
      if (problem) { out.broken.push({ d, reason: problem }); continue; }
      if (isHeld(d.outreach)) { out.held++; continue; }   // database 068 leaves it out too
      if (isReady(d)) out.ready.push(d);
    }
    return out;
  }, [drafts, byId, who, inList, blocked, form.sequence_id, withBad, withUsed, usedIn, c.id]);
  const usable = (b: Mailbox) => b.status === "ok" && b.imap_ok === true;
  const picked = boxes.filter((b) => form.mailbox_ids.includes(b.id) && usable(b));
  const fullPerDay = picked.reduce((n, b) => n + Math.min(b.daily_limit, 200), 0);
  const todayPerDay = picked.reduce((n, b) => n + Math.min(today[b.id]?.limit_today ?? b.daily_limit, 200), 0);
  const eta = firstEmailDays(chosen.ready.length, picked.map((b) => ({ ...today[b.id], daily_limit: b.daily_limit })), form.weekdays_only);
  // Send order (Affan, 18 Nov 2026): leads marked "Send first" go first, in the order marked; the rest follow day by
  // day. Start passes this order and the database keeps it (053). Marks are kept in this browser until Start.
  const markKey = `kestrel-camp-first:${c.id}`;
  const [first, setFirst] = useState<string[]>([]);
  useEffect(() => { Promise.resolve().then(() => { try { const v = JSON.parse(localStorage.getItem(markKey) || "[]"); if (Array.isArray(v)) setFirst(v.filter((x) => typeof x === "string")); } catch { /* no saved marks */ } }); }, [markKey]);
  const setMarks = (ids: string[]) => { setFirst(ids); try { if (ids.length) localStorage.setItem(markKey, JSON.stringify(ids)); else localStorage.removeItem(markKey); } catch { /* private window */ } };
  const ordered = useMemo(() => {
    const byReady = new Map(chosen.ready.map((d) => [d.id, d]));
    const top = first.filter((id) => byReady.has(id)).map((id) => byReady.get(id)!);
    const topIds = new Set(top.map((d) => d.id));
    return [...top, ...chosen.ready.filter((d) => !topIds.has(d.id))];
  }, [chosen.ready, first]);
  const marked = ordered.filter((d) => first.includes(d.id)).length;
  const plan = firstEmailPlan(ordered.length, picked.map((b) => ({ ...today[b.id], daily_limit: b.daily_limit })), form.weekdays_only);
  const followDays = (seq?.steps ?? []).slice(1).filter((s) => !isTaskStep(s)).map((s) => s.day);
  // Why Start is greyed out, said next to it (Affan, 18 Nov 2026: "I can't start the campaign, why?").
  const startBlock = !editable ? "Your role or plan cannot start campaigns."
    : !picked.length ? "Choose an email account first (step 1)."
    : [...form.mailbox_ids].sort().join() !== [...c.mailbox_ids].sort().join() ? "Save the email accounts first (step 1)."
    : !chosen.ready.length ? "Needs leads with written emails (step 2)."
    : !tested ? "Send the test to yourself first (step 3)." : "";
  // A sending address on the team's own Do-not-contact list (often from a test reply): warn, it is usually a mistake (#11).
  const pickedKey = picked.map((b) => b.email.toLowerCase()).sort().join(",");
  const [dncBoxes, setDncBoxes] = useState<string[]>([]);
  useEffect(() => {
    if (demo || !pickedKey) return;
    let live = true;
    sb().from("do_not_contact").select("entry").in("entry", pickedKey.split(",")).then(({ data }) => { if (live) setDncBoxes(((data ?? []) as { entry: string }[]).map((x) => x.entry)); });
    return () => { live = false; };
  }, [demo, pickedKey, sb]);
  const boxesChanged = [...form.mailbox_ids].sort().join() !== [...c.mailbox_ids].sort().join();
  const dirty = JSON.stringify(form) !== JSON.stringify({ name: c.name, sequence_id: c.sequence_id, mailbox_ids: c.mailbox_ids, time_zone: c.time_zone, window_start: c.window_start,
    window_end: c.window_end, weekdays_only: c.weekdays_only, track_opens: c.track_opens, verify_emails: c.verify_emails, lead_time_zone: c.lead_time_zone, stop_company: c.stop_company });
  // A sequence with no AI-only fields can be sent as written, filled from each lead's details.
  const asWritten = Boolean(seq?.steps?.length) && !(seq?.steps ?? []).some((s) => fieldsIn(`${s.subject} ${s.body}`).some((f) => AI_FIELDS.includes(f)));

  async function save(quiet = false) {
    if (!form.name.trim()) { toast("Give the campaign a name."); return false; }
    if (!form.mailbox_ids.length) { toast("Choose at least one email account (Options)."); return false; }
    if (demo) { toast("Saving needs a signed-in team."); return false; }
    // A started campaign changes accounts through the database (unsent leads move over; emailed leads keep their thread).
    if (!draft && boxesChanged) {
      const { data, error } = await sb().rpc("campaign_set_accounts", { campaign: c.id, account_ids: form.mailbox_ids });
      if (error) { toast(/campaign_set_accounts|schema cache/i.test(error.message) ? "Changing the accounts of a started campaign needs the newest database update (054)." : error.message); return false; }
      const moved = Number((data as { moved?: number } | null)?.moved ?? 0);
      if (c.status === "running") { if (!quiet) toast(`Accounts saved. ${moved} ${moved === 1 ? "lead" : "leads"} not emailed yet now go out from the new accounts.`); reload(); return true; }
    }
    const { lead_time_zone, stop_company, mailbox_ids, ...rest } = form;
    const row = { ...rest, ...(draft ? { mailbox_ids } : {}), name: form.name.trim().slice(0, 80), track_opens: form.track_opens && tracking,
      ...(typeof c.lead_time_zone === "boolean" ? { lead_time_zone, stop_company } : {}) };
    const { error } = await sb().from("campaigns").update(row).eq("id", c.id);
    if (error) { toast(/duplicate|unique/.test(error.message) ? "A campaign with that name already exists." : error.message); return false; }
    if (!quiet) toast("Saved.");
    reload();
    return true;
  }
  async function sendTest() {
    if (!testLead) { toast("Choose a lead to test with."); return; }
    if (dirty && !(await save(true))) return;
    if (demo) { toast("Testing needs a signed-in team."); return; }
    setBusy("test");
    const r = await fetch("/api/mail/campaign-test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ campaign: c.id, lead: testLead }) })
      .then((x) => x.json()).catch(() => ({ error: "No connection." })) as { sent?: number; to?: string; error?: string; recorded?: boolean };
    setBusy("");
    // Stays on screen under step 3 (feedback #3), not only a toast.
    setTestResult(r.error ? { ok: false, text: r.error } : { ok: true, text: `✓ Test sent: ${r.sent} ${r.sent === 1 ? "email" : "emails"} to ${r.to}. Check they look right and landed in your inbox, not spam.` });
    reload();
  }
  // Fill this campaign's sequence for leads with no written email, from their own details (no AI).
  async function fillAsWritten() {
    if (!seq?.steps || demo) { toast(demo ? "This needs a signed-in team." : "Choose a sequence first."); return; }
    const leads = chosen.fillable;
    if (!(await askConfirm(`Write "${seq.name}" as it is for ${leads.length} ${leads.length === 1 ? "lead" : "leads"}?\nEach gets the sequence's emails with their company name filled in. No AI is used. You can change any lead's email afterwards.`, { ok: "Fill emails" }))) return;
    setBusy("fill");
    const [t, o] = await Promise.all([sb().from("team_ai").select("*").maybeSingle(), sb().from("offer_profiles").select("*").order("name")]);
    const set = (t.data ?? {}) as Record<string, unknown>;
    const sender = Object.fromEntries(Object.keys(EMPTY_SENDER).map((k) => [k, String(set[k] ?? "")])) as Sender;
    const offers = (o.data ?? []) as Offer[];
    const offer = offers.find((x) => x.id === set.offer_id) ?? offers[0] ?? EMPTY_OFFER;
    if (!sender.sender_name.trim() || !sender.address.trim()) { setBusy(""); toast("Add your sender name and postal address first (Kestrel AI → Score and write → Emails come from)."); go("ai"); return; }
    let done = 0, missing = 0;
    for (let i = 0; i < leads.length; i += 200) {
      const part = leads.slice(i, i + 200);
      const { data } = await sb().from("leads").select("id,name,data").in("id", part.map((d) => d.id));
      for (const l of (data ?? []) as { id: string; name: string | null; data: Record<string, unknown> | null }[]) {
        const first = plainName(l.name) || "there";
        const outreach = { ...makeDraft({ first_name: first, subject: "", icebreaker: "", question: "" }, offer, sender, "sequence", { steps: seq.steps, id: seq.id }, [], l.id), by: "sequence" };
        if (outreach.steps?.some((s) => /\[[A-Z_]{3,}\]/.test(`${s.subject} ${s.body}`))) { missing++; continue; }
        const { error } = await sb().from("leads").update({ data: { ...(l.data ?? {}), outreach } }).eq("id", l.id);
        if (!error) done++;
      }
    }
    setBusy("");
    toast(`Filled ${done} ${done === 1 ? "lead" : "leads"}${missing ? `; ${missing} skipped (a merge field had no value, e.g. your one line or booking link)` : ""}.`);
    reload();
  }
  async function start() {
    if (dirty && !(await save(true))) return;
    if (!tested) { toast("Send a test to yourself first (step 3 above)."); return; }
    const n = chosen.ready.length;
    if (!n) { toast("No leads are ready (they need an email and a written email)."); setTab("leads"); return; }
    const subj = (d: Draft, st: { subject: string }, i: number) => st.subject || (i === 0 ? String((d.outreach as { subject?: string } | null)?.subject ?? "") : "");
    const redStep = (d: Draft) => stepsOf(d.outreach).map((st, i) => ({ ...st, subject: subj(d, st, i), i })).find((st) => !(st as { kind?: string }).kind && scoreEmail({ subject: st.subject, body: st.body, step: st.i }).blocked);
    const red = chosen.ready.filter((d) => redStep(d));
    if (red.length) {
      const first = red[0], st = redStep(first);
      toast(`${red.length} lead${red.length === 1 ? "'s emails have" : "s' emails have"} red spam items (first: ${first.name || first.email}). Fix them, then start.`);
      if (st) window.dispatchEvent(new CustomEvent("kestrel-spam-check", { detail: { subject: st.subject, body: st.body, mode: "email", sent: true } }));
      return;
    }
    const same = new Map<string, number>();
    for (const d of chosen.ready) { const b = (stepsOf(d.outreach)[0]?.body ?? "").trim(); if (b) same.set(b, (same.get(b) ?? 0) + 1); }
    const most = Math.max(0, ...same.values());
    if (most > 10 && !(await askConfirm(`${most} leads would get exactly the same first email.\nSpam filters notice many identical emails. Personal lines (Kestrel AI → Score and write) reach the inbox best. Start anyway?`, { ok: "Start anyway" }))) { setTab("leads"); return; }
    if (!(await askConfirm(`Start "${form.name}"? Real emails go to ${n} ${n === 1 ? "lead" : "leads"}.\n${picked.length} email account(s): ${todayPerDay} first emails today, rising by 2 a day per account up to ${fullPerDay} a day (slow start).\nFirst emails take about ${eta.days} sending ${eta.days === 1 ? "day" : "days"} (until ${day(eta.until)}), ${form.window_start}:00–${form.window_end}:00${form.weekdays_only ? ", weekdays only" : ""}. Follow-ups come after.`, { ok: "Start campaign" }))) return;
    if (demo) { toast("Starting needs a signed-in team."); return; }
    setBusy("start");
    const { data, error } = await sb().rpc("start_campaign", { campaign: c.id, lead_ids: ordered.map((d) => d.id) });
    setBusy("");
    if (error) { toast(error.message); return; }
    const r = data as { added: number; skipped: number };
    toast(`Started: ${r.added} leads queued${r.skipped ? `, ${r.skipped} skipped (see Leads for the reason)` : ""}.`);
    setTab(r.skipped ? "leads" : "analytics"); reload();
  }
  async function act(fn: "pause_campaign" | "stop_campaign" | "reopen_campaign", args: object, done: string, ask?: string, ok?: string) {
    if (ask && !(await askConfirm(ask, { ok, danger: fn === "stop_campaign" }))) return;
    if (demo) { toast("This needs a signed-in team."); return; }
    const { error } = await sb().rpc(fn, args);
    if (error) toast(/reopen_campaign|schema cache/i.test(error.message) ? "Reopening is coming soon to your workspace." : error.message); else { toast(done); reload(); }
  }
  async function duplicate() {
    const name = await askText("Name the copy", `${c.name} (copy)`.slice(0, 80), { ok: "Duplicate" });
    if (!name) return;
    if (demo) { toast("This needs a signed-in team."); return; }
    const { data, error } = await sb().rpc("duplicate_campaign", { campaign: c.id, new_name: name });
    if (error) { toast(/duplicate_campaign|schema cache/i.test(error.message) ? "Duplicate is coming soon to your workspace." : error.message); return; }
    toast("Copy made. It keeps the settings and the test.");
    await reload(); onOpen(String(data));
  }
  async function remove() {
    const hasLeads = (count.total ?? 0) > 0;
    if (!(await askConfirm(`Delete "${c.name}"?\n${hasLeads ? "Its leads and sending history are deleted too, and it cannot be restored." : "You can restore it for 30 days from Campaigns → Recently deleted."}`, { ok: "Delete", danger: true }))) return;
    if (demo) { toast("This needs a signed-in team."); return; }
    const { error } = await sb().from("campaigns").delete().eq("id", c.id);
    if (error) toast(error.message); else { onBack(); reload(); }
  }

  // ---------- numbers
  const total = count.total ?? 0, started = count.started ?? 0;
  const sum = (k: keyof Omit<StepStat, "step">) => (stats ?? []).reduce((n, s) => n + Number(s[k] || 0), 0);
  const sent = sum("sent"), replied = count.replied ?? 0;
  const example = draft ? chosen.ready[0] : undefined;
  const [frozen, setFrozen] = useState<Row["steps"] | null>(null);
  useEffect(() => {
    if (draft || demo || tab !== "sequences" || frozen) return;
    let live = true;
    sb().from("campaign_leads").select("steps").eq("campaign_id", c.id).limit(1).maybeSingle().then(({ data }) => { if (live) setFrozen(((data as { steps?: Row["steps"] } | null)?.steps) ?? []); });
    return () => { live = false; };
  }, [draft, demo, tab, frozen, c.id, sb]);
  const steps = draft ? stepsOf(example?.outreach) : demo ? [{ day: 0, subject: "short-form edits for retail brands", body: "Hey Harbour Social,\n\nSaw you post short-form video every week…" }, { day: 5, subject: "", body: "Hey Harbour Social,\n\nDo your clients…" }] : (frozen ?? []);
  const shownRows = (rows ?? []).filter((r) => !q || `${r.to_email} ${r.lead_name ?? ""}`.toLowerCase().includes(q.trim().toLowerCase()));
  const testable = chosen.ready.filter((d) => !testQ || `${d.name ?? ""} ${d.email ?? ""}`.toLowerCase().includes(testQ.trim().toLowerCase()));
  const skipped = c.skipped ?? [];
  const boxNames = picked.map((b) => b.email);

  const statusTone = c.status === "running" ? "#10B981" : c.status === "paused" ? "#F59E0B" : c.status === "stopped" ? "#EF4444" : "#64748B";
  const isRunning = c.status === "running";
  const isPaused = c.status === "paused";
  const positiveReplies = (rows ?? []).filter((r) => ["interested", "meeting", "won"].includes(r.stage ?? "")).length;
  const bouncedCount = count.bounced ?? 0;
  const unsubCount = count.unsubscribed ?? 0;
  const deliveredCount = Math.max(0, sent - bouncedCount);
  const deliveryPct = sent > 0 ? (((sent - bouncedCount) / sent) * 100).toFixed(1) : "100";

  return (
    <div className={`app-page${" kpd-main"}`}>
      {/* Modern Redesigned Campaign Header */}
      <div className="kpd-detail-header">
        <button type="button" className="kpd-back-link" onClick={onBack}>
          <span className="kpd-back-arrow">←</span> Back to campaigns
        </button>
        <div className="kpd-title-row">
          <div className="kpd-title-block">
            <div className="kpd-title-status-line">
              <h1 className="kpd-campaign-title">{c.name}</h1>
              <span className="kpd-status-badge">
                <span className="kpd-status-dot-pulse" style={{ backgroundColor: statusTone }} />
                <span>{STATUS_NAMES[c.status]}</span>
              </span>
            </div>
            <div className="kpd-meta-chips">
              <span>{boxNames.length ? boxNames[0] + (boxNames.length > 1 ? ` +${boxNames.length - 1}` : "") : "No email account yet"}</span>
              <span className="kpd-meta-bullet">•</span>
              <span>Sequence: {seq?.name || "None"}</span>
              <span className="kpd-meta-bullet">•</span>
              <span>{c.window_start}:00–{c.window_end}:00 ({c.weekdays_only ? "Weekdays" : "Daily"})</span>
            </div>
          </div>
          <div className="kpd-header-actions">
            {isRunning ? (
              <button type="button" className="kpd-btn-action" disabled={!editable} onClick={() => act("pause_campaign", { campaign: c.id, paused: true }, "Paused. Nothing more is sent until you resume.")}>
                <Line name="clock" /> Pause
              </button>
            ) : isPaused ? (
              <button type="button" className="kpd-btn-action resume" disabled={!editable} onClick={() => act("pause_campaign", { campaign: c.id, paused: false }, "Sending again.")}>
                <Line name="send" /> Resume
              </button>
            ) : draft ? (
              <button type="button" className="kpd-btn-action primary" disabled={Boolean(startBlock) || busy === "start"} onClick={start}>
                <Line name="send" /> Start campaign
              </button>
            ) : null}
            <details className="kdrop kdrop-right kpd-more">
              <summary className="kpd-more-btn" aria-label="Campaign actions"><Line name="more" /></summary>
              <div className="kmenu">
                <button type="button" onClick={onBack}>All campaigns</button>
                {isRunning ? <button type="button" disabled={!editable} onClick={() => act("pause_campaign", { campaign: c.id, paused: true }, "Paused. Nothing more is sent until you resume.")}>Pause</button> : null}
                {isPaused ? <button type="button" disabled={!editable} onClick={() => act("pause_campaign", { campaign: c.id, paused: false }, "Sending again.")}>Resume</button> : null}
                {isRunning || isPaused ? (
                  <button type="button" className="danger" disabled={!editable} title={HELP.stop} onClick={() => act("stop_campaign", { campaign: c.id }, "Stopped for good.", `Stop "${c.name}" for good?\nNo more emails or follow-ups are sent. To only wait, use Pause instead.${started ? "" : "\nNothing was sent yet, so you could reopen it later."}`, "Stop for good")}>Stop for good</button>
                ) : null}
                {c.status === "stopped" && !started ? (
                  <button type="button" disabled={!editable} onClick={() => act("reopen_campaign", { campaign: c.id }, "Back to Not started. Change what you need, then start again.", `Reopen "${c.name}"?\nNothing was sent from it. It goes back to Not started with the same settings and test; choose the leads again.`, "Reopen")}>Reopen</button>
                ) : null}
                {!draft ? <button type="button" disabled={!editable} onClick={duplicate}>Duplicate</button> : null}
              </div>
            </details>
          </div>
        </div>
        {c.paused_reason ? <p className="plan-msg dlv-bad">{c.paused_reason}</p> : null}
      </div>
      

      {draft ? (
        <section className="join-card camp-ready" aria-label="Ready to start">
          <b>Ready to start <Tip text={HELP.start} /></b>
          <ol className="camp-check">
            <li className={picked.length ? "done" : ""}><span><b>Email account</b> {!boxes.some(usable) ? "none ready yet" : changeable ? <>send from <Tip text="Click an account to use it or not. Kestrel rotates between the chosen ones, each up to its own daily limit. Changing them needs a new test to yourself." /></> : `${picked.length} chosen: ${boxNames.slice(0, 3).join(", ")}${boxNames.length > 3 ? "…" : ""}`}
                {boxes.some(usable) && changeable ? (
                  <span className="camp-acc" role="group" aria-label="Email accounts to send from">{boxes.filter(usable).map((b) => { const on = form.mailbox_ids.includes(b.id); return (
                    <button key={b.id} type="button" className={on ? "on" : ""} aria-pressed={on} title={`${today[b.id]?.limit_today ?? b.daily_limit} today, up to ${b.daily_limit} a day`}
                      onClick={() => setForm({ ...form, mailbox_ids: on ? form.mailbox_ids.filter((x) => x !== b.id) : [...form.mailbox_ids, b.id] })}>{on ? "✓ " : ""}{b.email}</button>); })}
                  </span>) : null}
                {dncBoxes.length ? <small className="camp-acc-note dlv-bad">{dncBoxes.join(", ")} {dncBoxes.length === 1 ? "is" : "are"} on your Do-not-contact list, probably from a test reply. <button type="button" className="link-btn" onClick={() => go("dnc")}>Open Do-not-contact</button></small> : null}
                {changeable && boxesChanged ? <small className="camp-acc-note">{picked.length ? "Save, then send a new test." : "Choose at least one."}</small> : null}</span>
              {!boxes.some(usable) ? <button type="button" className="link-btn" onClick={() => go("mailboxes")}>Add an email account</button> : null}
              {changeable && boxesChanged && picked.length ? <button type="button" className="btn go small" onClick={() => save()}>Save</button> : null}</li>
            <li className={chosen.ready.length ? "done" : ""}><span><b>Leads with written emails</b> {chosen.ready.length.toLocaleString()} ready{chosen.noDraft ? ` · ${chosen.noDraft} without a written email` : ""}{chosen.bad.length ? ` · ${chosen.bad.length} doubtful emails left out` : ""}{chosen.held ? ` · ${chosen.held} held by the QC bot (approve them in the Bot room)` : ""}
              {chosen.broken.length ? <> · <button type="button" className="link-btn danger" onClick={() => { setTab("leads"); setShowBroken(true); }}>{chosen.broken.length} need a fix</button> <Tip text="Their written emails would be skipped at Start: no opt-out line, an empty merge field, a money amount or price words. Open the lead and change the email, or write it again." /></> : null}</span>
              {chosen.noDraft && asWritten && changeable ? <button type="button" className="link-btn" disabled={busy === "fill"} onClick={fillAsWritten}>{busy === "fill" ? "Filling…" : `Fill "${seq?.name}" as written for ${chosen.noDraft}`}</button> : null}
              {chosen.noDraft ? <button type="button" className="link-btn" onClick={() => go("ai")}>Write emails with AI</button> : null}
              <button type="button" className="link-btn" onClick={() => setTab("leads")}>Choose leads</button></li>
            <li className={tested ? "done" : ""}><span><b>Test to yourself</b> {tested ? (c.tested_at ? `sent ${when(c.tested_at)}` : "done (same sequence and accounts as a tested campaign)") : "needed once"} <Tip text={HELP.test} /></span>
              {!chosen.ready.length ? <span className="dr-muted">Needs at least one ready lead first.</span> : (
                <span className="join-row camp-test-row">
                  <input type="search" list={`test-${c.id}`} value={testQ} placeholder="Search a lead to test with" aria-label="Lead to test with"
                    onChange={(e) => { setTestQ(e.target.value); const hit = chosen.ready.find((d) => `${d.name || d.email} · ${d.email}` === e.target.value); setTestLead(hit?.id ?? ""); }} />
                  <datalist id={`test-${c.id}`}>{testable.slice(0, 300).map((d) => <option key={d.id} value={`${d.name || d.email} · ${d.email}`} />)}</datalist>
                  <button type="button" className="btn glass small" disabled={!editable || busy === "test" || !testLead} onClick={sendTest}>{busy === "test" ? "Sending…" : `Send test to ${me || "me"}`}</button>
                </span>)}
              {testResult ? <small className={`camp-test-res${testResult.ok ? "" : " dlv-bad"}`} role="status">{testResult.text}</small> : null}</li>
            <li><span><b>Start</b> {chosen.ready.length ? `about ${eta.days} sending ${eta.days === 1 ? "day" : "days"} for the first emails (until ${day(eta.until)})` : "—"}
              <Tip text={`New email accounts start slowly: 5 emails a day, then 2 more each day up to their daily limit, so they stay out of spam. Today: ${todayPerDay} a day from ${picked.length} account(s). More accounts make it faster.`} /></span>
              {startBlock ? <small className="camp-why">{startBlock}</small> : null}
              <button type="button" className="btn go small" disabled={Boolean(startBlock) || busy === "start"} onClick={start}>{busy === "start" ? "Starting…" : "Start campaign"}</button></li>
          </ol>
        </section>
      ) : null}

      <div className="seg camp-tabs" role="tablist" aria-label="Campaign sections">
        {([["analytics", "Analytics"], ["leads", "Leads"], ["sequences", "Sequence"], ["schedule", "Schedule"], ["options", "Options"]] as [Tab, string][]).map(([id, name]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "on" : ""} onClick={() => setTab(id)}>{name}{id === "leads" && skipped.length ? ` (${skipped.length} skipped)` : ""}</button>
        ))}
      </div>

      {tab === "analytics" ? (
        <>
          <div className="kpd-kpis-grid">
            <div className="kpd-kpi-card">
              <span className="kpd-kpi-label">Sequence started</span>
              <div className="kpd-kpi-val-row">
                <b className="kpd-kpi-num">{started.toLocaleString()}</b>
                <span className="kpd-kpi-sub">of {total.toLocaleString()} leads</span>
              </div>
            </div>
            <div className="kpd-kpi-card">
              <span className="kpd-kpi-label">Emails sent</span>
              <div className="kpd-kpi-val-row">
                <b className="kpd-kpi-num">{sent.toLocaleString()}</b>
                <span className="kpd-kpi-sub">total sent</span>
              </div>
            </div>
            <div className="kpd-kpi-card">
              <span className="kpd-kpi-label">Opened <Tip text={HELP.opens} /></span>
              <div className="kpd-kpi-val-row">
                <b className="kpd-kpi-num">{c.track_opens ? sum("opened").toLocaleString() : "Off"}</b>
                <span className="kpd-kpi-sub">{c.track_opens ? rate(sum("opened"), started) : "disabled"}</span>
              </div>
            </div>
            <div className="kpd-kpi-card">
              <span className="kpd-kpi-label">Replied</span>
              <div className="kpd-kpi-val-row">
                <b className="kpd-kpi-num">{replied.toLocaleString()}</b>
                <span className="kpd-kpi-sub">{rate(replied, started)}</span>
              </div>
            </div>

            <div className="kpd-kpi-card">
              <span className="kpd-kpi-label">Positive <Tip text="Replies marked Interested, Meeting booked or Won on the Replies page." /></span>
              <div className="kpd-kpi-val-row">
                <b className="kpd-kpi-num">{positiveReplies.toLocaleString()}</b>
                <span className="kpd-kpi-sub">{replied > 0 ? `${((positiveReplies / replied) * 100).toFixed(0)}% of replies` : "—"}</span>
              </div>
            </div>
            <div className="kpd-kpi-card">
              <span className="kpd-kpi-label">Bounced</span>
              <div className="kpd-kpi-val-row">
                <b className={`kpd-kpi-num${started && bouncedCount / started > 0.05 ? " dlv-bad" : ""}`}>{bouncedCount.toLocaleString()}</b>
                <span className="kpd-kpi-sub">{rate(bouncedCount, started)}</span>
              </div>
            </div>
            <div className="kpd-kpi-card">
              <span className="kpd-kpi-label">Unsubscribed</span>
              <div className="kpd-kpi-val-row">
                <b className="kpd-kpi-num">{unsubCount.toLocaleString()}</b>
                <span className="kpd-kpi-sub">{rate(unsubCount, started)}</span>
              </div>
            </div>
            <div className="kpd-kpi-card">
              <span className="kpd-kpi-label">Delivery rate</span>
              <div className="kpd-kpi-val-row">
                <b className="kpd-kpi-num">{deliveryPct}%</b>
                <span className="kpd-kpi-sub">{deliveredCount.toLocaleString()} delivered</span>
              </div>
            </div>
          </div>
          <div className="table-card members camp-steps">
            <table className="leads">
              <thead><tr><th>Step</th><th>Sent</th>{c.track_opens ? <th>Opened</th> : null}<th>Replies</th><th>Reply rate</th><th>Bounced</th><th>Unsubscribed</th></tr></thead>
              <tbody>{(stats ?? []).map((s) => (
                <tr key={s.step}><td>{stepName(s.step, steps[s.step])}</td><td>{s.sent}</td>{c.track_opens ? <td>{s.opened}</td> : null}<td>{s.replies}</td><td>{rate(s.replies, s.sent)}</td><td>{s.bounced}</td><td>{s.unsubscribed}</td></tr>
              ))}</tbody>
            </table>
            {stats && !stats.length ? <div className="empty"><div><b>{draft ? "Not started yet" : "Nothing sent yet"}</b>{c.status === "running" ? <span className="dr-muted"> Emails go out inside the sending hours ({c.window_start}:00–{c.window_end}:00{c.weekdays_only ? ", weekdays" : ""}).</span> : null}</div></div> : null}
            <div className="camp-table-footer" style={{ padding: "12px 18px", fontSize: "12px", color: "var(--k-muted, #64748B)", borderTop: "1px solid var(--k-border, #E2E8F0)", display: "flex", alignItems: "center", gap: "8px" }}>
              <span>Cold email typically sees 1–2% reply rates. Campaigns pause automatically if bounces or unsubscribes exceed 5%.</span>
            </div>
          </div>
          {variants.filter((x) => x.variant !== "none").length > 1 ? (() => {
            const tested2 = variants.filter((x) => x.variant !== "none");
            const enough = tested2.every((x) => x.started >= 30);
            const best = enough ? [...tested2].sort((a, b) => b.replied / Math.max(1, b.started) - a.replied / Math.max(1, a.started))[0].variant : "";
            return (
              <div className="table-card members acct-table camp-ab">
                <table className="leads">
                  <caption>A/B test: subject lines <Tip text={HELP.ab} /></caption>
                  <thead><tr><th>Variant</th><th>Leads</th><th>Started</th><th>Replied</th><th>Reply rate</th><th>Positive</th><th>Bounced</th></tr></thead>
                  <tbody>{variants.map((x) => (
                    <tr key={x.variant}><td><b>{x.variant === "none" ? "Not in the test" : x.variant}</b>{best === x.variant ? <em className="pill good">Leading</em> : null}</td><td>{x.leads}</td><td>{x.started}</td><td>{x.replied}</td>
                      <td>{rate(x.replied, x.started)}</td><td>{x.positive}</td><td>{x.bounced}</td></tr>
                  ))}</tbody>
                </table>
                {!enough ? <p className="camp-note">A leader shows once every variant has 30 or more leads started.</p> : null}
              </div>
            );
          })() : null}
        </>
      ) : null}

      {tab === "leads" ? (draft ? (
        <section className="join-card prof-form camp-form">
          <b>Who gets this campaign <Tip text={HELP.leads} /></b>
          <label className="in"><span>Leads</span>
            <select value={who} onChange={(e) => setWho(e.target.value)}>
              <option value="good">Good leads</option><option value="all">All leads</option>
              {lists.length ? <optgroup label="From a list">{lists.map((l) => <option key={l.id} value={`list:${l.id}`}>{l.name} ({(inList[l.id] ?? []).length})</option>)}</optgroup> : null}
            </select></label>
          <p className="camp-note"><b>{chosen.ready.length.toLocaleString()} ready</b>{chosen.noDraft ? ` · ${chosen.noDraft} without a written email` : ""}{chosen.noEmail ? ` · ${chosen.noEmail} without an email` : ""}{chosen.otherSeq ? ` · ${chosen.otherSeq} written for another sequence` : ""}{chosen.dnc ? ` · ${chosen.dnc} on Do-not-contact` : ""}{chosen.warn ? ` · ${chosen.warn} with an email to check` : ""}{chosen.held ? ` · ${chosen.held} held by the QC bot` : ""}
            {chosen.noDraft ? <> · <button type="button" className="link-btn" onClick={() => go("ai")}>Write emails</button></> : null}</p>
          {chosen.used || withUsed ? (
            <p className="camp-note">{withUsed ? "Leads from your other campaigns are included. The database still skips anyone another campaign is emailing right now." : `${chosen.used.toLocaleString()} left out: already in another campaign.`}{" "}
              <button type="button" className="link-btn" onClick={() => setWithUsed(!withUsed)}>{withUsed ? "Leave them out" : "Include them anyway"}</button></p>
          ) : null}
          {chosen.bad.length || withBad ? (
            <p className="camp-note dlv-bad">{withBad ? "Doubtful emails are included." : `${chosen.bad.length} left out: their email looks wrong (jobs or HR inbox, placeholder, typo, no-reply…).`}{" "}
              {chosen.bad.length ? <button type="button" className="link-btn" onClick={() => setShowBad(!showBad)}>{showBad ? "Hide" : "Show them"}</button> : null}{" "}
              <button type="button" className="link-btn" onClick={() => setWithBad(!withBad)}>{withBad ? "Leave them out" : "Include them anyway"}</button></p>
          ) : null}
          {chosen.broken.length ? (
            <p className="camp-note dlv-bad">{chosen.broken.length} {chosen.broken.length === 1 ? "lead's emails need" : "leads' emails need"} a fix before they can be sent (Start would skip them).{" "}
              <button type="button" className="link-btn" onClick={() => setShowBroken(!showBroken)}>{showBroken ? "Hide" : "Show them"}</button></p>) : null}
          {showBroken && chosen.broken.length ? (
            <div className="table-card members camp-leads"><table className="leads"><thead><tr><th>Lead</th><th>Email</th><th>What to fix</th></tr></thead>
              <tbody>{chosen.broken.slice(0, 300).map(({ d, reason }) => <tr key={d.id}><td>{d.name || "—"}</td><td>{d.email}</td><td>{reason[0].toUpperCase() + reason.slice(1)}</td></tr>)}</tbody></table></div>
          ) : null}
          {showBad && chosen.bad.length ? (
            <div className="table-card members camp-leads"><table className="leads"><thead><tr><th>Lead</th><th>Email</th><th>Why</th></tr></thead>
              <tbody>{chosen.bad.slice(0, 300).map(({ d, reason }) => <tr key={d.id}><td>{d.name || "—"}</td><td>{d.email}</td><td>{reason}</td></tr>)}</tbody></table></div>
          ) : null}
          {draft && ordered.length ? (
            <div className="camp-plan">
              <p className="camp-note"><b>Send order</b> <Tip text="Click ☆ on a lead to send it first. Marked leads go first, in the order you mark them; the rest follow. Each day sends the next batch, as many as your accounts allow that day (slow start: 5, 7, 9… a day per new account). Kestrel also sends at most 2 first emails a day to one company domain, so a day can move a little." />
                {marked ? <> · {marked} marked to go first · <button type="button" className="link-btn" onClick={() => setMarks([])}>Clear marks</button></> : " · Click ☆ to choose who goes first."}</p>
              <div className="camp-days" aria-label="First emails by day">{plan.slice(0, 14).map((p, k) => (
                <span key={k}><b>Day {k + 1}</b> {p.date.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })} · {p.count}</span>))}
                {plan.length > 14 ? <span>+{plan.length - 14} more days</span> : null}</div>
            </div>) : null}
          <div className="table-card members camp-leads">
            <table className="leads">
              <thead><tr>{draft ? <th className="camp-ord">First</th> : null}<th>Lead</th><th>Email</th>{draft ? <th>Day</th> : null}<th>Steps</th></tr></thead>
              <tbody>{ordered.slice(0, 500).map((d, i) => { const pos = first.indexOf(d.id), k = dayOfLead(i, plan); return (
                <tr key={d.id}>{draft ? <td className="camp-ord"><button type="button" className={`first-mark${pos >= 0 ? " on" : ""}`} aria-pressed={pos >= 0} disabled={!changeable}
                  aria-label={pos >= 0 ? `Marked ${pos + 1} to send first. Click to unmark ${d.name || d.email}` : `Send ${d.name || d.email} first`}
                  onClick={() => setMarks(pos >= 0 ? first.filter((x) => x !== d.id) : [...first.filter((x) => byId.has(x)), d.id])}>{pos >= 0 ? `★ ${ordered.findIndex((x) => x.id === d.id) + 1}` : "☆"}</button></td> : null}
                  <td><div className="biz"><BizAvatar name={d.name || d.email} website={byId.get(d.id)?.website || siteOfEmail(d.email)} /><div className="biz-txt"><b>{d.name || "—"}</b></div></div></td><td>{d.email}</td>
                  {draft ? <td className="camp-day">{plan[k] ? `Day ${k + 1} · ${plan[k].date.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}` : "—"}</td> : null}
                  <td>{stepsOf(d.outreach).length}</td></tr>); })}</tbody>
            </table>
            {!chosen.ready.length ? <div className="empty"><div><b>No leads ready</b><span className="dr-muted"> Leads need an email and a written email.</span></div></div> : null}
          </div>
          {chosen.ready.length > 500 ? <p className="camp-note">Showing 500 of {chosen.ready.length.toLocaleString()}; all {chosen.ready.length.toLocaleString()} are used.</p> : null}
        </section>
      ) : (
        <>
          {skipped.length ? (
            <section className="join-card camp-skipped">
              <b>{skipped.length} {skipped.length === 1 ? "lead was" : "leads were"} skipped at Start <Tip text="These leads were chosen but not added. Fix the reason (for example write the email again), then add them with Duplicate or a new campaign." /></b>
              <div className="table-card members"><table className="leads"><thead><tr><th>Lead</th><th>Email</th><th>Why</th></tr></thead>
                <tbody>{skipped.map((s) => <tr key={s.lead_id}><td>{s.name || "—"}</td><td>{s.email || "—"}</td><td>{s.reason}</td></tr>)}</tbody></table></div>
            </section>
          ) : null}
          <div className="acct-bar"><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search leads" aria-label="Search this campaign's leads" /></div>
          <div className="table-card members camp-leads">
            <table className="leads">
              <thead><tr><th>Lead</th><th>Status</th><th>Lead status</th><th>Next email</th><th>First sent</th></tr></thead>
              <tbody>{shownRows.slice(0, 1000).map((r) => (
                <tr key={r.id}><td><div className="biz"><BizAvatar name={r.lead_name || r.to_email} website={byId.get(r.lead_id ?? "")?.website || siteOfEmail(r.to_email)} /><div className="biz-txt"><b>{r.lead_name || r.to_email}</b>{r.lead_name ? <small>{r.to_email}</small> : null}</div></div></td><td>{LEAD_STATUS[r.status] ?? r.status}</td><td>{stageName(r.stage) || "—"}</td>
                  <td>{r.status === "active" && r.next_at ? `${stepName(r.next_step, steps[r.next_step])} · ${when(r.next_at)}` : "—"}</td><td>{when(r.first_sent_at)}</td></tr>
              ))}</tbody>
            </table>
            {rows && !shownRows.length ? <div className="empty"><div><b>No leads</b></div></div> : null}
          </div>
          {shownRows.length > 1000 ? <p className="camp-note">Showing 1,000 of {shownRows.length.toLocaleString()}. Search to find one.</p> : null}
        </>
      )) : null}

      {tab === "sequences" ? (
        <section className="join-card prof-form camp-form">
          <div className="rules-h"><b>Sequence <Tip text={HELP.steps} /></b><button type="button" className="link-btn" onClick={() => go("sequences")}>Edit sequence templates</button></div>
          <label className="in"><span>Use emails written for <Tip text={HELP.written} /></span>
            <select value={form.sequence_id ?? ""} disabled={!editable || !draft} onChange={(e) => { const s = sequences.find((x) => x.id === e.target.value); setForm({ ...form, sequence_id: e.target.value || null, weekdays_only: s?.weekdays_only ?? form.weekdays_only }); }}>
              <option value="">Any sequence</option>
              {sequences.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select></label>
          {steps.length ? <ol className="camp-seq">{steps.map((s, i) => (
            <li key={i}><div className="camp-seq-h"><b>Step {i + 1} · {stepName(i, s)}</b><small>{i === 0 ? "Day 0" : `Day ${s.day}, if no reply`}</small></div>
              {s.subject ? <p className="camp-seq-sub">Subject: {s.subject}</p> : i > 0 && !(s as { kind?: string }).kind ? <p className="camp-seq-sub">Same thread (Re:)</p> : null}
              <pre className="dr-draft">{s.body}</pre></li>
          ))}</ol> : <p className="camp-note">{draft ? "No lead has written emails for this sequence yet." : "Loading…"}</p>}
          {example ? <p className="camp-note">Example: {example.name || example.email}</p> : null}
          {draft && dirty ? <div className="join-row"><button type="button" className="btn go" disabled={!changeable} onClick={() => save()}>Save</button></div> : null}
        </section>
      ) : null}

      {tab === "schedule" ? (
        <section className="join-card prof-form camp-form">
          <b>Schedule <Tip text={HELP.hours} /></b>
          <div className="row2">
            <label className="in"><span>{form.lead_time_zone ? "Time zone when a lead's is unknown" : "Time zone"}</span><select value={form.time_zone} disabled={!changeable} onChange={(e) => setForm({ ...form, time_zone: e.target.value })}>
              {[...new Set([form.time_zone, ...TIME_ZONES])].map((z) => <option key={z} value={z}>{z.replace("_", " ")}</option>)}</select></label>
            <div className="in"><span>Sending hours{form.lead_time_zone ? " (in each lead's own time)" : ""}</span>
              <div className="camp-hours">
                <select aria-label="From" value={form.window_start} disabled={!changeable} onChange={(e) => setForm({ ...form, window_start: Number(e.target.value) })}>{Array.from({ length: 23 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}</select>
                <span>to</span>
                <select aria-label="To" value={form.window_end} disabled={!changeable} onChange={(e) => setForm({ ...form, window_end: Number(e.target.value) })}>{Array.from({ length: 24 }, (_, h) => h + 1).filter((h) => h > form.window_start).map((h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}</select>
              </div>
            </div>
          </div>
          <label className="agree"><input type="checkbox" checked={form.weekdays_only} disabled={!changeable} onChange={(e) => setForm({ ...form, weekdays_only: e.target.checked })} /> <span>Weekdays only</span></label>
          {typeof c.lead_time_zone === "boolean" ? (
            <label className="agree"><input type="checkbox" checked={Boolean(form.lead_time_zone)} disabled={!changeable} onChange={(e) => setForm({ ...form, lead_time_zone: e.target.checked })} />
              <span>Send in each lead&apos;s own time zone <Tip text="Kestrel guesses each lead's time zone from its location or address (US states, Canadian provinces, Australian states, then the country) and sends inside these hours there. When it cannot tell, it uses the time zone on the left." /></span></label>
          ) : null}
          <p className="camp-note">Today up to <b>{todayPerDay}</b> first emails from {picked.length} account(s), rising by 2 a day per account to <b>{fullPerDay}</b> a day; one email every 3 to 7 minutes per account.
            {followDays.length ? ` Follow-ups on day ${followDays.join(", ").replace(/, (\d+)$/, " and $1")} for people who did not reply.` : seq ? " No follow-ups in this sequence." : ""}</p>
          {changeable ? <div className="join-row"><button type="button" className="btn go" disabled={!dirty} onClick={() => save()}>Save</button></div> : <p className="camp-note">Pause the campaign to change its schedule.</p>}
        </section>
      ) : null}

      {tab === "options" ? (
        <section className="join-card prof-form camp-form">
          <label className="in"><span>Campaign name</span><input value={form.name} maxLength={80} disabled={!changeable} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <div className="in"><span>Email accounts to use <Tip text="Kestrel rotates between the chosen accounts. Each needs both tests passed (sending and reading replies) so follow-ups stop on a reply. Changing them needs a new test." /></span>
            <div className="camp-boxes">{boxes.map((b) => (
              <label key={b.id} className={`agree${!usable(b) ? " off" : ""}`}><input type="checkbox" disabled={!acctEditable || !usable(b)} checked={form.mailbox_ids.includes(b.id)}
                onChange={(e) => setForm({ ...form, mailbox_ids: e.target.checked ? [...form.mailbox_ids, b.id] : form.mailbox_ids.filter((x) => x !== b.id) })} />
                <span>{b.email}{b.from_name ? ` (${b.from_name})` : ""} <small className="muted-line">{usable(b) ? `${today[b.id]?.limit_today ?? b.daily_limit} today, up to ${b.daily_limit} a day${b.daily_limit > SAFE_DAILY ? " (above the safe 25)" : ""}` : "not ready: test it in Email accounts"}</small></span></label>
            ))}</div>
            {new Set(picked.map((b) => (b.from_name ?? "").trim()).filter(Boolean)).size > 1 ? <p className="camp-note dlv-bad">These accounts use different sender names. Leads may see two names for one company: make them the same in Email accounts.</p> : null}
            {!boxes.length ? <p className="camp-note"><button type="button" className="link-btn" onClick={() => go("mailboxes")}>Add an email account</button></p> : null}
          </div>
          <label className="agree"><input type="checkbox" checked={form.verify_emails} disabled={!changeable} onChange={(e) => setForm({ ...form, verify_emails: e.target.checked })} />
            <span>Verify each email before sending <Tip text="Checks every address just before the first email (your own verifier, or Hunter with your team's key and credits). Invalid and throw-away addresses are skipped and added to Do-not-contact, which keeps bounces under 1%." /></span></label>
          <label className={`agree${tracking ? "" : " off"}`}><input type="checkbox" disabled={!changeable || !tracking} checked={form.track_opens && tracking} onChange={(e) => setForm({ ...form, track_opens: e.target.checked })} />
            <span>Track opens (an estimate) {tracking ? null : <button type="button" className="link-btn" onClick={() => go("mailboxes")}>Set up a tracking domain first</button>} <Tip text="Adds an HTML copy with a tiny image loaded from your own tracking domain, so Replies shows when an email is opened. Plain text without tracking reaches the inbox best." /></span></label>
          {typeof c.stop_company === "boolean" ? (
            <label className="agree"><input type="checkbox" checked={Boolean(form.stop_company)} disabled={!changeable} onChange={(e) => setForm({ ...form, stop_company: e.target.checked })} />
              <span>Stop the whole company when one person replies <Tip text="When anyone at a company (same email domain) replies or asks to be removed, Kestrel stops emailing the other people there. Never for free email providers such as gmail.com or outlook.com." /></span></label>
          ) : null}
          {changeable ? <div className="join-row"><button type="button" className="btn go" disabled={!dirty} onClick={() => save()}>Save</button></div>
            : acctEditable ? <div className="join-row"><button type="button" className="btn go" disabled={!boxesChanged || !form.mailbox_ids.length} onClick={() => save()}>Save accounts</button>
              <span className="camp-note">While sending, only the accounts can change. Leads not emailed yet move to the new accounts; emailed leads keep theirs for their follow-ups.</span></div> : null}
          {["draft", "stopped", "done"].includes(c.status) ? <div className="join-row"><button type="button" className="link-btn danger" disabled={!editable} onClick={remove}>Delete campaign</button></div> : null}
        </section>
      ) : null}
    </div>
  );
}
