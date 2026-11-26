"use client";

import { askConfirm } from "@/components/dialog";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Tip } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { LeadRow } from "@/lib/leads";
import { EMPTY_OFFER, EMPTY_SENDER, PROVIDERS, VERDICT_COLUMN, emailJob, emailMissing, estimate, fitJob, makeDraft, offerReady, profileHash, readResults,
  type LeadData, type Offer, type Provider, type Sender } from "@/lib/ai";
import { AUTO } from "@/lib/ai-models";
import AiKit from "./ai-kit";
import { DEFAULT_STEPS, cleanSteps, followUpCount, stepsForFollowUps, type Step } from "@/lib/sequence";import { logAiActivity } from "@/lib/ai-activity";


// AI in the App, like the extension's AI drawer: your offer, which AI to use, judging leads and writing first emails.
// With the team's AI key the App's server does the work; with Claude Code or Codex you download a job file and upload the results.
// Kestrel never sends emails: drafts wait on each lead for you to copy or export.
type Settings = Sender & { provider: Provider; model: string; offer_id: string | null };
type Mark = { id: string; ai: string | null; drafted: string | null; fu?: string | null };
type Seq = { id: string; name: string; offer_id: string | null; steps: Step[] };
type TeamKey = { service: string; last4: string };

const DEFAULTS: Settings = { ...EMPTY_SENDER, provider: "anthropic", model: AUTO, offer_id: null };
const BATCH = 8;
const HELP = {
  offer: "Tell the AI what you sell and who buys it. It uses this to judge every lead and to write emails. Save several offers and switch between them; the whole team shares them.",
  oneLine: "One plain sentence on what you do. It goes in the middle of every email, the same for everyone.",
  strict: "Lenient keeps more leads as Maybe. Strict marks Good only with clear proof.",
  ai: "Choose the AI company your team has a key for. The key is kept encrypted and is used only by Kestrel's server to ask that company. It is never shown in the browser. Emails and phone numbers are never sent to the AI.",
  sender: "Who the emails come from. Every draft ends with your name, postal address and an easy way to say no, as the email law asks.",
  judge: "Judges every lead not judged yet for this offer as Good, Maybe or No, with a short reason. Your AI company charges a few cents per hundred leads.",
  write: "Writes a subject, a personal first line and one question for each Good lead that has an email and no draft yet, and with a sequence also one personal text for each follow-up, all in one go. Kestrel adds your one line, sender name, postal address and an opt-out to every step. Leads on Do-not-contact are skipped. Nothing is sent.",
  sequence: "Which emails the AI writes. Kestrel's default is the first email plus follow-ups on day 5, 10 and 15 (only if no reply). Make your own in Mail → Sequences. \"First email only\" works like the extension.",
  redo: "Leads that already have a first email but no follow-ups get all steps written again (the first email is rewritten too).",
  agent: "No API key needed. Download a job file, then in Claude Code open the “Kestrel AI Kit” folder and type /score-leads (or /write-emails). In Codex, say: score the newest Kestrel job. Then upload the results file here.",
};

const stamp = () => new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const saveFile = (name: string, data: unknown) => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
// Time stamps for saved results (called only in click handlers; a helper keeps the React Compiler purity lint quiet).
const now = () => Date.now();
const usd = (n: number | null) => (n === null ? "unknown" : n < 0.01 ? "under 1 cent" : `about $${n.toFixed(2)}`);

export default function AiView({ account, leads, demo, editable, onLeads, toast, go, blocked }: {
  account: { team_id: string; role: string } | null; leads: LeadRow[]; demo: boolean; editable: boolean; blocked: (l: LeadRow) => boolean;
  onLeads: (patches: Record<string, Partial<LeadRow>>) => void; toast: (t: string) => void; go: (view: string) => void;
}) {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [offer, setOffer] = useState<Offer>(EMPTY_OFFER);
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [keys, setKeys] = useState<TeamKey[]>([]);
  const [marks, setMarks] = useState<Record<string, Mark>>({});
  const [msg, setMsg] = useState("");
  const [seqs, setSeqs] = useState<Seq[]>([]);
  const [seqChoice, setSeqChoice] = useState<string>("");
  const [redo, setRedo] = useState(false);
  const [run, setRun] = useState<{ task: "score" | "emails"; done: number; total: number; skipped: number; cost: number | null } | null>(null);
  const stop = useRef(false);
  const ready = Boolean(account && !demo);
  const sb = supabaseBrowser;

  const initialAddressRef = useRef<string>("");
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!ready) return;
    const [o, s, k, q] = await Promise.all([
      sb().from("offer_profiles").select("*").order("name"),
      sb().from("team_ai").select("*").maybeSingle(),
      sb().rpc("list_team_keys"),
      sb().from("sequences").select("id,name,offer_id,steps").order("name"), // database 015; before it this fails and only the default exists
    ]);
    setSeqs(q.error ? [] : ((q.data ?? []) as Seq[]).map((x) => ({ ...x, steps: cleanSteps(x.steps) })));
    if (o.error || s.error) {
      const err = o.error?.message || s.error?.message || "Could not load AI settings.";
      setLoadError(err);
      setMsg("Could not load AI settings. Saving is disabled to protect your data.");
      return;
    }
    const list = (o.data ?? []) as Offer[], set = { ...DEFAULTS, ...((s.data as Partial<Settings> | null) ?? {}) };
    initialAddressRef.current = set.address ?? "";
    setOffers(list); setSettings(set); setKeys((k.data as TeamKey[] | null) ?? []);
    setOffer(list.find((x) => x.id === set.offer_id) ?? list[0] ?? EMPTY_OFFER);
  }, [ready, sb]);
  // Which leads are judged for which offer, and which have a draft (kept inside each lead's data).
  const loadMarks = useCallback(async () => {
    if (!ready) return;
    const out: Record<string, Mark> = {};
    for (let from = 0; ; from += 1000) {
      const { data } = await sb().from("leads").select("id,ai:data->ai->>profile,drafted:data->outreach->>at,fu:data->outreach->followUps->>0").range(from, from + 999);
      (data as Mark[] | null ?? []).forEach((m) => { out[m.id] = m; });
      if (!data || data.length < 1000) break;
    }
    setMarks(out);
  }, [ready, sb]);
  useEffect(() => { Promise.resolve().then(() => { load(); loadMarks(); }); }, [load, loadMarks]);

  const hash = profileHash(offer);
  const live = useMemo(() => leads.filter((l) => l.status !== "removed"), [leads]);
  const toJudge = useMemo(() => live.filter((l) => demo ? !l.verdict : marks[l.id]?.ai !== hash), [live, marks, hash, demo]);
  // The sequence the AI writes for: chosen here, else the first one for this offer, else Kestrel's default.
  const seqFor = seqs.filter((x) => !x.offer_id || x.offer_id === offer.id);
  const choice = seqChoice && (seqChoice === "default" || seqChoice === "none" || seqFor.some((x) => x.id === seqChoice)) ? seqChoice
    : (seqFor.find((x) => x.offer_id === offer.id) ?? seqFor[0])?.id ?? "default";
  const steps: Step[] | null = choice === "none" ? null : choice === "default" ? DEFAULT_STEPS : seqFor.find((x) => x.id === choice)?.steps ?? DEFAULT_STEPS;
  const followUps = steps ? followUpCount(steps) : 0;
  const toWrite = live.filter((l) => l.verdict === "Good" && l.email && !blocked(l)
    && !(demo ? false : marks[l.id]?.drafted && !(redo && followUps > 0 && !marks[l.id]?.fu)));
  const key = keys.find((k) => k.service === settings.provider);
  const models = PROVIDERS[settings.provider].models;
  const missing = emailMissing(offer, settings);

  const field = (label: string, name: keyof Offer, hint: string, rows = 2) => (
    <label className="in"><span>{label}</span>
      <textarea rows={rows} value={String(offer[name] ?? "")} placeholder={hint} disabled={!editable} onChange={(e) => setOffer({ ...offer, [name]: e.target.value })} />
    </label>
  );
  const senderField = (label: string, name: keyof Sender, hint: string, rows = 1) => (
    <label className="in"><span>{label}</span>
      {rows > 1 ? <textarea rows={rows} value={settings[name] ?? ""} placeholder={hint} disabled={!editable} onChange={(e) => setSettings({ ...settings, [name]: e.target.value })} />
        : <input value={settings[name] ?? ""} placeholder={hint} disabled={!editable} onChange={(e) => setSettings({ ...settings, [name]: e.target.value })} />}
    </label>
  );

  async function saveSettings(patch: Partial<Settings>) {
    if (loadError) { setMsg("Could not load AI settings. Saving is disabled to protect your data."); return false; }
    setSettings((cur) => ({ ...cur, ...patch }));
    if (!ready || !account) return true;
    const row: Record<string, unknown> = {
      team_id: account.team_id,
      updated_at: new Date().toISOString(),
    };
    if (patch.provider !== undefined) row.provider = patch.provider;
    if (patch.model !== undefined) row.model = patch.model.trim() || AUTO;
    if (patch.offer_id !== undefined) row.offer_id = patch.offer_id;
    if (patch.sender_name !== undefined) row.sender_name = patch.sender_name;
    if (patch.business !== undefined) row.business = patch.business;
    if (patch.address !== undefined) row.address = patch.address;
    if (patch.signature !== undefined) row.signature = patch.signature;
    if (patch.booking_link !== undefined) {
      const link = String(patch.booking_link ?? "").trim();
      if (link && !/^https:\/\/[^\s<>"]+$/.test(link)) { setMsg("The booking link must start with https:// (for example https://cal.com/you/15min)."); return false; }
      row.booking_link = link;
    }
    let { error } = await sb().from("team_ai").upsert(row);
    if (error && /booking_link/.test(error.message)) {   // before database 037
      const withoutBooking = { ...row };
      delete withoutBooking.booking_link;
      ({ error } = await sb().from("team_ai").upsert(withoutBooking));
      if (!error && patch.booking_link) { setMsg("Saved. The booking link is coming soon to your workspace."); return true; }
    }
    if (error) { setMsg(error.message); return false; }
    return true;
  }
  async function saveOffer(asNew: boolean) {
    if (!account) return;
    const name = offer.name.trim().slice(0, 40);
    if (!name) { setMsg("Give this offer a name first."); return; }
    if (asNew && offers.some((x) => x.name === name)) { setMsg("Change the offer name first: an offer with that name already exists."); return; }
    setMsg("");
    const row = { team_id: account.team_id, name, offer: offer.offer, customer: offer.customer, good: offer.good, bad: offer.bad, criteria: offer.criteria,
      strictness: offer.strictness, one_line: offer.one_line, updated_at: new Date().toISOString() };
    if (demo) { const o = { ...offer, ...row, id: offer.id && !asNew ? offer.id : `demo-${name}` }; setOffers([...offers.filter((x) => x.id !== o.id), o]); setOffer(o); toast(`Saved "${name}".`); return; }
    const q = offer.id && !asNew ? sb().from("offer_profiles").update(row).eq("id", offer.id).select().single() : sb().from("offer_profiles").insert(row).select().single();
    const { data, error } = await q;
    if (error) { setMsg(/duplicate|unique/i.test(error.message) ? "An offer with that name already exists." : error.message); return; }
    const saved = data as Offer;
    setOffers([...offers.filter((x) => x.id !== saved.id), saved].sort((a, b) => a.name.localeCompare(b.name)));
    setOffer(saved);
    await saveSettings({ offer_id: saved.id ?? null });
    toast(`Saved "${name}".`);
  }
  async function deleteOffer() {
    if (!offer.id || !await askConfirm(`Delete the offer "${offer.name}" for the whole team? Leads keep their verdicts.`)) return;
    if (!demo) { const { error } = await sb().from("offer_profiles").delete().eq("id", offer.id); if (error) { setMsg(error.message); return; } }
    const rest = offers.filter((x) => x.id !== offer.id);
    setOffers(rest); setOffer(rest[0] ?? EMPTY_OFFER);
  }
  async function chooseOffer(id: string) {
    const o = offers.find((x) => x.id === id) ?? EMPTY_OFFER;
    setOffer(o);
    if (o.id) await saveSettings({ offer_id: o.id });
  }

  // Runs on the App's server with the team key, a few leads per call, until done or stopped.
  async function start(task: "score" | "emails") {
    const list = task === "score" ? toJudge : toWrite;
    if (!offer.id) { setMsg("Save this offer first."); return; }
    if (demo) { setMsg("This is the preview with made-up leads. AI runs on the live App."); return; }
    // Redo rewrites first emails people may have edited by hand: ask first (UX audit row 33).
    const rewrites = task === "emails" && redo ? list.filter((l) => marks[l.id]?.drafted).length : 0;
    if (rewrites && !(await askConfirm(`${rewrites} ${rewrites === 1 ? "lead already has" : "leads already have"} a first email.\nWriting the follow-ups rewrites their first email too, including any changes you made by hand. Continue?`, { ok: "Rewrite them" }))) return;
    if (settings.booking_link && !/^https:\/\/[^\s<>"]+$/.test(settings.booking_link.trim())) { setMsg("The booking link must start with https:// (for example https://cal.com/you/15min)."); return; }
    stop.current = false; setMsg("");
    // Bulk runs (5+ leads) queue into ai_jobs (AI-4b) so the browser never hits Vercel's 60s limit.
    if (list.length >= 5) {
      const qRes = await fetch("/api/ai/enqueue", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          task,
          ids: list.slice(0, 1000).map((l) => l.id),
          offerId: offer.id,
          ...(task === "emails" && choice !== "none" ? { sequence: choice } : {}),
        }),
      }).catch(() => null);
      const qOut = qRes ? await qRes.json().catch(() => null) : null;
      if (qRes?.ok && typeof qOut?.queued === "number" && qOut.queued > 0) {
        const label = task === "score" ? "scoring" : "email writing";
        setMsg(`Queued ${qOut.queued} leads for background ${label}. Watch live progress in Lead Brain.`);
        toast(`Queued ${qOut.queued} leads in background.`);
        return;
      }
      if (!qRes) {
        setMsg("Network problem. Check your connection.");
        return;
      }
      if (!qOut?.fallback) {
        setMsg(qOut?.error || "Could not queue leads.");
        return;
      }
    }
    let done = 0, skipped = 0, cost: number | null = 0;
    setRun({ task, done, total: list.length, skipped, cost });
    // Writing now includes the QC bot's check and one fix (Phase 4C), so 4 leads per call keep each call well inside 60 s.
    const per = task === "emails" ? 4 : BATCH;
    for (let i = 0; i < list.length && !stop.current; i += per) {
      const ids = list.slice(i, i + per).map((l) => l.id);
      const res = await fetch("/api/ai", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ task, ids, offerId: offer.id, ...(task === "emails" && choice !== "none" ? { sequence: choice } : {}) }) }).catch(() => null);
      const out = res ? await res.json().catch(() => ({ error: "The App's server did not answer." })) : { error: "Network problem. Check your connection." };
      if (out.done) {
        const patches: Record<string, Partial<LeadRow>> = {}, next = { ...marks };
        for (const d of out.done as { id: string; verdict?: LeadRow["verdict"]; reason?: string; draft?: unknown }[]) {
          if (task === "score") { patches[d.id] = { verdict: d.verdict ?? null, reason: d.reason ?? null }; next[d.id] = { ...(next[d.id] ?? { id: d.id, drafted: null }), ai: hash }; }
          else next[d.id] = { ...(next[d.id] ?? { id: d.id, ai: null }), drafted: String(now()), fu: followUps ? "1" : null };
        }
        if (task === "score") onLeads(patches);
        setMarks(next);
        done += out.done.length;
      }
      skipped += (out.skipped ?? []).length;
      cost = cost === null || out.cost === null || out.cost === undefined ? null : cost + out.cost;
      setRun({ task, done, total: list.length, skipped, cost });
      if (out.error) { setMsg(out.error); break; }
    }
    setRun((r) => (r ? { ...r, total: r.done + r.skipped } : r));
    void logAiActivity(account?.team_id, { kind: task === "score" ? "score_leads" : "write_emails", ok: done > 0 || !skipped,
      summary: task === "score" ? `Score and write: judged ${done} lead${done === 1 ? "" : "s"} for the offer “${offer.name}”` : `Score and write: wrote emails for ${done} lead${done === 1 ? "" : "s"} (offer “${offer.name}”)`,
      detail: skipped ? `${skipped} skipped` : null });
    toast(task === "score" ? `Judged ${done} leads.` : followUps ? `Wrote emails and ${followUps} follow-ups for ${done} leads.` : `Wrote ${done} email drafts.`);
  }

  // Claude Code / Codex: the same job files as the extension.
  async function leadData(ids: string[]) {
    const out: { id: string; data: LeadData }[] = [];
    for (let i = 0; i < ids.length; i += 200) {
      const { data } = await sb().from("leads").select("id,data").in("id", ids.slice(i, i + 200));
      out.push(...((data ?? []) as { id: string; data: LeadData }[]));
    }
    return out;
  }
  // A job file for Claude Code / Codex (the AI kit, ai-kit.tsx): written into the kit folder, or saved to Downloads.
  async function buildJob(task: "score" | "emails") {
    const list = task === "score" ? toJudge : toWrite;
    const rows = demo ? list.map((l) => ({ id: l.id, data: { name: l.name ?? "", category: l.category ?? "", location: l.location ?? "", website: l.website ?? "" } })) : await leadData(list.map((l) => l.id));
    return task === "score" ? { name: `fit_job_${stamp()}.json`, data: fitJob(offer, rows), count: rows.length }
      : { name: `email_job_${stamp()}.json`, data: emailJob(offer, settings, rows, steps ?? undefined), count: rows.length };
  }
  async function uploadResults(file: File) {
    setMsg("");
    try {
      const r = readResults(JSON.parse(await file.text()));
      // Emails need the sender name and postal address in the footer, same as Write and Download.
      if (r.kind === "email" && missing.length) { setMsg(`Add ${missing.join(", ")} first, then upload the file again.`); return; }
      const byId = new Map(leads.map((l) => [l.id, l]));
      // Do-not-contact leads never get drafts, even from a file.
      const results = r.results.filter((x) => byId.has(x.id) && (r.kind === "fit" || !blocked(byId.get(x.id)!)));
      const skippedDnc = r.kind === "email" ? r.results.filter((x) => byId.has(x.id) && blocked(byId.get(x.id)!)).length : 0;
      if (!results.length) { setMsg(skippedDnc ? "Every lead in that file is on your Do-not-contact list, so nothing was saved." : "None of the leads in that file are in your team's leads."); return; }
      if (demo) { setMsg(`That file has ${results.length} answers. Upload it on the live App to save them.`); return; }
      const datas = new Map((await leadData(results.map((x) => x.id))).map((x) => [x.id, x.data ?? {}]));
      const patches: Record<string, Partial<LeadRow>> = {}, next = { ...marks };
      let saved = 0;
      for (const x of results) {
        const data = datas.get(x.id) ?? {};
        if (r.kind === "fit") {
          const f = x as { id: string; fit: number; verdict: "good" | "maybe" | "no"; reason: string };
          const ai = { fit: f.fit, verdict: f.verdict, reason: f.reason, profile: r.profile || hash, by: "agent", at: now() };
          const { error } = await sb().from("leads").update({ verdict: VERDICT_COLUMN[f.verdict], reason: f.reason, data: { ...data, ai } }).eq("id", x.id);
          if (!error) { saved++; patches[x.id] = { verdict: VERDICT_COLUMN[f.verdict], reason: f.reason }; next[x.id] = { ...(next[x.id] ?? { id: x.id, drafted: null }), ai: ai.profile }; }
        } else {
          // Follow-ups in the file go into the chosen sequence (or Kestrel's default when "first email only" is chosen).
          const e = x as unknown as Parameters<typeof makeDraft>[0] & { follow_ups: string[] };
          // Only as many follow-ups as the file has, so no step is saved with an empty [FOLLOW_UP] (older files have none).
          const fu = e.follow_ups ?? [], useSteps = stepsForFollowUps(steps ?? DEFAULT_STEPS, fu.length);
          const seq = { steps: useSteps, ...(choice !== "default" && choice !== "none" ? { id: choice } : {}) };
          const outreach = makeDraft(e, offer, settings, "agent", seq, fu.slice(0, followUpCount(useSteps)), x.id);
          const { error } = await sb().from("leads").update({ data: { ...data, outreach } }).eq("id", x.id);
          if (!error) { saved++; next[x.id] = { ...(next[x.id] ?? { id: x.id, ai: null }), drafted: String(outreach.at), fu: outreach.followUps?.[0] ?? null }; }
        }
      }
      onLeads(patches); setMarks(next);
      toast(r.kind === "fit" ? `Saved ${saved} verdicts.` : `Saved ${saved} email drafts${skippedDnc ? ` (${skippedDnc} on Do-not-contact skipped)` : ""}.`);
    } catch (e) { setMsg((e as Error).message); }
  }

  const busy = Boolean(run && run.done + run.skipped < run.total);
  const canRun = editable && offerReady(offer) && Boolean(offer.id) && !busy;

  return (
    <div className="app-page">
      <header className="head"><div><h1>AI <Tip text="AI reads each lead's public details and does two jobs: it judges if the lead fits your offer, and it writes the personal parts of your first email. Use your team's AI key, or Claude Code or Codex on your own plan." /></h1>
        <span className="sub">{offer.id ? `Offer: ${offer.name}` : "Set up your offer to start"} · {toJudge.length.toLocaleString()} to judge · {toWrite.length.toLocaleString()} emails to write</span></div></header>

      <div className="import-grid">
        <section className="join-card prof-form">
          <b>Your offer <Tip text={HELP.offer} /></b>
          <div className="join-row">
            <select aria-label="Offer profile" value={offer.id ?? ""} onChange={(e) => chooseOffer(e.target.value)}>
              {offer.id ? null : <option value="">Unsaved offer</option>}
              {offers.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            <button type="button" className="btn small glass" disabled={!editable} onClick={() => setOffer({ ...EMPTY_OFFER })}>New</button>
            {offer.id ? <button type="button" className="link-btn" disabled={!editable} onClick={deleteOffer}>Delete</button> : null}
          </div>
          <label className="in"><span>Offer name</span><input value={offer.name} maxLength={40} disabled={!editable} placeholder="e.g. Video editing for agencies" onChange={(e) => setOffer({ ...offer, name: e.target.value })} /></label>
          {field("What you sell", "offer", "e.g. Short-form video editing for agencies")}
          {field("Ideal customer", "customer", "e.g. Marketing agencies with 5 to 50 people")}
          {field("Good signs", "good", "e.g. Posts video weekly, hiring an editor")}
          {field("Disqualifiers", "bad", "e.g. Has an in-house video team, not a business")}
          {field("Other criteria", "criteria", "Anything else the AI should weigh")}
          <div className="in"><span>How strict <Tip text={HELP.strict} /></span>
            <div className="seg">{(["lenient", "balanced", "strict"] as const).map((v) => (
              <button key={v} type="button" className={offer.strictness === v ? "on" : ""} disabled={!editable} onClick={() => setOffer({ ...offer, strictness: v })}>{v[0].toUpperCase() + v.slice(1)}</button>
            ))}</div>
          </div>
          <label className="in"><span>One line on what you do <Tip text={HELP.oneLine} /></span>
            <textarea rows={2} value={offer.one_line} disabled={!editable} placeholder="e.g. We're a small studio that turns long videos into weekly short clips." onChange={(e) => setOffer({ ...offer, one_line: e.target.value })} />
          </label>
          <div className="join-row">
            <button type="button" className="btn go" disabled={!editable || !offerReady(offer)} onClick={() => saveOffer(false)}>{offer.id ? "Save offer" : "Save as offer"}</button>
            {offer.id ? <button type="button" className="btn glass" disabled={!editable} onClick={() => saveOffer(true)}>Save as new…</button> : null}
          </div>
        </section>

        <div className="ai-col">
          <section className="join-card prof-form">
            <b>AI company <Tip text={HELP.ai} /></b>
            <div className="row2">
              <label className="in"><span>Company</span>
                <select value={settings.provider} disabled={!editable || Boolean(loadError)} onChange={(e) => {
                  const p = e.target.value as Provider;
                  const m = p === "anthropic" ? AUTO : PROVIDERS[p].models[0]?.id ?? "";
                  setSettings({ ...settings, provider: p, model: m });
                  void saveSettings({ provider: p, model: m });
                }}>
                  {(Object.keys(PROVIDERS) as Provider[]).map((p) => <option key={p} value={p}>{PROVIDERS[p].label} ({PROVIDERS[p].maker})</option>)}
                </select>
              </label>
              <label className="in"><span>Model</span>
                {models.length ? (
                  <select value={settings.model} disabled={!editable || Boolean(loadError)} onChange={(e) => {
                    const m = e.target.value;
                    setSettings({ ...settings, model: m });
                    void saveSettings({ model: m });
                  }}>
                    {models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </select>
                ) : <input value={settings.model} disabled={!editable || Boolean(loadError)} placeholder={settings.provider === "gemini" ? "gemini model name" : "model name, for example gpt-…"}
                      onChange={(e) => setSettings({ ...settings, model: e.target.value })}
                      onBlur={(e) => { void saveSettings({ model: e.target.value }); }} />}
              </label>
            </div>
            <p className="ai-key">{key ? <>Team key for {PROVIDERS[settings.provider].label} ends in <b>{key.last4}</b>.</> : <>Using Kestrel AI included with your plan. Optional: <button type="button" className="link-btn" onClick={() => go("connections")}>use your own key in Integrations → Services</button>.</>}</p>
          </section>

          <section className="join-card prof-form">
            <b>Emails come from <Tip text={HELP.sender} /></b>
            <div className="row2">
              {senderField("Sender name", "sender_name", "e.g. Alex from Northlight Studio")}
              {senderField("Business", "business", "e.g. Northlight Studio")}
            </div>
            {senderField("Postal address (email footer)", "address", "e.g. 12 High Street, Leeds LS1 4AB, United Kingdom", 2)}
            {senderField("Signature (optional)", "signature", "e.g. Best,\nAlex", 2)}
            <label className="in"><span>Booking link (optional) <Tip text="Your Calendly, Cal.com or Google booking page. Use {{BOOKING_LINK}} in a sequence step, or insert it into an answer in Replies, so interested leads can pick a time themselves." /></span>
              <input value={settings.booking_link ?? ""} placeholder="https://cal.com/you/15min" disabled={!editable || Boolean(loadError)} inputMode="url" onChange={(e) => setSettings({ ...settings, booking_link: e.target.value })} /></label>
            <div className="join-row"><button type="button" className="btn glass" disabled={!editable || Boolean(loadError)} onClick={async () => {
              if (initialAddressRef.current.trim() && !settings.address.trim()) {
                const ok = await askConfirm("Remove your postal address? Email laws require a valid postal address in the footer.", { danger: true, ok: "Remove postal address" });
                if (!ok) return;
              }
              if (await saveSettings({
                sender_name: settings.sender_name,
                business: settings.business,
                address: settings.address,
                signature: settings.signature,
                booking_link: settings.booking_link,
              })) {
                initialAddressRef.current = settings.address.trim();
                toast("Saved.");
              }
            }}>Save</button></div>
          </section>
        </div>
      </div>

      <div className="import-grid">
        <section className="join-card">
          <div><b>Judge leads <Tip text={HELP.judge} /></b>
            <p>{toJudge.length ? `${toJudge.length.toLocaleString()} leads are not judged for this offer yet. Cost ${usd(estimate(toJudge.length, settings.provider, settings.model, "score"))}.` : "Every lead is judged for this offer."}</p></div>
          <div className="join-row">
            <button type="button" className="btn go" disabled={!canRun || !toJudge.length} onClick={() => start("score")}>Judge {toJudge.length.toLocaleString()} {toJudge.length === 1 ? "lead" : "leads"}</button>
          </div>
          {toJudge.length && !canRun ? <p className="camp-note">{!offer.id ? "Save your offer first (above)." : busy ? "Working…" : !editable ? "Viewers cannot run AI." : ""}</p> : null}
        </section>
        <section className="join-card">
          <div><b>Write emails <Tip text={HELP.write} /></b>
            <p>{missing.length ? `Add ${missing.join(", ")} first.` : toWrite.length ? `${toWrite.length.toLocaleString()} Good leads with an email are waiting. ${followUps ? `The AI writes the first email and ${followUps} follow-ups for each, in one go. ` : ""}Cost ${usd(estimate(toWrite.length * (1 + followUps * 0.4), settings.provider, settings.model, "emails"))}.` : "No Good leads with an email are waiting for a draft."}</p></div>
          <div className="row2">
            <label className="in"><span>Sequence <Tip text={HELP.sequence} /></span>
              <select value={choice} onChange={(e) => setSeqChoice(e.target.value)}>
                {seqFor.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.steps.length - 1} follow-ups)</option>)}
                <option value="default">Kestrel default (3 follow-ups)</option>
                <option value="none">First email only</option>
              </select></label>
            {followUps ? <label className="seq-check"><input type="checkbox" checked={redo} onChange={(e) => setRedo(e.target.checked)} /> Also redo drafts without follow-ups <Tip text={HELP.redo} /></label> : <span />}
          </div>
          <div className="join-row">
            <button type="button" className="btn go" disabled={!canRun || !toWrite.length || missing.length > 0} onClick={() => start("emails")}>Write {toWrite.length.toLocaleString()} {followUps ? (toWrite.length === 1 ? "sequence" : "sequences") : (toWrite.length === 1 ? "email" : "emails")}</button>
            <button type="button" className="link-btn" onClick={() => go("sequences")}>Edit sequences</button>
          </div>
        </section>
      </div>

      {run ? (
        <section className="join-card ai-run" role="status">
          <div className="ai-run-top">
            <b>{run.task === "score" ? "Judging leads" : "Writing emails"}: {run.done.toLocaleString()} of {run.total.toLocaleString()}</b>
            {busy ? <button type="button" className="btn small glass" onClick={() => { stop.current = true; }}>Stop</button> : <button type="button" className="link-btn" onClick={() => setRun(null)}>Close</button>}
          </div>
          <div className="ai-bar"><span style={{ width: `${run.total ? Math.round(((run.done + run.skipped) / run.total) * 100) : 100}%` }} /></div>
          <p>{run.skipped ? `${run.skipped} skipped (no email or no clear answer). ` : ""}Cost so far: {usd(run.cost)}.{run.task === "emails" ? " Open a lead to read and copy its draft." : ""}</p>
        </section>
      ) : null}

      <AiKit team={account?.team_id ?? "demo"} editable={editable} demo={demo} canScore={toJudge.length} canWrite={toWrite.length}
        scoreBlocked={offerReady(offer) ? "" : "Add what you sell and your ideal customer first."}
        writeBlocked={!offerReady(offer) ? "Add what you sell and your ideal customer first." : missing.length ? `Add ${missing.join(", ")} first.` : ""}
        buildJob={buildJob} download={(j) => saveFile(j.name, j.data)} importFile={uploadResults} toast={toast} />

      {msg ? <p className="plan-msg" role="alert">{msg}</p> : null}
      {!editable && account ? <p className="plan-msg">Viewers can read AI verdicts and drafts but not run AI.</p> : null}
    </div>
  );
}
