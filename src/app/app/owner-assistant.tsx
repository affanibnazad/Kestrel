"use client";

import { useCallback, useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Tip } from "@/components/ui";

// Legacy Owner panel → Assistant (kept until all 3 AI slots are configured).
// The 6 separate company key cards and 12 tier names have been removed; use Owner → AI instead.
type Company = "anthropic" | "openai" | "gemini" | "openrouter" | "groq" | "nvidia";
type Status = {
  has_key: boolean; last4: string | null; model: string; enabled: boolean; updated_at: string | null; checked_at: string | null;
  check_ok: boolean | null; check_note: string | null; messages_today: number; teams_today: number; messages_30d: number;
};
type KeyInfo = { provider: Company; last4: string | null; updated_at: string; checked_at?: string | null; check_ok?: boolean | null; check_note?: string | null };
type Providers = { provider: Company; model: string; claude_key: boolean; keys: KeyInfo[] };
type Model = { id: string; label: string };

const COMPANY: Record<Company, { name: string }> = {
  anthropic: { name: "Claude" },
  openai: { name: "ChatGPT" },
  gemini: { name: "Gemini" },
  openrouter: { name: "OpenRouter" },
  groq: { name: "Groq" },
  nvidia: { name: "NVIDIA" },
};
const ORDER: Company[] = ["anthropic", "openai", "gemini", "openrouter", "groq", "nvidia"];
const CLAUDE_MODELS: [string, string][] = [
  ["auto", "Auto: Sonnet 5.5, or Opus 5.5 for big tasks (recommended)"],
  ["claude-opus-5-5", "Claude Opus 5.5 · best · $4 / $20 per million tokens"],
  ["claude-sonnet-5-5", "Claude Sonnet 5.5 · balanced · $2 / $10"],
  ["claude-haiku-5-5", "Claude Haiku 5.5 · cheapest · $0.10 / $0.50"],
];

const DEMO_ST: Status = {
  has_key: true, last4: "x9Qa", model: "auto", enabled: true, updated_at: new Date().toISOString(), checked_at: new Date().toISOString(),
  check_ok: true, check_note: "Working.", messages_today: 42, teams_today: 6, messages_30d: 1180,
};
const DEMO_PV: Providers = {
  provider: "anthropic", model: "auto", claude_key: true,
  keys: [{ provider: "openai", last4: "Tz02", updated_at: new Date().toISOString(), checked_at: null, check_ok: null, check_note: null }],
};

export default function OwnerAssistant({ toast, demo = false }: { toast: (t: string) => void; demo?: boolean }) {
  const [st, setSt] = useState<Status | null>(null);
  const [pv, setPv] = useState<Providers | null>(null);
  const [busy, setBusy] = useState("");
  const [models, setModels] = useState<Partial<Record<Company, Model[]>>>({});
  const [form, setForm] = useState<{ provider: Company; model: string } | null>(null);

  const load = useCallback(async () => {
    if (demo) { setSt(DEMO_ST); setPv(DEMO_PV); return; }
    try {
      const sb = supabaseBrowser();
      const [a, p] = await Promise.all([sb.rpc("assistant_admin_status"), sb.rpc("assistant_admin_providers")]);
      if (a.error || !a.data) {
        setSt(null);
        setPv(null);
        return;
      }
      setSt(a.data as Status);
      if (!p.error && p.data) setPv(p.data as Providers);
      else setPv(null);
    } catch {
      setSt(null);
      setPv(null);
    }
  }, [demo]);
  useEffect(() => { Promise.resolve().then(load); }, [load]);

  if (!st) return <p className="plan-msg">Loading…</p>;

  const provider: Company = pv?.provider ?? "anthropic";
  const model = pv?.model ?? st.model;
  const hasKey = (c: Company) => c === "anthropic" ? st.has_key : Boolean(pv?.keys.find((x) => x.provider === c));
  const f = form ?? { provider, model };
  const dirty = f.provider !== provider || f.model !== model;

  async function test(c: Company) {
    setBusy(`test:${c}`);
    const r = await fetch("/api/owner/assistant-test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(c === "anthropic" ? {} : { provider: c }) })
      .then((x) => x.json()).catch(() => ({ error: "No connection." })) as { ok?: boolean; note?: string; error?: string; models?: Model[] };
    setBusy("");
    if (r.models?.length) setModels((m) => ({ ...m, [c]: r.models }));
    toast(r.error ?? r.note ?? "Done."); load();
  }

  async function saveIncluded() {
    const m = f.model.trim();
    if (f.provider !== "anthropic" && !/^[A-Za-z0-9._:/-]{1,120}$/.test(m)) { toast("Choose or type the model name."); return; }
    if (!hasKey(f.provider)) { toast(`Add Kestrel's ${COMPANY[f.provider].name} key in Owner → AI.`); return; }
    setBusy("included");
    const sb = supabaseBrowser();
    const a = pv ? await sb.rpc("set_assistant_provider", { provider: f.provider, model: m }) : { error: null };
    const b = a.error ? a : await sb.rpc("set_assistant_options", { model: m, enabled: st!.enabled });
    setBusy("");
    if (b.error) { toast(b.error.message); load(); return; }
    setForm(null);
    toast(`Legacy Included AI updated to ${COMPANY[f.provider].name} · ${m}. People always see "Kestrel AI".`);
    load();
  }

  async function switchOn(on: boolean) {
    const { error } = await supabaseBrowser().rpc("set_assistant_options", { model, enabled: on });
    if (error) toast(error.message); else { toast(on ? "Kestrel AI is on for every team." : "Kestrel AI is turned off for every team."); load(); }
  }

  const live = !st.enabled ? ["Turned off", "dnc"] : !hasKey(provider) ? ["No key", "no"] : ["On", "good"];
  const list = models[f.provider] ?? [];
  return (
    <div className="oa">
      <div className="kpis oa-kpis">
        <div><small>Assistant</small><b><em className={`pill ${live[1]}`}>{live[0]}</em></b><i className="kpi-note">{COMPANY[provider].name} · {provider === "anthropic" ? (CLAUDE_MODELS.find((x) => x[0] === model)?.[0] === "auto" ? "Auto" : model) : model}</i></div>
        <div><small>Messages today</small><b>{st.messages_today.toLocaleString()}</b><i className="kpi-note">{st.teams_today.toLocaleString()} {st.teams_today === 1 ? "team" : "teams"}</i></div>
        <div><small>Messages, last 30 days</small><b>{st.messages_30d.toLocaleString()}</b><i className="kpi-note">Daily: trial 30, Starter 100, Pro 300, Agency 1000</i></div>
      </div>

      <div className="oa-h"><h2>Legacy Included AI</h2><Tip text="Use Owner → AI to configure Swift, Talon, and Nest slots. This legacy view is kept only until all 3 slots are set." /></div>
      <section className="join-card oa-set">
        <div className="oa-row">
          <span className="oa-label">AI company</span>
          <div className="seg" role="radiogroup" aria-label="AI company">
            {ORDER.map((id) => (
              <button key={id} type="button" role="radio" aria-checked={f.provider === id} className={f.provider === id ? "on" : ""} disabled={!hasKey(id) || (id !== "anthropic" && !pv)}
                onClick={() => setForm({ provider: id, model: id === provider ? model : id === "anthropic" ? "auto" : "" })}>{COMPANY[id].name}</button>
            ))}
          </div>
        </div>
        <div className="oa-row">
          <span className="oa-label">Model</span>
          {f.provider === "anthropic" ? (
            <select value={CLAUDE_MODELS.some((m) => m[0] === f.model) ? f.model : "auto"} onChange={(e) => setForm({ provider: f.provider, model: e.target.value })} aria-label="Claude model">
              {CLAUDE_MODELS.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          ) : list.length ? (
            <select value={list.some((m) => m.id === f.model) ? f.model : ""} onChange={(e) => setForm({ provider: f.provider, model: e.target.value })} aria-label="Model">
              {list.some((m) => m.id === f.model) ? null : <option value="">{f.model || "Choose a model"}</option>}
              {list.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          ) : (
            <span className="oa-model-in"><input value={f.model} onChange={(e) => setForm({ provider: f.provider, model: e.target.value })} spellCheck={false} aria-label="Model"
              placeholder={f.provider === "openai" ? "gpt-5" : f.provider === "gemini" ? "gemini-2.5-pro" : "openai/gpt-5"} />
              <button type="button" className="link-btn" disabled={busy !== ""} onClick={() => test(f.provider)}>Load the list</button></span>
          )}
        </div>
        <div className="oa-row">
          <span className="oa-label">For every team</span>
          <label className="agree"><input type="checkbox" checked={st.enabled} onChange={(e) => switchOn(e.target.checked)} /> <span>Assistant on</span></label>
        </div>
        <div className="oa-foot">
          {dirty ? <button type="button" className="link-btn" onClick={() => setForm(null)}>Undo</button> : null}
          <button type="button" className="btn go small" disabled={!dirty || busy !== ""} onClick={saveIncluded}>{busy === "included" ? "Saving…" : "Save"}</button>
        </div>
      </section>
    </div>
  );
}
