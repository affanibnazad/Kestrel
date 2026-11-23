"use client";

import { askConfirm } from "@/components/dialog";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Tip } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { LeadRow } from "@/lib/leads";
import { EMPTY_OFFER, EMPTY_SENDER, type Draft, type Offer, type Sender } from "@/lib/ai";
import { scoreEmail } from "@/lib/spamguard";
import { IssueList, ScoreBadge, SCORE_HELP } from "./spam-check";
import { STEP_KINDS, isTaskStep, type StepKind } from "@/lib/sequence";
import { DEFAULT_STEPS, EMPTY_SEQUENCE, MAX_STEPS, MAX_VARIANTS, VARIANT_LETTERS, variantCount, MERGE_FIELDS, checkSequence, cleanSteps, footer, renderAll, type Sequence, type SequenceParts, type Step } from "@/lib/sequence";
import { TEMPLATES, TEMPLATE_CATEGORIES, type Template } from "@/lib/templates";

// Kestrel Mail, phase 2: sequences. The first email and up to 3 follow-ups (day 5, 10, 15 by default, only if no reply),
// a spam-word check like Manyreach's "Check Spam", and a preview for any lead with the merge fields filled.
// Nothing is sent here: sending is phase 3.
type Acct = { team_id: string; role: string } | null;
// The starting text of a new task step (the person can change it).
const TASK_TEXT: Record<Exclude<StepKind, "email">, string> = {
  linkedin: "Visit {{FIRST_NAME}}'s LinkedIn, follow the company and send a connection request with a short, personal note.",
  call: "Call {{FIRST_NAME}}. Mention the email you sent and ask your question.",
  task: "Describe what to do for this lead.",
};
const HELP = {
  kind: "Email is sent by Kestrel. A LinkedIn, call or other task is never sent: on its day it appears on Mail → Tasks for your team to do by hand, and the sequence goes on to the next step. Tasks stop when the lead replies. Kestrel never logs in to LinkedIn for you (that breaks LinkedIn's rules).",
  page: "A sequence is the first email and the follow-ups for one offer. The AI writes the personal parts for each lead in one go (AI → Write emails). Follow-ups go only to people who did not reply. Nothing is sent yet.",
  fields: "Merge fields are filled in for each lead. FIRST_NAME, SUBJECT, ICEBREAKER, QUESTION and FOLLOW_UP come from the AI; ONE_LINE comes from your offer.",
  footer: "Every step ends with your sender name (or signature), postal address and an easy way to say no, as the email law asks. Change them in AI → Emails come from.",
  spam: "Red words must change: prices, payment, trials or phishing-like words. Orange words often trip spam filters or sound like AI. Best practice: click Check Spam and replace flagged words before every campaign.",
  day: "Days after the first email. Best practice: 5, 10 and 15.",
  subject: "Leave empty to stay in the same thread (Re: the first subject). Usually best.",
  ab: "Test up to 3 subject lines. Kestrel gives each lead one of them (an even split) and the campaign's Analytics shows which gets more replies. Follow-ups keep the same thread. Write the emails again after adding a subject so leads get their variant.",
};
const DEMO_PARTS: SequenceParts = { first_name: "", subject: "", icebreaker: "", question: "", follow_ups: [] };

export default function SequencesView({ account, leads, demo, editable, toast, blocked, go }: {
  account: Acct; leads: LeadRow[]; demo: boolean; editable: boolean; toast: (t: string) => void; blocked: (l: LeadRow) => boolean; go: (view: string) => void;
}) {
  const [list, setList] = useState<Sequence[]>([]);
  const [seq, setSeq] = useState<Sequence>({ ...EMPTY_SEQUENCE, name: "Main sequence" });
  const [offers, setOffers] = useState<Offer[]>([]);
  const [sender, setSender] = useState<Sender>(EMPTY_SENDER);
  const [missing, setMissing] = useState(false);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [leadId, setLeadId] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editing, setEditing] = useState(false); // false = the list of sequences; true = one sequence open
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"list" | "templates">("list");
  const [tplCat, setTplCat] = useState<string>("All");
  const ready = Boolean(account && !demo);
  const sb = supabaseBrowser;

  const activeTeamRef = useRef(account?.team_id);
  const reqGenRef = useRef(0);
  useEffect(() => {
    if (account?.team_id !== activeTeamRef.current) {
      activeTeamRef.current = account?.team_id;
      reqGenRef.current += 1;
    }
  }, [account?.team_id]);

  const load = useCallback(async () => {
    if (demo) {
      setOffers([{ ...EMPTY_OFFER, id: "demo-offer", name: "Video editing for agencies", one_line: "We're a small post-production studio that agencies use when video work piles up." }]);
      setSender({ sender_name: "Alex Example", business: "Example Studio", address: "1 Example Street, London, UK", signature: "" });
      setList((l) => l.length ? l : [{ id: "demo-main", name: "Agencies, UK", offer_id: "demo-offer", steps: DEFAULT_STEPS, stop_on_reply: true, weekdays_only: true }]);
      return;
    }
    if (!ready) return;
    const currentGen = reqGenRef.current;
    const currentTeam = account?.team_id;
    const isCurrent = () => reqGenRef.current === currentGen && activeTeamRef.current === currentTeam;

    const [s, o, t] = await Promise.all([
      sb().from("sequences").select("id,name,offer_id,steps,stop_on_reply,weekdays_only").order("name"),
      sb().from("offer_profiles").select("*").order("name"),
      sb().from("team_ai").select("sender_name,business,address,signature,booking_link").maybeSingle()
        .then((r) => (r.error ? sb().from("team_ai").select("sender_name,business,address,signature").maybeSingle() : r)),   // before database 037
    ]);
    if (!isCurrent()) return;
    if (s.error) { setMissing(true); return; }
    const rows = ((s.data ?? []) as Sequence[]).map((x) => ({ ...x, steps: cleanSteps(x.steps) }));
    setList(rows); setOffers((o.data ?? []) as Offer[]); setSender({ ...EMPTY_SENDER, ...((t.data as Partial<Sender> | null) ?? {}) });
    if (rows[0]) setSeq(rows[0]);
  }, [demo, ready, sb, account?.team_id]);
  useEffect(() => { Promise.resolve().then(load); }, [load]);
  useEffect(() => {
    if (seq.id && list.length > 0 && !list.some((s) => s.id === seq.id)) {
      Promise.resolve().then(() => setSeq(list[0] ?? { ...EMPTY_SEQUENCE, name: "Main sequence" }));
    }
  }, [list, seq.id]);

  // Leads you can preview: not removed, not on Do-not-contact. Good leads with a draft first.
  const choices = useMemo(() => leads.filter((l) => l.status !== "removed" && !blocked(l))
    .sort((a, b) => Number(b.verdict === "Good") - Number(a.verdict === "Good")).slice(0, 300), [leads, blocked]);
  const lead = choices.find((l) => l.id === leadId) ?? choices[0] ?? null;
  useEffect(() => {
    let live = true;
    if (!lead) { Promise.resolve().then(() => { if (live) setDraft(null); }); return () => { live = false; }; }
    if (demo) {
      const name = String(lead.name || "there").replace(/\s+(ltd|limited|llc|inc)\.?$/i, "");
      const d = { firstName: name, subject: `video edits at ${name.toLowerCase()}`, icebreaker: `Saw ${name} films client stories for ${lead.category?.toLowerCase() || "local brands"} in ${lead.location || "your city"}.`,
        question: "Who edits those videos when the team gets busy?", body: "", by: "demo", at: 0, flags: [],
        followUps: [`Quick one: is all the editing at ${name} done in-house right now?`, "If client edits stack up this month, we can take the cutting off your team. Worth a short talk?",
          "I'll stop here so I'm not filling your inbox. If editing help is ever useful, just reply."] } as Draft;
      Promise.resolve().then(() => { if (live) setDraft(d); });
      return () => { live = false; };
    }
    sb().from("leads").select("data").eq("id", lead.id).single()
      .then(({ data }) => { if (live) setDraft(((data as { data?: { outreach?: Draft } } | null)?.data?.outreach) ?? null); });
    return () => { live = false; };
  }, [lead, demo, sb]);

  const offer = offers.find((o) => o.id === seq.offer_id) ?? offers[0] ?? EMPTY_OFFER;
  const check = useMemo(() => checkSequence(seq.steps), [seq.steps]);
  const parts: SequenceParts = draft ? { first_name: draft.firstName, subject: draft.subject, icebreaker: draft.icebreaker, question: draft.question, follow_ups: draft.followUps ?? [] } : DEMO_PARTS;
  const [pv, setPv] = useState(0);   // which A/B/C variant the preview shows
  const nVariants = variantCount(seq.steps);
  const preview = renderAll(seq.steps, parts, offer.one_line, sender, Math.min(pv, nVariants - 1));
  const reds = check.steps.reduce((n, s) => n + s.hits.filter((h) => h.level === "block").length, 0) + check.problems.length;
  const oranges = check.steps.reduce((n, s) => n + s.hits.filter((h) => h.level === "warn").length, 0);
  const noSender = !sender.sender_name.trim() || !sender.address.trim();

  const change = (next: Partial<Sequence>) => { setSeq({ ...seq, ...next }); setDirty(true); };
  const setStep = (i: number, patch: Partial<Step>) => change({ steps: seq.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const addStep = () => { const last = seq.steps[seq.steps.length - 1]; change({ steps: [...seq.steps, { day: Math.min(90, (last?.day ?? 0) + 5), subject: "", body: "Hi {{FIRST_NAME}},\n\n{{FOLLOW_UP}}" }] }); };
  const insert = (i: number, field: string) => setStep(i, { body: `${seq.steps[i].body.replace(/\s+$/, "")}${seq.steps[i].body.trim() ? " " : ""}{{${field}}}` });

  async function pick(id: string) {
    if (dirty && !await askConfirm("Leave without saving your changes?")) return;
    setSeq(id === "" ? { ...EMPTY_SEQUENCE, name: "", offer_id: offers[0]?.id ?? null, steps: DEFAULT_STEPS } : list.find((x) => x.id === id) ?? seq);
    setDirty(false); setMsg(""); setEditing(true);
  }
  async function applyTemplate(t: Template) {
    if (dirty && !await askConfirm("Leave without saving your changes?")) return;
    setSeq({
      ...EMPTY_SEQUENCE,
      name: `${t.name} (copy)`,
      offer_id: offers[0]?.id ?? null,
      steps: cleanSteps(t.steps),
      stop_on_reply: true,
      weekdays_only: true,
    });
    setDirty(true);
    setMsg("");
    setEditing(true);
    toast(`Loaded "${t.name}" template.`);
  }
  async function back() {
    if (dirty && !await askConfirm("Leave without saving your changes?")) return;
    setDirty(false); setMsg(""); setEditing(false);
  }
  async function save() {
    const name = seq.name.trim().slice(0, 60);
    if (!name) { setMsg("Give this sequence a name first."); return; }
    if (check.blocked) { setMsg("Fix the red items first (prices, payment words, unknown merge fields or missing steps)."); return; }
    if (!seq.id && list.some((x) => x.name === name)) { setMsg("A sequence with that name already exists."); return; }
    setMsg("");
    // Keep each step's type: a task step saved without it would become an email and its instruction would be sent to the lead.
    const row = { team_id: account?.team_id, name, offer_id: seq.offer_id, steps: seq.steps.map((s, i) => {
      const task = i > 0 && isTaskStep(s);
      const v = task ? [] : (s.variants ?? []).map((x) => x.trim()).filter(Boolean).slice(0, MAX_VARIANTS - 1);
      return { day: s.day, subject: s.subject.trim(), body: s.body.trim(), ...(v.length ? { variants: v } : {}), ...(task ? { kind: s.kind } : {}) }; }),
      stop_on_reply: true, weekdays_only: seq.weekdays_only };
    if (demo) { const s = { ...seq, ...row, id: seq.id ?? `demo-${name}` } as Sequence; setList([...list.filter((x) => x.id !== s.id), s]); setSeq(s); setDirty(false); toast(`Saved "${name}".`); return; }
    if (!account) return;
    setBusy(true);
    const q = seq.id ? sb().from("sequences").update(row).eq("id", seq.id).select().single() : sb().from("sequences").insert(row).select().single();
    const { data, error } = await q;
    setBusy(false);
    if (error) { setMsg(/duplicate|unique/i.test(error.message) ? "A sequence with that name already exists." : /schema cache|sequences/i.test(error.message) ? "Sequences are coming soon to your workspace." : error.message); return; }
    const saved = { ...(data as Sequence), steps: cleanSteps((data as Sequence).steps) };
    setList([...list.filter((x) => x.id !== saved.id), saved].sort((a, b) => a.name.localeCompare(b.name)));
    setSeq(saved); setDirty(false);
    toast(`Saved "${name}".`);
  }
  async function remove() {
    if (!seq.id || !await askConfirm(`Delete the sequence "${seq.name}" for the whole team? Drafts already written stay on the leads.`)) return;
    if (!demo) { const { error } = await sb().from("sequences").delete().eq("id", seq.id); if (error) { setMsg(error.message); return; } }
    const rest = list.filter((x) => x.id !== seq.id);
    setList(rest); setSeq(rest[0] ?? { ...EMPTY_SEQUENCE, name: "Main sequence" }); setDirty(false); setEditing(false);
    toast(`Deleted "${seq.name}".`);
  }

  const can = editable && !missing;
  const offerName = (id: string | null) => offers.find((o) => o.id === id)?.name ?? "Any offer";

  // The list, like Campaigns and Email accounts: one row per sequence, click to open it.
  if (!editing) {
    const shown = list.filter((x) => !q || x.name.toLowerCase().includes(q.trim().toLowerCase()));
    const tplShown = TEMPLATES.filter((t) => {
      const matchCat = tplCat === "All" || t.category === tplCat;
      const matchQ = !q || t.name.toLowerCase().includes(q.toLowerCase()) || t.tagline.toLowerCase().includes(q.toLowerCase()) || t.bestFor.toLowerCase().includes(q.toLowerCase());
      return matchCat && matchQ;
    });

    return (
      <div className="app-page">
        <header className="head">
          <div>
            <h1>Sequences <Tip text={HELP.page} /></h1>
            <span className="sub">
              {tab === "list" ? `${list.length} saved · each is a first email and its follow-ups` : `${TEMPLATES.length} curated cold outreach templates · ready to clone and run`}
            </span>
          </div>
          <div className="head-actions">{can ? <button type="button" className="btn go small" onClick={() => pick("")}>Add new</button> : null}</div>
        </header>
        {missing ? <p className="plan-msg">Sequences are coming soon to your workspace. You can still use Kestrel&apos;s default sequence in AI → Write emails.</p> : null}
        
        <div className="acct-bar" style={{ display: "flex", gap: "12px", alignItems: "center", marginBottom: "16px" }}>
          <div className="seg" role="tablist" aria-label="Sequence tabs">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "list"}
              className={tab === "list" ? "on" : ""}
              onClick={() => setTab("list")}
            >
              My sequences ({list.length})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "templates"}
              className={tab === "templates" ? "on" : ""}
              onClick={() => setTab("templates")}
            >
              Templates ({TEMPLATES.length})
            </button>
          </div>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={tab === "list" ? "Search sequences" : "Search templates"}
            aria-label={tab === "list" ? "Search sequences" : "Search templates"}
            style={{ maxWidth: 320 }}
          />
        </div>

        {tab === "list" ? (
          <div className="table-card members acct-table">
            <table className="leads">
              <thead><tr><th>Name</th><th>Offer</th><th>Steps</th><th>Spam check <Tip text={HELP.spam} /></th><th>Sending days</th></tr></thead>
              <tbody>{shown.map((x) => {
                const c = checkSequence(x.steps), red = c.steps.reduce((n, st) => n + st.hits.filter((h) => h.level === "block").length, 0) + c.problems.length;
                const orange = c.steps.reduce((n, st) => n + st.hits.filter((h) => h.level === "warn").length, 0);
                return (
                  <tr key={x.id} className="acct-row" onClick={() => pick(x.id!)}>
                    <td><button type="button" className="acct-open" onClick={(e) => { e.stopPropagation(); pick(x.id!); }}><b>{x.name}</b></button></td>
                    <td>{offerName(x.offer_id)}</td>
                    <td>{x.steps.length === 1 ? "First email only" : `First email + ${x.steps.length - 1} follow-ups`}<small className="muted-line">{x.steps.length > 1 ? `Day ${x.steps.slice(1).map((st) => st.day).join(", ")}` : ""}{variantCount(x.steps) > 1 ? ` · A/B test (${variantCount(x.steps)} subjects)` : ""}</small></td>
                    <td><em className={`pill ${red ? "no" : orange ? "maybe" : "good"}`}>{red ? `${red} to fix` : orange ? `${orange} to look at` : "Clean"}</em></td>
                    <td>{x.weekdays_only ? "Weekdays" : "Every day"}</td>
                  </tr>
                );
              })}</tbody>
            </table>
            {!list.length ? (
              <div className="empty seq-default"><div><b>Kestrel default</b><span className="dr-muted"> First email + 3 follow-ups (day 5, 10 and 15). Used by Kestrel AI → Score and write until you save your own.</span>
                {editable ? <button type="button" className="btn go small" onClick={async () => { await pick(""); setSeq({ ...EMPTY_SEQUENCE, name: "Kestrel default (copy)", offer_id: offers[0]?.id ?? null, steps: DEFAULT_STEPS }); }}>Edit a copy</button> : null}</div></div>
            ) : !shown.length ? <div className="empty"><div><b>No sequences match</b></div></div> : null}
          </div>
        ) : (
          <div>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", margin: "0 0 16px" }}>
              {TEMPLATE_CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  className={`btn small ${tplCat === cat ? "go" : "glass"}`}
                  style={{ borderRadius: 9999 }}
                  onClick={() => setTplCat(cat)}
                >
                  {cat}
                </button>
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "16px", marginBottom: "24px" }}>
              {tplShown.map((t) => (
                <article
                  key={t.id}
                  style={{
                    background: "var(--k-surface, #fff)",
                    border: "1px solid var(--k-border, #E5E3DC)",
                    borderRadius: 16,
                    padding: "20px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "12px",
                    boxShadow: "none",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span className="pill neutral" style={{ borderRadius: 9999 }}>{t.category}</span>
                    <span className="pill good" style={{ borderRadius: 9999 }}>Spam clean</span>
                  </div>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{t.name}</h3>
                  <p style={{ margin: 0, fontSize: "13.5px", color: "var(--k-muted, #8A8A8A)", lineHeight: 1.45 }}>{t.tagline}</p>
                  <div style={{ display: "grid", gap: "6px", fontSize: "13px", background: "var(--k-sidebar, #F3F2EE)", padding: "12px", borderRadius: 10, marginTop: "auto" }}>
                    <div><b>Best for:</b> <span>{t.bestFor}</span></div>
                    <div><b>Steps:</b> <span>{t.steps.length} touchpoints (Day {t.steps.map((s) => s.day).join(", ")})</span></div>
                    {t.steps[0].variants?.length ? (
                      <div><b>A/B testing:</b> <span>{t.steps[0].variants.length + 1} subject variants included</span></div>
                    ) : null}
                  </div>
                  <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "4px" }}>
                    <button
                      type="button"
                      className="btn go small"
                      style={{ borderRadius: 9999 }}
                      onClick={() => applyTemplate(t)}
                    >
                      Use this template
                    </button>
                  </div>
                </article>
              ))}
            </div>
            {!tplShown.length ? <div className="empty"><div><b>No templates match &ldquo;{q}&rdquo;</b></div></div> : null}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="app-page">
      <header className="head">
        <div>
          <button type="button" className="link-btn seq-back" onClick={back}>← All sequences</button>
          <h1>{seq.name.trim() || "New sequence"} <Tip text={HELP.page} /></h1>
          <span className="sub">First email + {seq.steps.length - 1} follow-ups · {offerName(seq.offer_id)} · nothing is sent from here</span>
        </div>
        <div className="head-actions">
          <span className={`pill ${reds ? "no" : oranges ? "maybe" : "good"}`} role="status">Spam check: {reds ? `${reds} to fix` : oranges ? `${oranges} to look at` : "clean"}</span>
          {seq.id && can ? <button type="button" className="link-btn" onClick={remove}>Delete</button> : null}
          <button type="button" className="btn go small" disabled={!can || busy || check.blocked} onClick={save}>{busy ? "Saving…" : dirty || !seq.id ? "Save" : "Saved"}</button>
        </div>
      </header>
      {missing ? <p className="plan-msg">Sequences are coming soon to your workspace. You can still try Kestrel&apos;s default sequence in AI → Write emails.</p> : null}
      {!editable && account ? <p className="plan-msg">Viewers can read sequences but not change them.</p> : null}

      <section className="join-card seq-top">
        <div className="seq-bar">
          <label className="in"><span>Name</span><input value={seq.name} maxLength={60} disabled={!can} placeholder="Agencies, UK" onChange={(e) => change({ name: e.target.value })} /></label>
          <label className="in"><span>For the offer</span>
            <select value={seq.offer_id ?? ""} disabled={!can} onChange={(e) => change({ offer_id: e.target.value || null })}>
              <option value="">Any offer</option>
              {offers.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select></label>
        </div>
        <div className="seq-bar seq-opts">
          <span className="seq-note">Follow-ups stop as soon as someone replies.</span>
          <label className="seq-check"><input type="checkbox" checked={seq.weekdays_only} disabled={!can} onChange={(e) => change({ weekdays_only: e.target.checked })} /> Weekends off</label>
        </div>
        {check.problems.length ? <ul className="seq-problems">{check.problems.map((p) => <li key={p}>{p}</li>)}</ul> : null}
      </section>

      <div className="seq-grid">
        <div className="seq-steps">
          {seq.steps.map((s, i) => {
            const task = isTaskStep(s);
            const sc = scoreEmail({ subject: [s.subject, ...(s.variants ?? [])].join(" · "), body: s.body, step: i, template: true });
            return (
              <section key={i} className={`join-card seq-step${task ? " seq-task" : ""}`}>
                <div className="rules-h">
                  <b>{i === 0 ? "First email" : task ? `Step ${i + 1}: ${STEP_KINDS.find((k) => k[0] === s.kind)?.[1]}` : `Follow-up ${i}`}</b>
                  {i === 0 ? <span className="seq-day">Day 0</span> : (
                    <span className="seq-day">
                      <label>Day <input type="number" min={1} max={90} value={s.day} disabled={!can} aria-label={`Follow-up ${i}: days after the first email`} onChange={(e) => setStep(i, { day: Number(e.target.value) })} /></label>
                      <Tip text={HELP.day} />
                      {i === seq.steps.length - 1 && can ? <button type="button" className="link-btn" onClick={() => change({ steps: seq.steps.slice(0, i) })}>Remove</button> : null}
                    </span>
                  )}
                </div>
                {i > 0 ? (
                  <label className="in seq-kind"><span>Step type <Tip text={HELP.kind} /></span>
                    <select aria-label="Step type" value={s.kind ?? "email"} disabled={!can} onChange={(e) => {
                      const k = e.target.value as StepKind;
                      setStep(i, k === "email" ? { kind: undefined, body: s.kind ? "Hi {{FIRST_NAME}},\n\n{{FOLLOW_UP}}" : s.body }
                        : { kind: k, subject: "", variants: undefined, body: task ? s.body : TASK_TEXT[k] });
                    }}>
                      {STEP_KINDS.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                    </select></label>
                ) : null}
                {task ? (
                  <label className="in"><span>What to do</span>
                    <textarea rows={3} value={s.body} disabled={!can} maxLength={4000} onChange={(e) => setStep(i, { body: e.target.value })} /></label>
                ) : <>
                <label className="in"><span>{s.variants?.length ? "Subject A" : "Subject"} {i > 0 ? <Tip text={HELP.subject} /> : null}</span>
                  <input aria-label={s.variants?.length ? "Subject A" : "Subject"} value={s.subject} disabled={!can} maxLength={200} placeholder={i === 0 ? "{{SUBJECT}}" : "Same thread (Re: first subject)"} onChange={(e) => setStep(i, { subject: e.target.value })} /></label>
                {(s.variants ?? []).map((v, k) => (
                  <label key={k} className="in seq-variant"><span>Subject {VARIANT_LETTERS[k + 1]}
                    {can ? <button type="button" className="link-btn" onClick={() => setStep(i, { variants: (s.variants ?? []).filter((_, j) => j !== k) })}>Remove</button> : null}</span>
                    <input value={v} disabled={!can} maxLength={200} placeholder={`Another subject to test, e.g. quick question, {{FIRST_NAME}}`}
                      onChange={(e) => setStep(i, { variants: (s.variants ?? []).map((x, j) => (j === k ? e.target.value : x)) })} /></label>
                ))}
                {can && (s.variants?.length ?? 0) < MAX_VARIANTS - 1 && (i === 0 || s.subject.trim()) ? (
                  <span className="seq-add-variant-wrap" style={{ display: "inline-flex", alignItems: "center", gap: 6, justifySelf: "start" }}>
                    <button type="button" className="link-btn seq-add-variant" onClick={() => setStep(i, { variants: [...(s.variants ?? []), ""] })}>
                      Add subject {VARIANT_LETTERS[(s.variants?.length ?? 0) + 1]} (A/B test)
                    </button>
                    <Tip text={HELP.ab} />
                  </span>
                ) : null}
                <label className="in"><span>Email</span>
                  <textarea rows={i === 0 ? 7 : 4} value={s.body} disabled={!can} maxLength={4000} onChange={(e) => setStep(i, { body: e.target.value })} /></label>
                </>}
                <div className="seq-fields" aria-label="Insert a merge field">
                  {Object.keys(MERGE_FIELDS).filter((f) => (i === 0 ? f !== "FOLLOW_UP" : true)).map((f) => (
                    <button key={f} type="button" className="seq-chip" title={MERGE_FIELDS[f]} aria-label={`Insert {{${f}}}: ${MERGE_FIELDS[f]}`} disabled={!can} onClick={() => insert(i, f)}>{`{{${f}}}`}</button>
                  ))}
                  <Tip text={HELP.fields} />
                </div>
                {task ? null : <div className="sg-step">
                  <div className="sg-head"><ScoreBadge score={sc} /><div><b>Spam score</b><small>{sc.blocked ? "Fix the red items" : sc.grade === "A" ? "Ready" : "Can be better"} <Tip text={SCORE_HELP} /></small></div>
                    <button type="button" className="link-btn" onClick={() => window.dispatchEvent(new CustomEvent("kestrel-spam-check", { detail: { subject: s.subject, body: s.body, mode: "template" } }))}>Open in Spam check</button></div>
                  <IssueList score={sc} />
                </div>}
              </section>
            );
          })}
          {seq.steps.length < MAX_STEPS && can ? <button type="button" className="btn glass seq-add" onClick={addStep}>Add a follow-up</button> : null}
          <section className="join-card seq-step">
            <div className="rules-h"><b>Added to every step <Tip text={HELP.footer} /></b>{noSender ? <button type="button" className="link-btn" onClick={() => go("ai")}>Add sender and address</button> : null}</div>
            <pre className="seq-foot">{footer(sender) || "Your sender name, postal address and opt-out line go here."}</pre>
            {noSender ? <p className="rules-warn">Add a sender name and postal address in AI → Emails come from. Every step needs them.</p> : null}
          </section>
        </div>

        <aside className="join-card seq-preview" aria-label="Preview">
          <div className="rules-h"><b>Preview <Tip text="The emails this lead would get, with the merge fields filled. Grey [FIELD] means the AI has not written that part for this lead yet: run AI → Write emails with this sequence." /></b></div>
          <label className="in"><span>Lead</span>
            <select value={lead?.id ?? ""} onChange={(e) => setLeadId(e.target.value)}>
              {choices.map((l) => <option key={l.id} value={l.id}>{l.name || "No name"}{l.verdict ? ` · ${l.verdict}` : ""}</option>)}
            </select></label>
          {!lead ? <p className="dr-muted">No leads to preview yet.</p> : !draft ? <p className="dr-muted">No draft for this lead yet. Write emails in AI with this sequence, then preview here.</p> : null}
          {nVariants > 1 ? (
            <div className="seg" role="radiogroup" aria-label="Variant to preview">
              {VARIANT_LETTERS.slice(0, nVariants).map((l, k) => <button key={l} type="button" role="radio" aria-checked={Math.min(pv, nVariants - 1) === k} className={Math.min(pv, nVariants - 1) === k ? "on" : ""} onClick={() => setPv(k)}>Variant {l}</button>)}
            </div>
          ) : null}
          {lead ? preview.map((r) => (
            <article key={r.step} className="seq-mail">
              <header><b>{r.step === 0 ? "First email" : `Follow-up ${r.step}`}</b><span>{r.step === 0 ? "Day 0" : `Day ${r.day}, if no reply${seq.weekdays_only ? ", weekdays" : ""}`}</span></header>
              <div className="seq-subj"><span>Subject</span> {r.subject || "—"}</div>
              <pre>{r.body}</pre>
              {r.missing.length ? <p className="seq-miss">Not written yet: {r.missing.join(", ")}</p> : null}
            </article>
          )) : null}
        </aside>
      </div>
      {msg ? <p className="plan-msg" role="alert">{msg}</p> : null}
    </div>
  );
}
