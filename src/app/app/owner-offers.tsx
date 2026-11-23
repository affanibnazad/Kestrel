"use client";

import { askConfirm } from "@/components/dialog";
import { useCallback, useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Tip } from "@/components/ui";
import { PLANS } from "@/lib/plans";
import { offerText } from "@/lib/offers";

// Owner → Offers (Kestrel admins, database 046). Make offers without touching code or Lemon Squeezy:
// "Everyone" (pricing page + applied at checkout), "Code" (typed at sign-up or on the Plan page), and the one "Creators"
// offer every creator's code gives. Kestrel makes the matching Lemon Squeezy discount codes with the key saved here.
type Kind = "everyone" | "code" | "creators";
type Offer = { id: string; name: string; code: string | null; kind: Kind; amount_type: "percent" | "fixed"; amount: number; duration: "once" | "repeating" | "forever";
  months: number | null; plans: string[]; starts_at: string | null; ends_at: string | null; max_uses: number | null; active: boolean; live: boolean;
  ls_discount_id: string | null; ls_synced_at: string | null; ls_error: string | null; uses: number; paying: number };
type Creator = { id: string; name: string; code: string; status: string; ls_discount_id: string | null; ls_error: string | null };
type Lemon = { has_key: boolean; last4: string | null; store_id: string | null; test_mode: boolean | null; checked_at: string | null; check_ok: boolean | null; check_note: string | null };
type Data = { offers: Offer[]; creators: Creator[]; lemon: Lemon | null };
type Draft = Omit<Offer, "live" | "ls_discount_id" | "ls_synced_at" | "ls_error" | "uses" | "paying" | "id"> & { id: string | null };

const KIND_NAME: Record<Kind, string> = { everyone: "Everyone", code: "Code only", creators: "Creators" };
const HELP = {
  page: "Make discounts here. Kestrel creates the same discount code in Lemon Squeezy, so the price at checkout matches. Lemon Squeezy stays in test mode until you switch it to live.",
  key: "Lemon Squeezy → Settings → API → API keys → Create. Use the test-mode key until you go live. It is stored encrypted; only the last 4 characters are shown.",
  kind: "Everyone: shown on the pricing page and applied at checkout by itself (one at a time). Code only: people type the code at sign-up or on the Plan page. Creators: the discount every creator's code gives.",
  duration: "Once: only the first payment. For N months: every payment for that many months. Forever: every payment.",
  plans: "Leave all unticked for every plan.",
  creators: "Each creator's own code gives this discount. After changing it, click Make creator codes so Lemon Squeezy uses the new amount.",
};
const toLocal = (s: string | null) => (s ? new Date(new Date(s).getTime() - new Date(s).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "");
const fromLocal = (s: string) => (s ? new Date(s).toISOString() : null);
const EMPTY: Draft = { id: null, name: "", code: "", kind: "code", amount_type: "percent", amount: 20, duration: "repeating", months: 3, plans: [], starts_at: null, ends_at: null, max_uses: null, active: true };


export default function OwnerOffers({ toast }: { toast: (t: string) => void }) {
  const [d, setD] = useState<Data | null>(null);
  const [missing] = useState("");
  const [busy, setBusy] = useState("");
  const [key, setKey] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);

  const load = useCallback(async () => {
    try {
      const { data, error } = await supabaseBrowser().rpc("offers_admin");
      if (error || !data) {
        setD(null);
        return;
      }
      setD(data as Data);
    } catch {
      setD(null);
    }
  }, []);
  useEffect(() => { Promise.resolve().then(load); }, [load]);

  const post = async (body: Record<string, unknown>, label: string) => {
    setBusy(label);
    const r = await fetch("/api/owner/offers", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      .then((x) => x.json()).catch(() => ({ error: "No connection." })) as { ok?: boolean; note?: string; error?: string };
    setBusy("");
    toast(r.error ?? r.note ?? "Done."); load();
    return !r.error;
  };
  async function saveKey() {
    setBusy("key");
    const { error } = await supabaseBrowser().rpc("set_lemon_key", { value: key });
    setBusy("");
    if (error) { toast(error.message); return; }
    setKey(""); toast("Key saved. Testing…"); post({ action: "lemon_test" }, "test");
  }
  async function saveDraft(e: React.FormEvent) {
    e.preventDefault();
    if (!draft) return;
    if (await post({ action: "save", offer: draft }, "save")) setDraft(null);
  }
  async function remove(o: Offer) {
    if (!await askConfirm(`Delete “${o.name}”? Its code ${o.code} stops working, also in Lemon Squeezy.`)) return;
    post({ action: "delete", id: o.id }, "delete");
  }

  if (missing) return <p className="plan-msg">{missing}</p>;
  if (!d) return <p className="plan-msg">Loading…</p>;
  const lemon = d.lemon;
  const creatorOffer = d.offers.find((o) => o.kind === "creators");
  const others = d.offers.filter((o) => o.kind !== "creators");
  const unsynced = d.creators.filter((c) => c.status === "active" && !c.ls_discount_id).length;
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((x) => (x ? { ...x, [k]: v } : x));

  return (
    <div className="ov-wrap">
      <p className="dr-muted">Offers <Tip text={HELP.page} /></p>

      <section className="join-card oa-set">
        <h3>Lemon Squeezy connection <Tip text={HELP.key} /></h3>
        <p className="dr-muted">{lemon?.has_key ? <>Key ending <b>{lemon.last4}</b>{lemon.check_note ? ` · ${lemon.check_note}` : ""}</> : "No key yet: offers are saved in Kestrel but their codes are not made in Lemon Squeezy."}</p>
        <div className="join-row">
          <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={lemon?.has_key ? "Paste a new key to replace it" : "Paste the Lemon Squeezy API key"} aria-label="Lemon Squeezy API key" autoComplete="off" />
          <button type="button" className="btn go small" disabled={Boolean(busy) || key.trim().length < 40} onClick={saveKey}>{busy === "key" ? "Saving…" : "Save key"}</button>
          {lemon?.has_key ? <button type="button" className="btn glass small" disabled={Boolean(busy)} onClick={() => post({ action: "lemon_test" }, "test")}>{busy === "test" ? "Testing…" : "Test"}</button> : null}
        </div>
        {lemon?.test_mode === false ? <p className="rules-warn">This is a LIVE-mode key: discounts made now are real.</p> : null}
      </section>

      {creatorOffer ? (
        <section className="join-card oa-set">
          <h3>Creators <Tip text={HELP.creators} /></h3>
          <p>Every creator code gives <b>{offerText(creatorOffer)}</b>.</p>
          <div className="join-row">
            <button type="button" className="btn glass small" disabled={Boolean(busy)} onClick={() => setDraft({ ...creatorOffer })}>Change</button>
            <button type="button" className="btn go small" disabled={Boolean(busy) || !d.creators.length} onClick={() => post({ action: "sync_creators", all: unsynced === 0 }, "creators")}>
              {busy === "creators" ? "Making…" : unsynced ? `Make creator codes (${unsynced} new)` : "Remake all creator codes"}</button>
          </div>
          <p className="dr-muted">{d.creators.length} creators · {d.creators.filter((c) => c.ls_discount_id).length} codes in Lemon Squeezy
            {d.creators.some((c) => c.ls_error) ? <> · <span className="rules-warn">{d.creators.find((c) => c.ls_error)?.ls_error}</span></> : null}</p>
        </section>
      ) : null}

      <section className="join-card oa-set">
        <div className="join-row"><h3 style={{ flex: 1 }}>Offers</h3><button type="button" className="btn go small" disabled={Boolean(busy)} onClick={() => setDraft({ ...EMPTY })}>New offer</button></div>
        {others.length ? (
          <div className="table-card members acct-table"><table className="leads">
            <thead><tr><th>Offer</th><th>Who</th><th>Discount</th><th>Dates</th><th>Used</th><th>Lemon Squeezy</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{others.map((o) => (
              <tr key={o.id}>
                <td><b>{o.name}</b><small className="muted-line">{o.code}</small></td>
                <td>{KIND_NAME[o.kind]}<small className="muted-line"><em className={`pill ${o.live ? "good" : "dnc"}`}>{o.live ? "Live" : o.active ? "Not live now" : "Off"}</em></small></td>
                <td>{offerText(o)}<small className="muted-line">{o.plans.length ? o.plans.map((p) => PLANS.find((x) => x.id === p)?.name ?? p).join(", ") : "All plans"}</small></td>
                <td><small>{o.starts_at ? `From ${new Date(o.starts_at).toLocaleDateString()}` : "Now"}{o.ends_at ? ` to ${new Date(o.ends_at).toLocaleDateString()}` : ", no end"}</small></td>
                <td>{o.uses}{o.max_uses ? ` / ${o.max_uses}` : ""}<small className="muted-line">{o.paying} paying</small></td>
                <td>{o.ls_discount_id ? "✓ Ready" : o.ls_error ? <span className="rules-warn" title={o.ls_error}>Problem</span> : o.active ? "Not made" : "—"}
                  {o.ls_error || (!o.ls_discount_id && o.active) ? <button type="button" className="link-btn" disabled={Boolean(busy)} onClick={() => post({ action: "sync", id: o.id }, "sync")}>Try again</button> : null}</td>
                <td><button type="button" className="link-btn" onClick={() => setDraft({ ...o })}>Edit</button> <button type="button" className="link-btn danger" onClick={() => remove(o)}>Delete</button></td>
              </tr>))}</tbody>
          </table></div>
        ) : <p className="dr-muted">No offers yet. Everyone pays the normal price; creator codes still give their discount.</p>}
      </section>

      {draft ? (
        <form className="join-card oa-set" onSubmit={saveDraft}>
          <h3>{draft.id ? (draft.kind === "creators" ? "Creator discount" : `Edit “${draft.name}”`) : "New offer"}</h3>
          {draft.kind !== "creators" ? <>
            <label className="in"><span>Name</span><input value={draft.name} required maxLength={80} placeholder="Black Friday" onChange={(e) => set("name", e.target.value)} /></label>
            <label className="in"><span>Code</span><input value={draft.code ?? ""} required maxLength={20} placeholder="BLACKFRIDAY" onChange={(e) => set("code", e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} /></label>
            <label className="in"><span>Who gets it <Tip text={HELP.kind} /></span>
              <select value={draft.kind} disabled={Boolean(draft.id)} onChange={(e) => set("kind", e.target.value as Kind)}><option value="code">Code only</option><option value="everyone">Everyone (pricing page)</option></select></label>
          </> : null}
          <div className="filters-grid two">
            <label className="in"><span>Discount</span><input type="number" min={1} max={draft.amount_type === "percent" ? 100 : 100000} required
              value={draft.amount_type === "fixed" ? draft.amount / 100 : draft.amount} onChange={(e) => set("amount", draft.amount_type === "fixed" ? Math.round(Number(e.target.value) * 100) : Number(e.target.value))} /></label>
            <label className="in"><span>Type</span><select value={draft.amount_type} onChange={(e) => set("amount_type", e.target.value as Draft["amount_type"])}><option value="percent">% off</option><option value="fixed">$ off</option></select></label>
            <label className="in"><span>How long <Tip text={HELP.duration} /></span><select value={draft.duration} onChange={(e) => set("duration", e.target.value as Draft["duration"])}><option value="once">First payment only</option><option value="repeating">For some months</option><option value="forever">Forever</option></select></label>
            {draft.duration === "repeating" ? <label className="in"><span>Months</span><input type="number" min={1} max={36} required value={draft.months ?? 3} onChange={(e) => set("months", Number(e.target.value))} /></label> : <span />}
          </div>
          {draft.kind !== "creators" ? <>
            <fieldset className="wh-events"><legend>Plans <Tip text={HELP.plans} /></legend>
              {PLANS.map((p) => <label key={p.id} className="agree"><input type="checkbox" checked={draft.plans.includes(p.id)} onChange={(e) => set("plans", e.target.checked ? [...draft.plans, p.id] : draft.plans.filter((x) => x !== p.id))} /> <span>{p.name}</span></label>)}
            </fieldset>
            <div className="filters-grid two">
              <label className="in"><span>Starts (optional)</span><input type="datetime-local" value={toLocal(draft.starts_at)} onChange={(e) => set("starts_at", fromLocal(e.target.value))} /></label>
              <label className="in"><span>Ends (optional)</span><input type="datetime-local" value={toLocal(draft.ends_at)} onChange={(e) => set("ends_at", fromLocal(e.target.value))} /></label>
              <label className="in"><span>Max teams (optional)</span><input type="number" min={1} value={draft.max_uses ?? ""} onChange={(e) => set("max_uses", e.target.value ? Number(e.target.value) : null)} /></label>
            </div>
          </> : null}
          <label className="agree"><input type="checkbox" checked={draft.active} onChange={(e) => set("active", e.target.checked)} /> <span>On</span></label>
          <p className="dr-muted">Preview: <b>{offerText(draft)}</b>{draft.kind !== "creators" ? ` with code ${draft.code || "…"}` : " for every creator code"}</p>
          <div className="join-row">
            <button type="submit" className="btn go small" disabled={Boolean(busy)}>{busy === "save" ? "Saving…" : "Save"}</button>
            <button type="button" className="link-btn" onClick={() => setDraft(null)}>Cancel</button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
