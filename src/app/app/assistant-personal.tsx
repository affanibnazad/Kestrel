"use client";

import { askConfirm } from "@/components/dialog";
import { useCallback, useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Tip } from "@/components/ui";

// Kestrel AI → Personalize (database 027): each person chooses which AI answers their chat (Kestrel's included AI, or
// their team's own key for Claude, ChatGPT, Gemini or OpenRouter), writes a few lines about themselves and how answers
// should sound, and sees (and deletes) the facts Kestrel AI remembers. Only this person sees these.
type Company = "anthropic" | "openai" | "gemini" | "openrouter" | "groq" | "nvidia";
type Prefs = { source: "included" | "team"; provider: Company | null; model: string | null; about: string; style: string };
type Fact = { id: string; fact: string; created_at: string };
const COMPANIES: [Company, string, string][] = [["anthropic", "Claude", ""], ["openai", "ChatGPT", "gpt-5"], ["gemini", "Gemini", "gemini-2.5-pro"], ["openrouter", "OpenRouter", "openai/gpt-5"], ["groq", "Groq", "llama-3.3-70b-versatile"], ["nvidia", "NVIDIA", "nvidia/nemotron-3-super-120b-a12b"]];
const CLAUDE_MODELS: [string, string][] = [["auto", "Auto: Sonnet for normal questions, Opus for big tasks"], ["claude-opus-5-5", "Claude Opus 5.5 (best)"], ["claude-sonnet-5-5", "Claude Sonnet 5.5 (balanced)"], ["claude-haiku-5-5", "Claude Haiku 5.5 (cheapest)"]];
const EMPTY: Prefs = { source: "included", provider: null, model: null, about: "", style: "" };
const STYLE_HINT = "Short, simple English. Use tables. One step at a time. Give me the exact next click.";

export default function AssistantPersonal({ account, demo, toast }: { account: { team_id: string } | null; demo: boolean; toast: (t: string) => void }) {
  const [prefs, setPrefs] = useState<Prefs>(EMPTY);
  const [saved, setSaved] = useState<Prefs>(EMPTY);
  const [keys, setKeys] = useState<Company[]>([]);
  const [facts, setFacts] = useState<Fact[]>([]);
  const [newFact, setNewFact] = useState("");
  const [me, setMe] = useState("");
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (demo || !account) {
      setKeys(["anthropic", "openai"]);
      setFacts([{ id: "f1", fact: "Sells white-label video editing to agencies.", created_at: new Date().toISOString() }, { id: "f2", fact: "Targets agencies in the UK and Ireland.", created_at: new Date().toISOString() }]);
      return;
    }
    const sb = supabaseBrowser();
    const [{ data: u }, p, k, m] = await Promise.all([sb.auth.getUser(), sb.from("assistant_prefs").select("source,provider,model,about,style").maybeSingle(),
      sb.rpc("list_team_keys"), sb.from("assistant_memory").select("id,fact,created_at").order("created_at", { ascending: false })]);
    if (p.error || m.error) { setMissing(true); return; }
    setMe(u.user?.id ?? "");
    const pr = { ...EMPTY, ...((p.data as Partial<Prefs> | null) ?? {}) };
    setPrefs(pr); setSaved(pr);
    setKeys(((k.data ?? []) as { service: string }[]).map((x) => x.service).filter((x): x is Company => COMPANIES.some((c) => c[0] === x)));
    setFacts((m.data ?? []) as Fact[]);
  }, [account, demo]);
  useEffect(() => { Promise.resolve().then(load); }, [load]);

  const dirty = JSON.stringify(prefs) !== JSON.stringify(saved);
  const company = prefs.provider ?? keys[0] ?? "anthropic";
  async function save() {
    if (prefs.source === "team" && !keys.includes(company)) { toast("Your team has no key for that AI company yet. Add it in Integrations → Services first."); return; }
    if (prefs.source === "team" && company !== "anthropic" && !/^[A-Za-z0-9._:/-]{1,120}$/.test(String(prefs.model ?? ""))) { toast("Type the model name, for example gpt-5."); return; }
    const row = { source: prefs.source, provider: prefs.source === "team" ? company : null,
      model: prefs.source === "team" ? (company === "anthropic" ? prefs.model || "auto" : String(prefs.model).trim()) : null,
      about: prefs.about.slice(0, 1500), style: prefs.style.slice(0, 600) };
    if (demo || !account) { setSaved({ ...prefs, ...row }); setPrefs({ ...prefs, ...row }); toast("Saved (preview only)."); return; }
    setBusy(true);
    const { error } = await supabaseBrowser().from("assistant_prefs").upsert({ user_id: me, team_id: account.team_id, ...row, updated_at: new Date().toISOString() });
    setBusy(false);
    if (error) { toast(/assistant_prefs|schema cache/i.test(error.message) ? "Personalize is coming soon to your workspace." : error.message); return; }
    setSaved({ ...prefs, ...row }); setPrefs({ ...prefs, ...row });
    toast(row.source === "team" ? `Your chat now uses ${COMPANIES.find((c) => c[0] === company)?.[1]} with your team's key.` : "Your chat now uses Kestrel's included AI.");
  }
  async function addFact() {
    const f = newFact.trim();
    if (f.length < 2) return;
    if (demo || !account) { setFacts([{ id: `d${Date.now()}`, fact: f, created_at: new Date().toISOString() }, ...facts]); setNewFact(""); return; }
    const { error } = await supabaseBrowser().rpc("remember_fact", { fact: f });
    if (error) { toast(error.message); return; }
    setNewFact("");
    const { data } = await supabaseBrowser().from("assistant_memory").select("id,fact,created_at").order("created_at", { ascending: false });
    setFacts((data ?? []) as Fact[]);   // only the facts: unsaved "About me" text stays
  }
  async function forget(ids: string[]) {
    if (!ids.length) return;
    if (ids.length > 1 && !await askConfirm("Forget everything Kestrel AI remembers about you?")) return;
    if (!demo && account) { const { error } = await supabaseBrowser().from("assistant_memory").delete().in("id", ids); if (error) { toast(error.message); return; } }
    setFacts(facts.filter((x) => !ids.includes(x.id)));
  }

  if (missing) return <p className="plan-msg">Personalize is coming soon to your workspace.</p>;
  return (
    <div className="as-personal">
      <section className="join-card prof-form">
        <div className="rules-h"><b>Which AI answers you <Tip text="Kestrel's AI is included with your plan (a daily number of messages). Or use your team's own key from Connections for any AI company: your team pays that company and Kestrel's daily limit does not apply. Only your own chat changes." /></b></div>
        <div className="seg" role="radiogroup" aria-label="Which AI">
          <button type="button" role="radio" aria-checked={prefs.source === "included"} className={prefs.source === "included" ? "on" : ""} onClick={() => setPrefs({ ...prefs, source: "included" })}>Kestrel AI (included)</button>
          <button type="button" role="radio" aria-checked={prefs.source === "team"} className={prefs.source === "team" ? "on" : ""} onClick={() => setPrefs({ ...prefs, source: "team", provider: prefs.provider ?? keys[0] ?? "anthropic" })}>My team&apos;s key</button>
        </div>
        {prefs.source === "team" ? (
          <div className="row2">
            <label className="in"><span>AI company</span>
              <select value={company} onChange={(e) => { const c = e.target.value as Company; setPrefs({ ...prefs, provider: c, model: c === "anthropic" ? "auto" : "" }); }}>
                {COMPANIES.map(([id, name]) => <option key={id} value={id}>{name}{keys.includes(id) ? "" : " (no key yet)"}</option>)}
              </select></label>
            <label className="in"><span>Model</span>
              {company === "anthropic" ? (
                <select value={prefs.model || "auto"} onChange={(e) => setPrefs({ ...prefs, model: e.target.value })}>{CLAUDE_MODELS.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
              ) : <input value={prefs.model ?? ""} spellCheck={false} placeholder={COMPANIES.find((c) => c[0] === company)?.[2]} onChange={(e) => setPrefs({ ...prefs, model: e.target.value })} />}
            </label>
          </div>
        ) : null}
        {prefs.source === "team" && !keys.includes(company) ? <p className="rules-warn">Your team has no {COMPANIES.find((c) => c[0] === company)?.[1]} key yet. Add it in Integrations → Services first.</p> : null}
      </section>

      <section className="join-card prof-form">
        <div className="rules-h"><b>About you <Tip text="Tell Kestrel AI about you and your business, so every answer fits. It uses this in every chat. It never changes what Kestrel AI is allowed to do." /></b></div>
        <label className="in"><span>About me and my business</span>
          <textarea rows={4} maxLength={1500} value={prefs.about} onChange={(e) => setPrefs({ ...prefs, about: e.target.value })}
            placeholder="I run a small video editing studio. I sell white-label editing to marketing agencies in the UK and Ireland. My goal is 3 calls a week." /></label>
        <label className="in"><span>How answers should sound</span>
          <textarea rows={2} maxLength={600} value={prefs.style} onChange={(e) => setPrefs({ ...prefs, style: e.target.value })} placeholder={STYLE_HINT} /></label>
        <div className="join-row"><button type="button" className="btn go small" disabled={busy || !dirty} onClick={save}>{busy ? "Saving…" : dirty ? "Save" : "Saved"}</button></div>
      </section>

      <section className="join-card prof-form">
        <div className="rules-h"><b>What Kestrel AI remembers <Tip text="Short facts Kestrel AI saves from your chats (your offer, niche, places, decisions) and uses later. Only you see them. Delete anything that is wrong." /></b>
          {facts.length ? <button type="button" className="link-btn danger" onClick={() => forget(facts.map((f) => f.id))}>Forget all</button> : null}</div>
        {facts.length ? (
          <ul className="as-facts">{facts.map((f) => (
            <li key={f.id}><span>{f.fact}</span><button type="button" className="link-btn" aria-label={`Forget: ${f.fact}`} onClick={() => forget([f.id])}>Forget</button></li>
          ))}</ul>
        ) : <p className="dr-muted">Nothing yet. Tell Kestrel AI about your offer or goals and it will remember.</p>}
        <div className="join-row as-fact-add">
          <input value={newFact} maxLength={240} onChange={(e) => setNewFact(e.target.value)} placeholder="Add something it should remember" aria-label="Add a fact" onKeyDown={(e) => { if (e.key === "Enter") addFact(); }} />
          <button type="button" className="btn glass small" disabled={newFact.trim().length < 2} onClick={addFact}>Add</button>
        </div>
      </section>
    </div>
  );
}
