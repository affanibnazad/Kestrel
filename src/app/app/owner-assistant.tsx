"use client";

import { askConfirm } from "@/components/dialog";
import { useCallback, useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Tip } from "@/components/ui";
import ServiceLogo from "./service-logo";

// Owner panel → Assistant (only Kestrel admins). Three parts, top to bottom:
// 1. usage numbers; 2. AI keys: Kestrel's own key for each AI company, all in the same card (Claude: database 023;
// ChatGPT, Gemini, OpenRouter: 027 + 034); 3. Included AI: which company and model answer every team's Assistant,
// and the on/off switch. Keys are stored encrypted in Vault; only the last four characters are ever shown.
type Company = "anthropic" | "openai" | "gemini" | "openrouter" | "groq" | "nvidia";
type Status = { has_key: boolean; last4: string | null; model: string; enabled: boolean; updated_at: string | null; checked_at: string | null;
  check_ok: boolean | null; check_note: string | null; messages_today: number; teams_today: number; messages_30d: number };
type KeyInfo = { provider: Company; last4: string | null; updated_at: string; checked_at?: string | null; check_ok?: boolean | null; check_note?: string | null };
type Providers = { provider: Company; model: string; claude_key: boolean; keys: KeyInfo[]; names?: Record<string, string> };
type Model = { id: string; label: string };
type Card = { id: Company; has: boolean; last4: string | null; updated_at: string | null; checked_at: string | null; check_ok: boolean | null; check_note: string | null };

const COMPANY: Record<Company, { name: string; maker: string; url: string; how: string; looks: string }> = {
  anthropic: { name: "Claude", maker: "Anthropic", url: "https://console.anthropic.com/settings/keys", looks: "sk-ant-…",
    how: "Sign in at console.anthropic.com → Settings → API keys → Create key. Add credit under Billing first." },
  openai: { name: "ChatGPT", maker: "OpenAI", url: "https://platform.openai.com/api-keys", looks: "sk-…",
    how: "Sign in at platform.openai.com → API keys → Create new secret key. Add credit under Billing first." },
  gemini: { name: "Gemini", maker: "Google", url: "https://aistudio.google.com/apikey", looks: "AIza…",
    how: "Sign in at aistudio.google.com → Get API key → Create API key." },
  openrouter: { name: "OpenRouter", maker: "Hundreds of models, one key", url: "https://openrouter.ai/keys", looks: "sk-or-…",
    how: "Sign in at openrouter.ai → Keys → Create key. Add credit first." },
  groq: { name: "Groq", maker: "Very fast open models", url: "https://console.groq.com/keys", looks: "gsk_…",
    how: "Sign in at console.groq.com → API Keys → Create API Key. A free tier with rate limits is included." },
  nvidia: { name: "NVIDIA", maker: "Nemotron and other open models", url: "https://build.nvidia.com/settings/api-keys", looks: "nvapi-…",
    how: "Sign in at build.nvidia.com → your account → API Keys → Generate API Key. When NVIDIA is the included AI, it also writes reply options, sorts replies and fixes spam words." },
};
const ORDER: Company[] = ["anthropic", "openai", "gemini", "openrouter", "groq", "nvidia"];
const CLAUDE_MODELS: [string, string][] = [
  ["auto", "Auto: Sonnet 5.5, or Opus 5.5 for big tasks (recommended)"], ["claude-opus-5-5", "Claude Opus 5.5 · best · $4 / $20 per million tokens"],
  ["claude-sonnet-5-5", "Claude Sonnet 5.5 · balanced · $2 / $10"], ["claude-haiku-5-5", "Claude Haiku 5.5 · cheapest · $0.10 / $0.50"],
];
// Kestrel names for the models (database 057): people see "Answered by Kestrel Pro", never the AI company. Pick one or type.
const NAME_TIERS: [string, string[]][] = [
  ["Fast", ["Kestrel Lite", "Kestrel Swift", "Kestrel Flash"]],
  ["Balanced", ["Kestrel Core", "Kestrel Plus", "Kestrel Pro"]],
  ["Best", ["Kestrel Max", "Kestrel Ultra", "Kestrel Apex"]],
  ["Special", ["Kestrel Vision", "Kestrel Reason", "Kestrel Agent"]],
];
const NAME_OK = /^[A-Za-z0-9][A-Za-z0-9 .+&-]{1,39}$/;
const ago = (s?: string | null) => (s ? new Date(s).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");

// Sample data for the local preview (no admin sign-in there).
const DEMO_ST: Status = { has_key: true, last4: "x9Qa", model: "auto", enabled: true, updated_at: new Date().toISOString(), checked_at: new Date().toISOString(),
  check_ok: true, check_note: "Working.", messages_today: 42, teams_today: 6, messages_30d: 1180 };
const DEMO_PV: Providers = { provider: "anthropic", model: "auto", claude_key: true,
  keys: [{ provider: "openai", last4: "Tz02", updated_at: new Date().toISOString(), checked_at: null, check_ok: null, check_note: null }], names: { auto: "Kestrel Pro" } };

export default function OwnerAssistant({ toast, demo = false }: { toast: (t: string) => void; demo?: boolean }) {
  const [st, setSt] = useState<Status | null>(null);
  const [pv, setPv] = useState<Providers | null>(null);
  const [missing] = useState("");
  const [editing, setEditing] = useState<Company | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState("");
  const [models, setModels] = useState<Partial<Record<Company, Model[]>>>({});
  const [form, setForm] = useState<{ provider: Company; model: string; name?: string } | null>(null);   // Included AI being edited (name: undefined = the saved one)

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

  if (missing) return <p className="plan-msg">{missing}</p>;
  if (!st) return <p className="plan-msg">Loading…</p>;

  const provider: Company = pv?.provider ?? "anthropic";
  const model = pv?.model ?? st.model;
  const cards: Card[] = ORDER.map((id) => {
    if (id === "anthropic") return { id, has: st.has_key, last4: st.last4, updated_at: st.updated_at, checked_at: st.checked_at, check_ok: st.check_ok, check_note: st.check_note };
    const k = pv?.keys.find((x) => x.provider === id);
    return { id, has: Boolean(k), last4: k?.last4 ?? null, updated_at: k?.updated_at ?? null, checked_at: k?.checked_at ?? null, check_ok: k?.check_ok ?? null, check_note: k?.check_note ?? null };
  });
  const hasKey = (c: Company) => cards.find((x) => x.id === c)?.has ?? false;
  const names = pv?.names ?? {};
  const f = form ?? { provider, model };
  const savedName = names[f.model.trim()] ?? "";
  const name = f.name ?? savedName;
  const nameDirty = name.trim() !== savedName;
  const dirty = f.provider !== provider || f.model !== model || nameDirty;

  async function test(c: Company) {
    setBusy(`test:${c}`);
    const r = await fetch("/api/owner/assistant-test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(c === "anthropic" ? {} : { provider: c }) })
      .then((x) => x.json()).catch(() => ({ error: "No connection." })) as { ok?: boolean; note?: string; error?: string; models?: Model[] };
    setBusy("");
    if (r.models?.length) setModels((m) => ({ ...m, [c]: r.models }));
    toast(r.error ?? r.note ?? "Done."); load();
  }
  async function saveKey(c: Company) {
    const v = value.trim();
    if (c === "anthropic" && !/^sk-ant-/.test(v)) { toast("A Claude API key starts with sk-ant-. Copy the whole key."); return; }
    if (v.length < 16) { toast("Paste the whole key."); return; }
    setBusy(`save:${c}`);
    const { error } = c === "anthropic" ? await supabaseBrowser().rpc("set_assistant_key", { value: v }) : await supabaseBrowser().rpc("set_assistant_provider_key", { provider: c, value: v });
    setBusy("");
    if (error) { toast(error.message); return; }
    setValue(""); setEditing(null); toast(`Kestrel's ${COMPANY[c].name} key saved. Testing it…`); await load(); test(c);
  }
  async function removeKey(c: Company) {
    if (!await askConfirm(`Remove Kestrel's ${COMPANY[c].name} key?${provider === c ? " Kestrel AI stops answering for every team until a new key is added or you choose another AI." : ""}`)) return;
    const { error } = c === "anthropic" ? await supabaseBrowser().rpc("remove_assistant_key") : await supabaseBrowser().rpc("remove_assistant_provider_key", { provider: c });
    if (error) toast(error.message); else { toast("Key removed."); load(); }
  }
  async function saveIncluded() {
    const m = f.model.trim();
    if (f.provider !== "anthropic" && !/^[A-Za-z0-9._:/-]{1,120}$/.test(m)) { toast("Choose or type the model name."); return; }
    if (!hasKey(f.provider)) { toast(`Add Kestrel's ${COMPANY[f.provider].name} key first.`); return; }
    const n = name.trim().replace(/\s+/g, " ");
    if (n && !NAME_OK.test(n)) { toast("Name: 2 to 40 letters, numbers, spaces or . + & -"); return; }
    setBusy("included");
    const sb = supabaseBrowser();
    const a = pv ? await sb.rpc("set_assistant_provider", { provider: f.provider, model: m }) : { error: null };
    const b = a.error ? a : await sb.rpc("set_assistant_options", { model: m, enabled: st!.enabled });
    const c = b.error || n === (names[m] ?? "") ? b : await sb.rpc("set_model_display_name", { model: m, display_name: n });
    setBusy("");
    if (c.error) { toast(/set_model_display_name|schema cache/i.test(c.error.message) ? "Model names need database update 057. The model was saved." : c.error.message); load(); return; }
    setForm(null); toast(`Every team's Assistant now uses ${COMPANY[f.provider].name} · ${f.provider === "anthropic" ? CLAUDE_MODELS.find((x) => x[0] === m)?.[1].split(":")[0] ?? m : m}. People see "${n || "Kestrel AI"}".`); load();
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

      <div className="oa-h"><h2>AI keys</h2><Tip text="Kestrel's own keys. Kestrel pays for Kestrel AI chat, reply labels and the Spam check AI fix. Teams can still use their own keys in Kestrel AI → Personalize." /></div>
      <div className="oa-keys">
        {cards.map((c) => {
          const meta = COMPANY[c.id];
          const status = !c.has ? ["No key", ""] : c.check_ok === true ? ["Working", "good"] : c.check_ok === false ? ["Not working", "no"] : ["Not tested", "maybe"];
          return (
            <article key={c.id} className={`oa-key${provider === c.id ? " in-use" : ""}`}>
              <div className="oa-key-top">
                <ServiceLogo id={c.id} size={36} />
                <div className="oa-key-name"><b>{meta.name}</b><small>{meta.maker}</small></div>
                {provider === c.id ? <em className="pill oa-inuse">In use</em> : null}
                <span className={`pill ${status[1]}`}>{status[0]}</span>
              </div>
              <p className="oa-key-meta">{c.has ? <>Key ····{c.last4}{c.checked_at ? ` · tested ${ago(c.checked_at)}` : ` · saved ${ago(c.updated_at)}`}</> : "No key yet"}
</p>
              {c.check_note && c.check_ok === false ? <p className="cn-note">{c.check_note}</p> : null}
              {editing === c.id ? (
                <div className="oa-key-edit">
                  <input type="password" autoComplete="off" spellCheck={false} value={value} autoFocus onChange={(e) => setValue(e.target.value)}
                    placeholder={`Paste the key (${meta.looks})`} aria-label={`Kestrel's ${meta.name} API key`}
                    onKeyDown={(e) => { if (e.key === "Enter") saveKey(c.id); if (e.key === "Escape") { setEditing(null); setValue(""); } }} />
                  <div className="oa-key-btns">
                    <button type="button" className="btn go small" disabled={busy !== "" || !value.trim()} onClick={() => saveKey(c.id)}>{busy === `save:${c.id}` ? "Saving…" : "Save and test"}</button>
                    <button type="button" className="btn glass small" onClick={() => { setEditing(null); setValue(""); }}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="oa-key-btns">
                  <button type="button" className={`btn small ${c.has ? "glass" : "go"}`} disabled={c.id !== "anthropic" && !pv} title={c.id !== "anthropic" && !pv ? "Needs database 027" : undefined}
                    onClick={() => { setEditing(c.id); setValue(""); }}>{c.has ? "Replace" : "Add key"}</button>
                  {c.has ? <button type="button" className="btn glass small" disabled={busy !== ""} onClick={() => test(c.id)}>{busy === `test:${c.id}` ? "Testing…" : "Test"}</button> : null}
                  {c.has ? <button type="button" className="link-btn danger" onClick={() => removeKey(c.id)}>Remove</button> : null}
                  <span className="oa-key-get"><a className="link-btn" href={meta.url} target="_blank" rel="noreferrer">Get a key</a>
                    <Tip text={`${meta.how} Paste the key here; it is stored encrypted and only its last four characters are shown.`} /></span>
                </div>
              )}
            </article>
          );
        })}
      </div>

      <div className="oa-h"><h2>Included AI</h2><Tip text="The AI company and model that answer every team's Assistant chat, unless a person picked their team's own key in Kestrel AI → Personalize." /></div>
      <section className="join-card oa-set">
        <div className="oa-row">
          <span className="oa-label">AI company</span>
          <div className="seg" role="radiogroup" aria-label="AI company">
            {ORDER.map((id) => (
              <button key={id} type="button" role="radio" aria-checked={f.provider === id} className={f.provider === id ? "on" : ""} disabled={!hasKey(id) || (id !== "anthropic" && !pv)}
                title={hasKey(id) ? undefined : `Add Kestrel's ${COMPANY[id].name} key first`}
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
        <div className="oa-row oa-name-row">
          <span className="oa-label">Name people see <Tip text="People see this under every answer (Answered by …) and Kestrel AI calls itself this. Each model keeps its own name. Empty = Kestrel AI. The AI company and model stay hidden from teams." /></span>
          <div className="oa-name">
            <input value={name} onChange={(e) => setForm({ ...f, name: e.target.value })} maxLength={40} placeholder="Kestrel AI" aria-label="Name people see" disabled={!f.model.trim()} />
            <div className="oa-tiers" role="group" aria-label="Suggested names">
              {NAME_TIERS.map(([tier, opts]) => (
                <div key={tier} className="oa-tier"><small>{tier}</small>
                  {opts.map((o) => <button key={o} type="button" className={`oa-chip${name === o ? " on" : ""}`} aria-pressed={name === o} disabled={!f.model.trim()} onClick={() => setForm({ ...f, name: o })}>{o.replace(/^Kestrel /, "")}</button>)}
                </div>
              ))}
            </div>
          </div>
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
