"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { askConfirm } from "@/components/dialog";
import { Tip } from "@/components/ui";
import type { LeadRow } from "@/lib/leads";
import { applyRules, cleanRules, dataQuality, isOldPointsRule, DEFAULT_REFINE, NO_VALUE, RULE_ACTIONS, RULE_FIELDS, RULE_OPS, ruleMatches,
  type Refine, type Rule, type ScoreLead, type TeamRules } from "@/lib/scoring";

// Rules for the whole team (Leads → Rules), like the extension's Rules drawer and its Refine filters. Points scoring
// (weights, tiers) was removed on 18 Nov 2026: a rule now rejects a lead or marks it Good or No.
// Saved in team_rules (database 012). Connected extensions take them the next time they open.
// Rules per plan, as in the extension's core/plans.js: Starter 3, Pro 25 (the trial is Pro), Agency no limit.
const RULE_LIMIT: Record<string, number> = { starter: 3, pro: 25, agency: 0 };
type RulesTab = "rules" | "filters";
type Acct = { team_id: string; role: string; plan: string; active?: boolean; access_plan?: string | null; access_until?: string | null } | null;

const FILTER_NUMS: [keyof Refine, string, number, number][] = [
  ["minRating", "Lowest rating", 5, 0.1], ["minReviews", "Fewest reviews", 100000, 1], ["maxReviews", "Most reviews", 1000000, 1],
  ["minQuality", "Lowest data quality", 100, 1], ["minSocials", "Fewest social profiles", 20, 1], ["minChannels", "Fewest ways to reach them", 3, 1],
];
const FILTER_CHECKS: [keyof Refine, string][] = [
  ["needWebsite", "Has a website"], ["needEmail", "Has an email"], ["businessEmailOnly", "Business email only"], ["emailMatchesSite", "Email matches the website"],
  ["needPhone", "Has a phone"], ["needSocial", "Has a social profile"], ["needDescription", "Has a description"], ["needAddress", "Has an address"],
];

// A lead as the extension keeps it. Demo rows have no data, so build one from the columns.
const asLead = (row: LeadRow, data?: ScoreLead): ScoreLead => data && Object.keys(data).length ? data
  : { name: row.name ?? "", category: row.category ?? "", source: row.source ?? "", email: row.email ?? "", phone: row.phone ?? "", website: row.website ?? "", emailKind: row.email ? "role" : "none",
      ai: row.verdict ? { verdict: row.verdict.toLowerCase() } : null };

export default function RulesView({ account, leads, demo, toast, onLeads }: {
  account: Acct; leads: LeadRow[]; demo: boolean; toast: (t: string) => void; onLeads: (p: Record<string, Partial<LeadRow>>) => void;
}) {
  const [saved, setSaved] = useState<TeamRules | null>(null);
  const [draft, setDraft] = useState<TeamRules>(() => cleanRules(null));
  const [data, setData] = useState<Record<string, ScoreLead>>({});
  const [busy, setBusy] = useState("");
  const [missing, setMissing] = useState(false);
  const [tab, setTab] = useState<RulesTab>("rules");
  const canEdit = Boolean(account && account.role !== "viewer" && account.active !== false);
  const planId = account?.plan && account.plan !== "trial" ? account.plan : account?.access_until && new Date(account.access_until) > new Date() ? account.access_plan ?? "pro" : "pro";
  const limit = RULE_LIMIT[planId] ?? 25;

  // The team's saved rules, and every lead's full record (for match counts and Rescore).
  useEffect(() => {
    if (!account || demo) { Promise.resolve().then(() => setSaved(cleanRules(null))); return; }
    let live = true;
    const sb = supabaseBrowser();
    sb.from("team_rules").select("weights,tiers,rules,refine").eq("team_id", account.team_id).maybeSingle().then(({ data: r, error }) => {
      if (!live) return;
      if (error) setMissing(true);
      const c = cleanRules(r); setSaved(c); setDraft(c);
    });
    (async () => {
      const all: Record<string, ScoreLead> = {};
      for (let from = 0; from < 20000; from += 1000) {
        const { data: rows } = await sb.from("leads").select("id,data").eq("team_id", account.team_id).range(from, from + 999);
        for (const r of (rows as { id: string; data: ScoreLead | null }[] | null) ?? []) all[r.id] = r.data ?? {};
        if (!rows || rows.length < 1000) break;
      }
      if (live) setData(all);
    })();
    return () => { live = false; };
  }, [account, demo]);

  const pool = useMemo(() => leads.filter((l) => l.status !== "removed").map((l) => ({ row: l, lead: asLead(l, data[l.id]) })), [leads, data]);
  const changed = saved !== null && JSON.stringify(saved) !== JSON.stringify(draft);
  // What "Apply to my leads" would do: only leads nobody has marked yet get Good or No (a mark by you or the AI is kept).
  const preview = useMemo(() => {
    const good: string[] = [], no: string[] = [];
    let rejected = 0;
    for (const { row, lead } of pool) {
      const s = applyRules({ ...lead }, draft.rules);
      if (s.ruleReject) rejected++;
      if (row.verdict || !s.ruleMark) continue;
      (s.ruleMark === "Good" ? good : no).push(row.id);
    }
    return { good, no, rejected };
  }, [pool, draft.rules]);
  const hits = useMemo(() => draft.rules.map((r) => pool.filter(({ lead }) => ruleMatches(r, { ...lead, quality: dataQuality(lead) })).length), [pool, draft.rules]);
  const oldRules = draft.rules.filter(isOldPointsRule).length;

  const setRule = (i: number, patch: Partial<Rule>) => setDraft({ ...draft, rules: draft.rules.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const setF = (k: keyof Refine, v: Refine[keyof Refine]) => setDraft({ ...draft, refine: { ...draft.refine, [k]: v } });

  async function save() {
    if (!account || !canEdit) return;
    const c = cleanRules(draft);
    setBusy("save");
    if (!demo) {
      const { error } = await supabaseBrowser().from("team_rules").upsert({ team_id: account.team_id, ...c, updated_at: new Date().toISOString() }, { onConflict: "team_id" });
      if (error) { setBusy(""); toast(/team_rules|schema cache/i.test(error.message) ? "Rules are coming soon to your workspace." : error.message); return; }
    }
    setSaved(c); setDraft(c); setBusy("");
    toast("Saved for your team. New leads follow these rules; click Apply to my leads for the ones already here.");
  }
  async function apply() {
    if (!account || !canEdit) return;
    const n = preview.good.length + preview.no.length;
    if (!n) { toast("No unmarked lead matches a Mark Good or Mark No rule."); return; }
    if (!await askConfirm(`Mark ${preview.good.length.toLocaleString()} leads Good and ${preview.no.length.toLocaleString()} leads No? Only leads with no mark yet change; you can change any of them later.`, { ok: "Apply" })) return;
    setBusy("apply");
    if (!demo) {
      for (const [verdict, ids] of [["Good", preview.good], ["No", preview.no]] as const) {
        for (let i = 0; i < ids.length; i += 300) {
          const { error } = await supabaseBrowser().from("leads").update({ verdict }).in("id", ids.slice(i, i + 300)).is("verdict", null);
          if (error) { setBusy(""); toast(error.message); return; }
        }
      }
    }
    onLeads(Object.fromEntries([...preview.good.map((id) => [id, { verdict: "Good" as const }]), ...preview.no.map((id) => [id, { verdict: "No" as const }])]));
    setBusy(""); toast(`Marked ${n.toLocaleString()} ${n === 1 ? "lead" : "leads"}.`);
  }

  if (!saved) return <div className="app-page"><header className="head"><div><h1>Rules</h1><span className="sub">Loading…</span></div></header></div>;
  const off = !canEdit || Boolean(busy);
  const marks = preview.good.length + preview.no.length;
  const status = `${changed ? "Unsaved changes" : "Saved for your team"}${marks ? ` · ${marks.toLocaleString()} unmarked ${marks === 1 ? "lead" : "leads"} to mark on Apply` : ""}${preview.rejected ? ` · ${preview.rejected.toLocaleString()} rejected by rules` : ""}`;
  return (
    <div className="app-page rules-page">
      <header className="head">
        <div>
          <h1>Rules <Tip text="Decide what a good lead means to your team. A rule rejects a lead, or marks it Good or No; collection filters decide which leads the extension keeps while collecting. Saved for the whole team; connected extensions use it the next time they open." /></h1>
          <span className={`sub${changed ? " rules-dirty" : ""}`} role="status">{pool.length.toLocaleString()} leads · {status}</span>
        </div>
        <div className="head-actions">
          {changed ? <button type="button" className="link-btn" disabled={Boolean(busy)} onClick={() => setDraft(saved)}>Undo</button> : null}
          <button type="button" className="btn glass small" disabled={off || changed || !marks} title={changed ? "Save first, then apply" : undefined} onClick={apply}>{busy === "apply" ? "Applying…" : "Apply to my leads"}</button>
          <button type="button" className="btn go small" disabled={off || !changed} onClick={save}>{busy === "save" ? "Saving…" : "Save"}</button>
        </div>
      </header>
      {missing ? <p className="plan-msg">Rules are coming soon to your workspace. You can try settings here, but they cannot be saved.</p> : null}
      {!canEdit && account ? <p className="plan-msg">{account.role === "viewer" ? "Viewers can see the rules but not change them." : "Your plan has ended, so rules are read-only."}</p> : null}

      <div className="seg camp-tabs" role="tablist" aria-label="Rules sections">
        {([["rules", `Rules${draft.rules.length ? ` (${draft.rules.length})` : ""}`], ["filters", "Collection filters"]] as [RulesTab, string][]).map(([id, name]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "on" : ""} onClick={() => setTab(id)}>{name}</button>
        ))}
      </div>

      {tab === "rules" ? (
        <section className="join-card rules-panel">
          <div className="rules-h"><b>Rules <Tip text="Your own logic, for example: Category contains recruiter → Reject lead, or Category contains video → Mark Good. Several words with commas mean any of them. Mark Good / Mark No only set leads nobody has marked yet; Reject also makes the extension skip the lead while collecting. (Points and tiers were removed on 18 Nov 2026.)" /></b>
            <span className="head-actions"><span className="sub-dark">{limit ? `${draft.rules.length} of ${limit}` : `${draft.rules.length}`}</span>
              <button type="button" className="btn go small" disabled={off || Boolean(limit && draft.rules.length >= limit)}
                onClick={() => setDraft({ ...draft, rules: [...draft.rules, { field: "category", op: "contains", value: "", action: "good" }] })}>Add rule</button></span></div>
          {draft.rules.length ? draft.rules.map((r, i) => (
            <div key={i} className="rule-row">
              <select aria-label="Field" value={r.field} disabled={off} onChange={(e) => setRule(i, { field: e.target.value })}>{RULE_FIELDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
              <select aria-label="Test" value={r.op} disabled={off} onChange={(e) => setRule(i, { op: e.target.value })}>{RULE_OPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
              {NO_VALUE.has(r.op) ? <span /> : <input aria-label="Value" value={r.value ?? ""} placeholder="Value, or several with commas" disabled={off} onChange={(e) => setRule(i, { value: e.target.value })} />}
              <div className="rule-foot">
                <select aria-label="Action" value={r.action} disabled={off} onChange={(e) => setRule(i, { action: e.target.value as Rule["action"] })}>
                  {isOldPointsRule(r) ? <option value={r.action}>Old points rule (does nothing)</option> : null}
                  {RULE_ACTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                <span className="sub-dark">{hits[i].toLocaleString()} match</span>
                <button type="button" className="link-btn" disabled={off} onClick={() => setDraft({ ...draft, rules: draft.rules.filter((_, j) => j !== i) })}>Delete</button>
              </div>
            </div>
          )) : <p className="sub-dark rules-empty">No rules yet.</p>}
          {oldRules ? <p className="rules-warn">{oldRules} old points {oldRules === 1 ? "rule does" : "rules do"} nothing now. Change {oldRules === 1 ? "it" : "them"} to Reject, Mark Good or Mark No, or delete {oldRules === 1 ? "it" : "them"}.</p> : null}
          {limit && draft.rules.length >= limit ? <p className="sub-dark">Your plan has {limit} custom rules. Agency has no limit.</p> : null}
        </section>
      ) : (
        <section className="join-card rules-panel">
          <div className="rules-h"><b>Collection filters <Tip text="The extension uses these while it collects: leads that fail them are not kept. They do not remove leads that are already here. 0 or empty means no filter." /></b>
            <button type="button" className="link-btn" disabled={off} onClick={() => setDraft({ ...draft, refine: { ...DEFAULT_REFINE } })}>Reset</button></div>
          <div className="filters-grid">
            {FILTER_NUMS.map(([k, label, max, step]) => (
              <label key={k} className="in"><span>{label}</span><input type="number" min={0} max={max} step={step} value={draft.refine[k] as number} disabled={off} onChange={(e) => setF(k, Number(e.target.value))} /></label>
            ))}
          </div>
          <div className="checks-grid">
            {FILTER_CHECKS.map(([k, label]) => (
              <label key={k} className="agree"><input type="checkbox" checked={Boolean(draft.refine[k])} disabled={off} onChange={(e) => setF(k, e.target.checked)} /> <span>{label}</span></label>
            ))}
          </div>
          <div className="filters-grid two">
            <label className="in"><span>Keep only names or categories with <em>any of these words, commas between</em></span><textarea rows={2} value={draft.refine.includeWords} disabled={off} onChange={(e) => setF("includeWords", e.target.value)} placeholder="agency, studio" /></label>
            <label className="in"><span>Leave out names or categories with <em>commas between</em></span><textarea rows={2} value={draft.refine.excludeWords} disabled={off} onChange={(e) => setF("excludeWords", e.target.value)} placeholder="print, estate agent, recruitment" /></label>
          </div>
        </section>
      )}
    </div>
  );
}
