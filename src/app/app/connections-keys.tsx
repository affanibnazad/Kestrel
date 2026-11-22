"use client";

import { askConfirm } from "@/components/dialog";
import { useCallback, useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Mark, Tip } from "@/components/ui";
import { PROVIDERS, type Provider } from "@/lib/ai";
import { AUTO } from "@/lib/ai-models";
import ServiceLogo from "./service-logo";
import Webhooks from "./webhooks-card";
import { AI_SERVICES, CRM_SERVICES, DATA_SERVICES, SERVICES, type ServiceId, type TeamKey } from "@/lib/connections";

// Connections → AI models and data sources, laid out like the integration pages of Instantly and ManyReach:
// one card per service with its status (Working, Not working, Not tested, Not connected), Add or Replace the key,
// Test (a real, free check by Kestrel's server), Remove, and where to get a key. Keys are stored encrypted for the
// whole team; the App only ever shows the last four characters. Below: which AI "Score and write" uses.
type Acct = { team_id: string; role: string } | null;
type Model = { id: string; label: string };

const ago = (s?: string | null) => {
  if (!s) return "";
  const m = Math.round((Date.now() - Date.parse(s)) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(s).toLocaleDateString(undefined, { day: "numeric", month: "short" });
};
const DEMO_KEYS: TeamKey[] = [
  { service: "anthropic", last4: "x9Qa", updated_at: new Date(Date.now() - 86400000).toISOString(), checked_at: new Date(Date.now() - 600000).toISOString(), check_ok: true, check_note: "Working. 9 Claude models available." },
  { service: "hunter", last4: "41ce", updated_at: new Date(Date.now() - 4 * 86400000).toISOString(), checked_at: new Date(Date.now() - 3 * 86400000).toISOString(), check_ok: false, check_note: "Hunter says the limit or credit is used up." },
  { service: "openai", last4: "Tz02", updated_at: new Date(Date.now() - 3600000).toISOString() },
];

function Card({ id, saved, manage, demo, onChanged, toast, onModels }: {
  id: ServiceId; saved?: TeamKey; manage: boolean; demo: boolean; onChanged: () => void; toast: (t: string) => void; onModels: (id: ServiceId, m: Model[]) => void;
}) {
  const s = SERVICES[id];
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState("");
  const status = !saved ? ["Not connected", "off"] : saved.check_ok === true ? ["Working", "good"] : saved.check_ok === false ? ["Not working", "no"] : ["Not tested", "maybe"];

  async function test() {
    if (demo) { toast("Testing needs a signed-in team."); return; }
    setBusy("test");
    const r = await fetch("/api/connections/test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ service: id }) })
      .then((x) => x.json()).catch(() => ({ error: "No connection. Try again." })) as { ok?: boolean; note?: string; models?: Model[]; error?: string };
    setBusy("");
    if (r.error) { toast(r.error); return; }
    if (r.models?.length) onModels(id, r.models);
    toast(r.note || (r.ok ? "Working." : "Not working."));
    onChanged();
  }
  async function save() {
    const v = value.trim();
    if (v.length < 8) { toast("That does not look like a key. Copy the whole key."); return; }
    if (demo) { toast("Saving needs a signed-in team."); return; }
    setBusy("save");
    const { error } = await supabaseBrowser().rpc("set_team_key", { service: id, value: v });
    setBusy("");
    if (error) { toast(error.message); return; }
    setValue(""); setEditing(false); onChanged();
    toast(`${s.name} key saved. Testing it…`);
    test();
  }
  async function remove() {
    if (demo) { toast("This needs a signed-in team."); return; }
    if (!await askConfirm(`Remove the ${s.name} key for the whole team? Anything that uses it stops until a new key is added.`)) return;
    const { error } = await supabaseBrowser().rpc("remove_team_key", { service: id });
    if (error) toast(error.message); else { toast(`${s.name} key removed.`); onChanged(); }
  }

  return (
    <article className={`cn-card ${status[1]}`}>
      <div className="cn-top">
        <ServiceLogo id={id} />
        <div className="cn-name"><b>{s.name}</b><small>{s.maker}</small></div>
        <span className={`pill ${status[1] === "off" ? "" : status[1]}`}>{status[0]}</span>
      </div>
      <p className="cn-use">{s.use}</p>
      {saved ? (
        <p className="cn-meta">Key ····{saved.last4} · saved {ago(saved.updated_at)}{saved.checked_at ? ` · tested ${ago(saved.checked_at)}` : ""}</p>
      ) : null}
      {saved?.check_note && saved.check_ok === false ? <p className="cn-note">{saved.check_note}</p> : null}
      {editing ? (
        <div className="cn-edit">
          <input type="password" autoComplete="off" spellCheck={false} value={value} onChange={(e) => setValue(e.target.value)} placeholder={`Paste your ${s.name} key (${s.looks})`} aria-label={`${s.name} key`} autoFocus
            onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }} />
          <div className="cn-btns">
            <button type="button" className="btn go small" disabled={busy !== "" || !value.trim()} onClick={save}>{busy === "save" ? "Saving…" : "Save and test"}</button>
            <button type="button" className="btn glass small" onClick={() => { setEditing(false); setValue(""); }}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="cn-btns">
          {manage ? <button type="button" className={`btn small ${saved ? "glass" : "go"}`} onClick={() => setEditing(true)}>{saved ? "Replace key" : "Add key"}</button> : null}
          {manage && saved ? <button type="button" className="btn glass small" disabled={busy !== ""} onClick={test}>{busy === "test" ? "Testing…" : "Test"}</button> : null}
          {manage && saved ? <button type="button" className="link-btn danger" onClick={remove}>Remove</button> : null}
          <span className="cn-get"><a className="link-btn" href={s.keyUrl} target="_blank" rel="noreferrer">Get a key</a><Tip text={s.how} /></span>
        </div>
      )}
    </article>
  );
}

export default function ConnectionsKeys({ account, demo, toast }: { account: Acct; demo: boolean; toast: (t: string) => void }) {
  const [saved, setSaved] = useState<TeamKey[]>([]);
  const [missing, setMissing] = useState(false);
  const [models, setModels] = useState<Partial<Record<ServiceId, Model[]>>>({});
  const [ai, setAi] = useState<{ provider: Provider; model: string } | null>(null);
  const [aiDraft, setAiDraft] = useState<{ provider: Provider; model: string } | null>(null);
  const manage = Boolean(account && ["owner", "manager"].includes(account.role));
  const editable = Boolean(account && account.role !== "viewer");

  const load = useCallback(async () => {
    if (demo || !account) { setSaved(DEMO_KEYS); setAi({ provider: "anthropic", model: AUTO }); return; }
    const sb = supabaseBrowser();
    const [k, t] = await Promise.all([sb.rpc("list_team_keys"), sb.from("team_ai").select("provider,model").maybeSingle()]);
    if (k.error) setMissing(true);
    setSaved((k.data as TeamKey[] | null) ?? []);
    const cur = (t.data as { provider: Provider; model: string } | null) ?? { provider: "anthropic" as Provider, model: AUTO };
    setAi(cur);
  }, [account, demo]);
  useEffect(() => { Promise.resolve().then(load); }, [load]);

  const draft = aiDraft ?? ai;
  const connectedAi = AI_SERVICES.filter((x) => saved.some((k) => k.service === x));
  const listed: Model[] = draft ? (models[draft.provider as ServiceId] ?? PROVIDERS[draft.provider].models.map((m) => ({ id: m.id, label: m.label }))) : [];
  // Claude also offers "Auto by job": Haiku 5.5 judges leads, Sonnet 5.5 writes emails (see lib/ai-models.ts).
  const modelList: Model[] = draft?.provider === "anthropic" && !listed.some((m) => m.id === AUTO) ? [{ id: AUTO, label: "Auto by job (Haiku 5.5 judges, Sonnet 5.5 writes)" }, ...listed] : listed;
  async function saveAi() {
    if (!draft || !account) return;
    if (demo) { toast("Saving needs a signed-in team."); return; }
    const { error } = await supabaseBrowser().from("team_ai").upsert({ team_id: account.team_id, provider: draft.provider, model: draft.model.trim(), updated_at: new Date().toISOString() });
    if (error) { toast(error.message); return; }
    setAi(draft); setAiDraft(null); toast(`Score and write now uses ${SERVICES[draft.provider as ServiceId].name} · ${draft.model === AUTO ? "Auto by job" : draft.model}.`);
  }

  return (
    <div className="cn">
      {missing ? <p className="plan-msg">Keys are coming soon to your workspace.</p> : null}
      <section className="cn-sec">
        <div className="cn-sec-h"><h2>AI models</h2><Tip text="Kestrel AI is included with your plan and needs no key. To score leads and write emails in bulk (Kestrel AI → Score and write), add your own key from one AI company; you pay that company directly for what you use. Keys are stored encrypted for the whole team and shared with your connected extensions; Kestrel only shows the last four characters." /></div>
        <div className="cn-grid">
          <article className="cn-card good included">
            <div className="cn-top">
              <span className="cn-mark kestrel" aria-hidden="true"><Mark size={36} /></span>
              <div className="cn-name"><b>Kestrel AI</b><small>Included with your plan</small></div>
              <span className="pill good">Included</span>
            </div>
            <p className="cn-use">Guides you and works in the App. No key needed.</p>
          </article>
          {AI_SERVICES.map((id) => <Card key={id} id={id} saved={saved.find((k) => k.service === id)} manage={manage} demo={demo} onChanged={load} toast={toast} onModels={(sid, m) => setModels((x) => ({ ...x, [sid]: m }))} />)}
        </div>
      </section>

      <section className="cn-sec">
        <div className="cn-sec-h"><h2>AI for Score and write</h2><Tip text="Which of your connected AI companies scores leads and writes emails, and which model. Test a key to load every model it can use." /></div>
        <div className="join-card cn-default">
          {draft ? (
            <>
              <label className="in"><span>AI company</span>
                <select value={draft.provider} disabled={!editable} onChange={(e) => { const p = e.target.value as Provider; setAiDraft({ provider: p, model: p === "anthropic" ? AUTO : (models[p as ServiceId]?.[0]?.id) ?? PROVIDERS[p].models[0]?.id ?? "" }); }}>
                  {AI_SERVICES.map((id) => <option key={id} value={id}>{SERVICES[id].name}{connectedAi.includes(id) ? "" : " (no key yet)"}</option>)}
                </select></label>
              <label className="in"><span>Model</span>
                {modelList.length ? (
                  <select value={modelList.some((m) => m.id === draft.model) ? draft.model : ""} disabled={!editable} onChange={(e) => setAiDraft({ ...draft, model: e.target.value })}>
                    {modelList.some((m) => m.id === draft.model) ? null : <option value="">{draft.model || "Choose a model"}</option>}
                    {modelList.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </select>
                ) : <input value={draft.model} disabled={!editable} onChange={(e) => setAiDraft({ ...draft, model: e.target.value })} placeholder="Test the key above to load its models" />}
              </label>
              <div className="cn-btns">
                <button type="button" className="btn go small" disabled={!editable || !aiDraft || !draft.model.trim()} onClick={saveAi}>Save</button>
                {!connectedAi.includes(draft.provider as ServiceId) ? <span className="cn-warn">Add a {SERVICES[draft.provider as ServiceId].name} key above first.</span> : null}
              </div>
            </>
          ) : <p className="cn-use">Loading…</p>}
        </div>
      </section>

      <section className="cn-sec">
        <div className="cn-sec-h"><h2>Data sources</h2><Tip text="Keys for the services the extension and the App use to find leads and emails. Each is optional; add the ones you use." /></div>
        <div className="cn-grid">
          {DATA_SERVICES.map((id) => <Card key={id} id={id} saved={saved.find((k) => k.service === id)} manage={manage} demo={demo} onChanged={load} toast={toast} onModels={() => {}} />)}
        </div>
      </section>
      <section className="cn-sec">
        <div className="cn-sec-h"><h2>CRM</h2><Tip text="When you mark a lead Interested, Meeting booked or Won on the Replies page, Kestrel adds it to your CRM: HubSpot gets a contact and a deal in your default pipeline; Pipedrive gets a person, organisation and deal." /></div>
        <div className="cn-grid">
          {CRM_SERVICES.map((id) => <Card key={id} id={id} saved={saved.find((k) => k.service === id)} manage={manage} demo={demo} onChanged={load} toast={toast} onModels={() => {}} />)}
        </div>
      </section>
      <Webhooks manage={manage} demo={demo} toast={toast} />
      {!manage && account ? <p className="plan-msg">Only the owner or a manager can add, test or remove keys.</p> : null}
    </div>
  );
}
