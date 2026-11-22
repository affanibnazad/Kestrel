"use client";

// Your business (Phase 2, Affan 18 Nov 2026): everything the AI should know about the team in one place. How you use
// Kestrel (mode), your business and sender details, your offers, proof and tone of voice. The AI reads it to judge leads,
// write emails and answer in Kestrel AI. Saved in team_about (059), team_ai (007, 037) and offer_profiles (007).
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { askConfirm } from "@/components/dialog";
import { Tip } from "@/components/ui";
import { EMPTY_ABOUT, MODES, TONES, cleanAbout, type About, type Proof } from "@/lib/about";
import { EMPTY_OFFER, EMPTY_SENDER, offerReady, type Offer, type Sender } from "@/lib/ai";

type Acct = { team_id: string; role: string; active?: boolean } | null;
type OfferRow = Offer & { id?: string };
const DEMO_ABOUT: About = { mode: "agency", website: "https://northlight-example.test", about: "We are a small video studio. We turn long videos into short weekly clips for marketing agencies.",
  proof: [{ title: "Harbour Social (example)", result: "Posted 3x more video with the same team", link: "" }], tone: "Friendly, short, plain words", avoid: "synergy, leverage" };
const DEMO_OFFER: OfferRow = { ...EMPTY_OFFER, id: "demo-offer", name: "Short clips for agencies", offer: "Short-form video editing for agencies", customer: "Marketing agencies with 5 to 50 people",
  good: "Posts video weekly", bad: "Has an in-house video team", one_line: "We turn long videos into weekly short clips." };

export default function AboutView({ account, demo, editable, toast }: { account: Acct; demo: boolean; editable: boolean; toast: (t: string) => void }) {
  const [about, setAbout] = useState<About>(EMPTY_ABOUT);
  const [sender, setSender] = useState<Sender>(EMPTY_SENDER);
  const [offers, setOffers] = useState<OfferRow[]>([]);
  const [offer, setOffer] = useState<OfferRow>(EMPTY_OFFER);
  const [defaultOffer, setDefaultOffer] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState("");
  const sb = supabaseBrowser;

  useEffect(() => {
    if (demo || !account) {
      Promise.resolve().then(() => { setAbout(DEMO_ABOUT); setSender({ sender_name: "Alex", business: "Northlight Studio (example)", address: "12 High Street, Leeds", signature: "Best,\nAlex", booking_link: "" });
        setOffers([DEMO_OFFER]); setOffer(DEMO_OFFER); setDefaultOffer(DEMO_OFFER.id!); setLoaded(true); });
      return;
    }
    let live = true;
    Promise.all([sb().from("team_about").select("*").eq("team_id", account.team_id).maybeSingle(), sb().from("team_ai").select("*").maybeSingle(),
      sb().from("offer_profiles").select("*").order("name")]).then(([a, t, o]) => {
      if (!live) return;
      if (a.error) setMissing(true);
      setAbout(cleanAbout(a.data));
      const ai = (t.data ?? {}) as Partial<Sender> & { offer_id?: string | null };
      setSender({ sender_name: ai.sender_name ?? "", business: ai.business ?? "", address: ai.address ?? "", signature: ai.signature ?? "", booking_link: ai.booking_link ?? "" });
      const list = (o.data ?? []) as OfferRow[];
      setOffers(list); setDefaultOffer(ai.offer_id ?? null);
      setOffer(list.find((x) => x.id === ai.offer_id) ?? list[0] ?? EMPTY_OFFER);
      setLoaded(true);
    });
    return () => { live = false; };
  }, [account, demo, sb]);

  const off = !editable || Boolean(busy);
  const setProof = (i: number, patch: Partial<Proof>) => setAbout({ ...about, proof: about.proof.map((p, j) => (j === i ? { ...p, ...patch } : p)) });

  async function saveBusiness() {
    if (!account && !demo) return;
    const a = cleanAbout(about);
    if (about.website.trim() && !a.website) { toast("Website: start with https://"); return; }
    setBusy("business");
    if (!demo && account) {
      const r1 = await sb().from("team_about").upsert({ team_id: account.team_id, ...a, updated_at: new Date().toISOString() }, { onConflict: "team_id" });
      if (r1.error) { setBusy(""); toast(/team_about|schema cache/i.test(r1.error.message) ? "The About page needs database update 059." : r1.error.message); return; }
      const s = { team_id: account.team_id, sender_name: sender.sender_name.trim().slice(0, 120), business: sender.business.trim().slice(0, 120), address: sender.address.trim().slice(0, 400),
        signature: sender.signature.trim().slice(0, 400), updated_at: new Date().toISOString() };
      let r2 = await sb().from("team_ai").upsert({ ...s, booking_link: (sender.booking_link ?? "").trim().slice(0, 300) });
      if (r2.error && /booking_link/.test(r2.error.message)) r2 = await sb().from("team_ai").upsert(s);
      if (r2.error) { setBusy(""); toast(r2.error.message); return; }
    }
    setAbout(a); setBusy(""); toast("Saved. The AI uses this from now on.");
  }

  async function saveOffer(asNew: boolean) {
    if (!account && !demo) return;
    const name = offer.name.trim().slice(0, 40);
    if (!name) { toast("Give this offer a name first."); return; }
    if (asNew && offers.some((x) => x.name === name)) { toast("Change the offer name first: an offer with that name already exists."); return; }
    const row = { name, offer: offer.offer, customer: offer.customer, good: offer.good, bad: offer.bad, criteria: offer.criteria, strictness: offer.strictness, one_line: offer.one_line, updated_at: new Date().toISOString() };
    setBusy("offer");
    let saved: OfferRow;
    if (demo || !account) saved = { ...offer, ...row, id: offer.id && !asNew ? offer.id : `demo-${name}` };
    else {
      const q = offer.id && !asNew ? sb().from("offer_profiles").update(row).eq("id", offer.id).select().single() : sb().from("offer_profiles").insert({ ...row, team_id: account.team_id }).select().single();
      const { data, error } = await q;
      if (error) { setBusy(""); toast(/duplicate|unique/i.test(error.message) ? "An offer with that name already exists." : error.message); return; }
      saved = data as OfferRow;
    }
    setOffers((list) => [...list.filter((x) => x.id !== saved.id), saved].sort((a, b) => a.name.localeCompare(b.name)));
    setOffer(saved); setBusy("");
    if (!defaultOffer) await makeDefault(saved.id!);
    toast(`Saved "${name}".`);
  }
  async function makeDefault(id: string) {
    if (!demo && account) { const { error } = await sb().from("team_ai").upsert({ team_id: account.team_id, offer_id: id, updated_at: new Date().toISOString() }); if (error) { toast(error.message); return; } }
    setDefaultOffer(id);
  }
  async function deleteOffer() {
    if (!offer.id || !await askConfirm(`Delete the offer "${offer.name}" for the whole team? Leads keep their Good / Maybe / No.`, { danger: true, ok: "Delete" })) return;
    if (!demo) { const { error } = await sb().from("offer_profiles").delete().eq("id", offer.id); if (error) { toast(error.message); return; } }
    const rest = offers.filter((x) => x.id !== offer.id);
    setOffers(rest); setOffer(rest[0] ?? EMPTY_OFFER);
    toast("Offer deleted.");
  }

  if (!loaded) return <div className="app-page kpage"><header className="khead"><h1>Your business</h1></header><p className="plan-msg">Loading…</p></div>;
  const field = (label: string, k: keyof Offer, ph: string, rows = 2) => (
    <label className="in"><span>{label}</span><textarea rows={rows} value={String(offer[k] ?? "")} placeholder={ph} disabled={off} onChange={(e) => setOffer({ ...offer, [k]: e.target.value })} /></label>
  );
  const sf = (label: string, k: keyof Sender, ph: string, rows = 1) => (
    <label className="in"><span>{label}</span>{rows > 1
      ? <textarea rows={rows} value={String(sender[k] ?? "")} placeholder={ph} disabled={off} onChange={(e) => setSender({ ...sender, [k]: e.target.value })} />
      : <input value={String(sender[k] ?? "")} placeholder={ph} disabled={off} onChange={(e) => setSender({ ...sender, [k]: e.target.value })} />}</label>
  );

  return (
    <div className="app-page kpage about-page">
      <header className="khead">
        <h1>Your business <Tip text="Everything the AI should know about you, in one place. Kestrel's AI reads this page to judge leads, write personal emails and answer in Kestrel AI. Only people who can change leads can edit it." /></h1>
      </header>
      {missing ? <p className="plan-msg">The About page needs database update 059. You can fill it in, but it cannot be saved yet.</p> : null}

      <section className="join-card about-sec">
        <b>How you use Kestrel <Tip text="This changes how the AI writes: as a team (we), as you (I), or for the client you work for." /></b>
        <div className="about-modes" role="radiogroup" aria-label="How you use Kestrel">
          {MODES.map((m) => (
            <button key={m.id} type="button" role="radio" aria-checked={about.mode === m.id} className={`about-mode${about.mode === m.id ? " on" : ""}`} disabled={off} onClick={() => setAbout({ ...about, mode: m.id })}>
              <b>{m.name}</b><small>{m.who}</small>
            </button>
          ))}
        </div>
      </section>

      <div className="about-grid">
        <section className="join-card about-sec prof-form">
          <b>Your business <Tip text="The AI uses what you do and your website to understand you. Sender, postal address and signature go at the end of every email, as the email law asks." /></b>
          <div className="row2">{sf("Business name", "business", "e.g. Northlight Studio")}{sf("Sender name", "sender_name", "e.g. Alex from Northlight")}</div>
          <label className="in"><span>Website</span><input value={about.website} inputMode="url" placeholder="https://yourbusiness.com" disabled={off} onChange={(e) => setAbout({ ...about, website: e.target.value })} /></label>
          <label className="in"><span>What you do <Tip text="A few plain sentences: what you make or do, for whom, and what makes you different. 20 characters or more." /></span>
            <textarea rows={3} value={about.about} maxLength={2000} placeholder="e.g. We are a small video studio. We turn long videos into short weekly clips for marketing agencies." disabled={off} onChange={(e) => setAbout({ ...about, about: e.target.value })} /></label>
          {sf("Postal address (email footer)", "address", "e.g. 12 High Street, Leeds LS1 4AB, United Kingdom", 2)}
          <div className="row2">{sf("Signature (optional)", "signature", "e.g. Best,\nAlex", 2)}{sf("Booking link (optional)", "booking_link", "https://cal.com/you/15min")}</div>
        </section>

        <section className="join-card about-sec prof-form">
          <b>Proof <Tip text="Results, case studies or kind words from clients. The AI may mention one when it fits a lead, exactly as you wrote it. It never invents results. Up to 10." /></b>
          {about.proof.map((p, i) => (
            <div key={i} className="about-proof">
              <input aria-label="Client or project" value={p.title} maxLength={80} placeholder="Client or project" disabled={off} onChange={(e) => setProof(i, { title: e.target.value })} />
              <input aria-label="Result" value={p.result} maxLength={300} placeholder="Result, e.g. 3x more replies in 2 months" disabled={off} onChange={(e) => setProof(i, { result: e.target.value })} />
              <input aria-label="Link (optional)" value={p.link} inputMode="url" placeholder="Link (optional)" disabled={off} onChange={(e) => setProof(i, { link: e.target.value })} />
              <button type="button" className="link-btn" disabled={off} onClick={() => setAbout({ ...about, proof: about.proof.filter((_, j) => j !== i) })}>Remove</button>
            </div>
          ))}
          {about.proof.length < 10 ? <button type="button" className="btn glass small" disabled={off} onClick={() => setAbout({ ...about, proof: [...about.proof, { title: "", result: "", link: "" }] })}>Add proof</button> : null}

          <b className="about-sub">Tone of voice <Tip text="How your emails should sound. Pick one or more, or write your own." /></b>
          <div className="about-chips">
            {TONES.map((t) => { const on = about.tone.toLowerCase().includes(t.toLowerCase());
              return <button key={t} type="button" className={`oa-chip${on ? " on" : ""}`} aria-pressed={on} disabled={off}
                onClick={() => setAbout({ ...about, tone: on ? about.tone.replace(new RegExp(`\\s*${t},?\\s*`, "i"), " ").replace(/^[\s,]+|[\s,]+$/g, "") : [about.tone.trim(), t].filter(Boolean).join(", ") })}>{t}</button>; })}
          </div>
          <label className="in"><span>In your words (optional)</span><input value={about.tone} maxLength={600} placeholder="e.g. Friendly, short, plain words, no hype" disabled={off} onChange={(e) => setAbout({ ...about, tone: e.target.value })} /></label>
          <label className="in"><span>Words never to use</span><input value={about.avoid} maxLength={600} placeholder="e.g. synergy, leverage, game-changer" disabled={off} onChange={(e) => setAbout({ ...about, avoid: e.target.value })} /></label>
          <div className="join-row"><button type="button" className="btn go" disabled={off} onClick={saveBusiness}>{busy === "business" ? "Saving…" : "Save business, proof and tone"}</button></div>
        </section>
      </div>

      <section className="join-card about-sec prof-form">
        <b>Your offers <Tip text="What you sell and who buys it. The AI judges every lead against an offer and writes for it. Save several; the default one is used unless you pick another in Score and write or a campaign." /></b>
        <div className="join-row">
          <select aria-label="Offer" value={offer.id ?? ""} disabled={Boolean(busy)} onChange={(e) => setOffer(offers.find((x) => x.id === e.target.value) ?? EMPTY_OFFER)}>
            {offer.id ? null : <option value="">New offer</option>}
            {offers.map((o) => <option key={o.id} value={o.id}>{o.name}{o.id === defaultOffer ? " (default)" : ""}</option>)}
          </select>
          <button type="button" className="btn small glass" disabled={off} onClick={() => setOffer({ ...EMPTY_OFFER })}>New offer</button>
          {offer.id && offer.id !== defaultOffer ? <button type="button" className="link-btn" disabled={off} onClick={() => makeDefault(offer.id!).then(() => toast("Default offer set."))}>Make default</button> : null}
          {offer.id ? <button type="button" className="link-btn danger" disabled={off} onClick={deleteOffer}>Delete</button> : null}
        </div>
        <div className="about-grid">
          <div>
            <label className="in"><span>Offer name</span><input value={offer.name} maxLength={40} disabled={off} placeholder="e.g. Video editing for agencies" onChange={(e) => setOffer({ ...offer, name: e.target.value })} /></label>
            {field("What you sell", "offer", "e.g. Short-form video editing for agencies")}
            {field("Ideal customer", "customer", "e.g. Marketing agencies with 5 to 50 people")}
            {field("One line on what you do (in every email)", "one_line", "e.g. We turn long videos into weekly short clips.")}
          </div>
          <div>
            {field("Good signs", "good", "e.g. Posts video weekly, hiring an editor")}
            {field("Disqualifiers", "bad", "e.g. Has an in-house video team")}
            {field("Other criteria", "criteria", "Anything else the AI should weigh")}
            <div className="in"><span>How strict <Tip text="Lenient keeps more leads as Maybe. Strict marks Good only with clear proof." /></span>
              <div className="seg">{(["lenient", "balanced", "strict"] as const).map((v) => (
                <button key={v} type="button" className={offer.strictness === v ? "on" : ""} disabled={off} onClick={() => setOffer({ ...offer, strictness: v })}>{v[0].toUpperCase() + v.slice(1)}</button>
              ))}</div></div>
          </div>
        </div>
        <div className="join-row">
          <button type="button" className="btn go" disabled={off || !offerReady(offer)} onClick={() => saveOffer(false)}>{busy === "offer" ? "Saving…" : offer.id ? "Save offer" : "Save as offer"}</button>
          {offer.id ? <button type="button" className="btn glass" disabled={off} onClick={() => saveOffer(true)}>Save as new…</button> : null}
        </div>
      </section>
    </div>
  );
}
