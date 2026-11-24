"use client";

// Your business (Phase 2, Affan 18 Nov 2026): everything the AI should know about the team in one place. How you use
// Kestrel (mode), your business and sender details, your offers, proof and tone of voice. The AI reads it to judge leads,
// write emails and answer in Kestrel AI. Saved in team_about (059), team_ai (007, 037) and offer_profiles (007).
import { useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { askConfirm } from "@/components/dialog";
import { Tip } from "@/components/ui";
import { EMPTY_ABOUT, MODES, TONES, cleanAbout, type About, type Proof } from "@/lib/about";
import { EMPTY_OFFER, EMPTY_SENDER, offerReady, type Offer, type Sender } from "@/lib/ai";

type Acct = { team_id: string; role: string; active?: boolean } | null;
type OfferRow = Offer & { id?: string };
const DEMO_ABOUT: About = {
  mode: "agency",
  website: "https://northlight-example.test",
  about: "We are a small video studio. We turn long videos into short weekly clips for marketing agencies.",
  proof: [{ id: "demo-proof-1", title: "Harbour Social (example)", result: "Posted 3x more video with the same team", link: "" }],
  tone: "Friendly, short, plain words",
  avoid: "synergy, leverage",
  voice_notes: {
    greeting: "Hi {name},",
    sign_off: "Best,\nAlex",
    sentence_length: "short (8–14 words), direct",
    words_used: ["honestly", "quick question"],
    words_avoided: ["synergy", "leverage", "game-changer"],
  },
};
const DEMO_OFFER: OfferRow = {
  ...EMPTY_OFFER,
  id: "demo-offer",
  name: "Short clips for agencies",
  offer: "Short-form video editing for agencies",
  customer: "Marketing agencies with 5 to 50 people",
  good: "Posts video weekly",
  bad: "Has an in-house video team",
  one_line: "We turn long videos into weekly short clips.",
  service_type: "video_production",
  deliverables: "8 short-form clips per month, captions, vertical formats (9:16)",
  problems_solved: "Inconsistent social posting, internal editing bottleneck",
  dream_outcome: "Consistent weekly video presence without hiring in-house",
  time_to_result: "First batch delivered within 5 business days",
  client_effort: "Upload raw footage once a week to shared drive",
  risk_reversal: "Full revision until satisfied or money-back guarantee",
  first_step: "1 free test edit from existing footage",
  buying_triggers: "Hiring a video editor, launched a new podcast or YouTube channel",
  proof_ids: [],
  active: true,
};

export const SERVICE_CATEGORIES = [
  { id: "lead_generation", label: "Lead Generation & Outreach" },
  { id: "video_production", label: "Video Production & Editing" },
  { id: "web_development", label: "Web & App Development" },
  { id: "design_branding", label: "Design & Creative Branding" },
  { id: "seo_content", label: "SEO & Content Marketing" },
  { id: "paid_advertising", label: "Paid Advertising & Media Buying" },
  { id: "social_media", label: "Social Media Management" },
  { id: "copywriting", label: "Copywriting & Email Marketing" },
  { id: "consulting_strategy", label: "Consulting & Strategy" },
  { id: "sales_operations", label: "Sales Operations & RevOps" },
  { id: "recruiting_staffing", label: "Recruiting & Staffing" },
  { id: "software_saas", label: "Software & SaaS Solutions" },
  { id: "automation_ai", label: "Automation & AI Integrations" },
  { id: "pr_communications", label: "PR & Communications" },
  { id: "other", label: "Other Specialized Service" },
] as const;

export default function AboutView({ account, demo, editable, toast }: { account: Acct; demo: boolean; editable: boolean; toast: (t: string) => void }) {
  const [about, setAbout] = useState<About>(EMPTY_ABOUT);
  const [sender, setSender] = useState<Sender>(EMPTY_SENDER);
  const [offers, setOffers] = useState<OfferRow[]>([]);
  const [offer, setOffer] = useState<OfferRow>(EMPTY_OFFER);
  const [defaultOffer, setDefaultOffer] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const initialAddressRef = useRef<string>("");
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
      if (a.error || t.error) {
        const err = t.error?.message || a.error?.message || "Failed to load team data.";
        setLoadError(err);
        setLoaded(true);
        return;
      }
      setAbout(cleanAbout(a.data));
      const ai = (t.data ?? {}) as Partial<Sender> & { offer_id?: string | null };
      const addr = ai.address ?? "";
      initialAddressRef.current = addr;
      setSender({ sender_name: ai.sender_name ?? "", business: ai.business ?? "", address: addr, signature: ai.signature ?? "", booking_link: ai.booking_link ?? "" });
      const list = (o.data ?? []) as OfferRow[];
      setOffers(list); setDefaultOffer(ai.offer_id ?? null);
      setOffer(list.find((x) => x.id === ai.offer_id) ?? list[0] ?? EMPTY_OFFER);
      setLoaded(true);
    });
    return () => { live = false; };
  }, [account, demo, sb]);

  const [emailSamples, setEmailSamples] = useState("");
  const off = !editable || Boolean(busy) || Boolean(loadError);
  const setProof = (i: number, patch: Partial<Proof>) => setAbout({ ...about, proof: about.proof.map((p, j) => (j === i ? { ...p, ...patch } : p)) });

  async function analyzeVoice() {
    if (!emailSamples.trim() || emailSamples.trim().length < 50) {
      toast("Paste at least 5 to 10 sample emails first (minimum 50 characters).");
      return;
    }
    setBusy("voice");
    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ task: "voice", samples: emailSamples }),
      });
      const data = await res.json();
      if (!res.ok || !data.notes) {
        toast(data.error || "Could not analyze voice. Check AI connection.");
        setBusy("");
        return;
      }
      setAbout({
        ...about,
        voice_notes: {
          greeting: data.notes.greeting || "",
          sign_off: data.notes.sign_off || "",
          sentence_length: data.notes.sentence_length || "",
          words_used: data.notes.words_used || [],
          words_avoided: data.notes.words_avoided || [],
        },
      });
      toast("Voice profile extracted! Review and edit style notes below.");
    } catch {
      toast("Network problem reaching AI.");
    } finally {
      setBusy("");
    }
  }

  async function saveBusiness() {
    if (!account && !demo) return;
    if (loadError) { toast("Cannot save: team settings could not be loaded."); return; }
    const a = cleanAbout(about);
    if (about.website.trim() && !a.website) { toast("Website: start with https://"); return; }
    if (initialAddressRef.current.trim() && !sender.address.trim()) {
      const ok = await askConfirm("Remove your postal address? Email laws require a valid postal address in the footer.", { danger: true, ok: "Remove postal address" });
      if (!ok) return;
    }
    setBusy("business");
    if (!demo && account) {
      const r1 = await sb().from("team_about").upsert({ team_id: account.team_id, ...a, updated_at: new Date().toISOString() }, { onConflict: "team_id" });
      if (r1.error) { setBusy(""); toast(/team_about|schema cache/i.test(r1.error.message) ? "The About page needs database update 059." : r1.error.message); return; }
      const s = { team_id: account.team_id, sender_name: sender.sender_name.trim().slice(0, 120), business: sender.business.trim().slice(0, 120), address: sender.address.trim().slice(0, 400),
        signature: sender.signature.trim().slice(0, 400), updated_at: new Date().toISOString() };
      let r2 = await sb().from("team_ai").upsert({ ...s, booking_link: (sender.booking_link ?? "").trim().slice(0, 300) });
      if (r2.error && /booking_link/.test(r2.error.message)) r2 = await sb().from("team_ai").upsert(s);
      if (r2.error) { setBusy(""); toast(r2.error.message); return; }
      initialAddressRef.current = sender.address.trim();
    }
    setAbout(a); setBusy(""); toast("Saved. The AI uses this from now on.");
  }

  async function saveOffer(asNew: boolean) {
    if (!account && !demo) return;
    const name = offer.name.trim().slice(0, 40);
    if (!name) { toast("Give this offer a name first."); return; }
    if (asNew && offers.some((x) => x.name === name)) { toast("Change the offer name first: an offer with that name already exists."); return; }
    const row = {
      name,
      offer: offer.offer,
      customer: offer.customer,
      good: offer.good,
      bad: offer.bad,
      criteria: offer.criteria,
      strictness: offer.strictness,
      one_line: offer.one_line,
      service_type: offer.service_type || null,
      deliverables: (offer.deliverables || "").slice(0, 2000),
      problems_solved: (offer.problems_solved || "").slice(0, 2000),
      dream_outcome: (offer.dream_outcome || "").slice(0, 2000),
      time_to_result: (offer.time_to_result || "").slice(0, 500),
      client_effort: (offer.client_effort || "").slice(0, 1000),
      risk_reversal: (offer.risk_reversal || "").slice(0, 1000),
      first_step: (offer.first_step || "").slice(0, 1000),
      buying_triggers: (offer.buying_triggers || "").slice(0, 2000),
      proof_ids: Array.isArray(offer.proof_ids) ? offer.proof_ids : [],
      active: offer.active !== false,
      updated_at: new Date().toISOString(),
    };
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
  const field = (label: string, k: keyof Offer, ph: string, rows = 2, tip?: string) => (
    <label className="in">
      <span>
        {label}
        {tip ? <Tip text={tip} /> : null}
      </span>
      <textarea rows={rows} value={String(offer[k] ?? "")} placeholder={ph} disabled={off} onChange={(e) => setOffer({ ...offer, [k]: e.target.value })} />
    </label>
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
      {loadError ? <p className="plan-msg" role="alert" style={{ color: "var(--bad)" }}>Could not load your business settings from the server. Saving is disabled to protect your data.</p> : null}

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
          {about.proof.length < 10 ? (
            <button
              type="button"
              className="btn glass small"
              disabled={off}
              onClick={() =>
                setAbout({
                  ...about,
                  proof: [
                    ...about.proof,
                    {
                      id: typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : Math.random().toString(36).slice(2),
                      title: "",
                      result: "",
                      link: "",
                    },
                  ],
                })
              }
            >
              Add proof
            </button>
          ) : null}

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

      <section className="join-card about-sec prof-form" style={{ marginTop: 12 }}>
        <b>Voice Profile <Tip text="Paste 5–10 of your past sent emails. A real AI call turns them into short editable style notes (greeting, sign-off, sentence length, words used/avoided). We store notes only, never your raw emails." /></b>
        <label className="in">
          <span>Sample emails (5–10 past emails)</span>
          <textarea
            rows={4}
            value={emailSamples}
            placeholder="Paste 5 to 10 of your past sent emails here to extract your voice profile..."
            disabled={off}
            onChange={(e) => setEmailSamples(e.target.value)}
          />
        </label>
        <div className="join-row">
          <button
            type="button"
            className="btn small glass"
            disabled={off || busy === "voice" || emailSamples.trim().length < 50}
            onClick={analyzeVoice}
          >
            {busy === "voice" ? "Analyzing voice…" : "Analyze sample emails"}
          </button>
        </div>

        <div className="row2" style={{ marginTop: 8 }}>
          <label className="in">
            <span>Greeting style <Tip text="How you naturally greet, e.g. Hi {name}," /></span>
            <input
              value={about.voice_notes?.greeting ?? ""}
              placeholder="e.g. Hi {name},"
              disabled={off}
              onChange={(e) =>
                setAbout({
                  ...about,
                  voice_notes: { ...(about.voice_notes ?? {}), greeting: e.target.value },
                })
              }
            />
          </label>
          <label className="in">
            <span>Sign-off style <Tip text="How you naturally sign off, e.g. Best, or Cheers," /></span>
            <input
              value={about.voice_notes?.sign_off ?? ""}
              placeholder="e.g. Best,"
              disabled={off}
              onChange={(e) =>
                setAbout({
                  ...about,
                  voice_notes: { ...(about.voice_notes ?? {}), sign_off: e.target.value },
                })
              }
            />
          </label>
        </div>

        <label className="in">
          <span>Sentence rhythm & length <Tip text="E.g. Short (8-14 words), direct and punchy" /></span>
          <input
            value={about.voice_notes?.sentence_length ?? ""}
            placeholder="e.g. Short (8-14 words), direct and punchy"
            disabled={off}
            onChange={(e) =>
              setAbout({
                ...about,
                voice_notes: { ...(about.voice_notes ?? {}), sentence_length: e.target.value },
              })
            }
          />
        </label>

        <label className="in">
          <span>Words naturally used (comma separated) <Tip text="Phrases or words you naturally like to use in emails" /></span>
          <input
            value={(about.voice_notes?.words_used ?? []).join(", ")}
            placeholder="e.g. honestly, quick question, noticed your work"
            disabled={off}
            onChange={(e) =>
              setAbout({
                ...about,
                voice_notes: {
                  ...(about.voice_notes ?? {}),
                  words_used: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                },
              })
            }
          />
        </label>

        <label className="in">
          <span>Words to avoid (comma separated) <Tip text="Jargon, buzzwords, or formal phrases you never use" /></span>
          <input
            value={(about.voice_notes?.words_avoided ?? []).join(", ")}
            placeholder="e.g. synergy, leverage, elevate, robust, game-changer"
            disabled={off}
            onChange={(e) =>
              setAbout({
                ...about,
                voice_notes: {
                  ...(about.voice_notes ?? {}),
                  words_avoided: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                },
              })
            }
          />
        </label>

        <div className="join-row">
          <button type="button" className="btn go small" disabled={off} onClick={saveBusiness}>
            {busy === "business" ? "Saving…" : "Save voice profile"}
          </button>
        </div>
      </section>

      <section className="join-card about-sec prof-form">
        <b>Service Catalog <Tip text="Configure what you sell, your target client profile, evidence triggers, and deliverables. The AI evaluates leads against all active services and matches the best one. Turn services on or off at any time." /></b>
        <div className="join-row">
          <select aria-label="Offer" value={offer.id ?? ""} disabled={Boolean(busy)} onChange={(e) => setOffer(offers.find((x) => x.id === e.target.value) ?? EMPTY_OFFER)}>
            {offer.id ? null : <option value="">New service</option>}
            {offers.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}{o.active === false ? " (off)" : ""}{o.id === defaultOffer ? " (default)" : ""}
              </option>
            ))}
          </select>
          <button type="button" className="btn small glass" disabled={off} onClick={() => setOffer({ ...EMPTY_OFFER })}>New service</button>
          {offer.id ? (
            <button
              type="button"
              className={`btn small ${offer.active !== false ? "glass" : "go"}`}
              disabled={off}
              onClick={() => setOffer({ ...offer, active: offer.active === false })}
            >
              {offer.active === false ? "Turn on" : "Turn off"}
            </button>
          ) : null}
          {offer.id && offer.id !== defaultOffer ? <button type="button" className="link-btn" disabled={off} onClick={() => makeDefault(offer.id!).then(() => toast("Default service set."))}>Make default</button> : null}
          {offer.id ? <button type="button" className="link-btn danger" disabled={off} onClick={deleteOffer}>Delete</button> : null}
        </div>
        <div className="about-grid">
          <div className="ksc-fields">
            <h3 className="ksc-section-title">Basics</h3>
            <label className="in"><span>Service name</span><input value={offer.name} maxLength={40} disabled={off} placeholder="e.g. Video editing for agencies" onChange={(e) => setOffer({ ...offer, name: e.target.value })} /></label>
            <label className="in"><span>Service category <Tip text="Blueprint classification of this offering." /></span>
              <select value={offer.service_type ?? ""} disabled={off} onChange={(e) => setOffer({ ...offer, service_type: e.target.value || null })}>
                <option value="">Select category…</option>
                {SERVICE_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </label>
            {field("What you sell", "offer", "e.g. Short-form video editing for agencies")}
            {field("One line on what you do (in every email)", "one_line", "e.g. We turn long videos into weekly short clips.")}

            <h3 className="ksc-section-title" style={{ marginTop: 12 }}>Who it&apos;s for</h3>
            {field("Ideal customer", "customer", "e.g. Marketing agencies with 5 to 50 people")}
            {field("Good signs", "good", "e.g. Posts video weekly, hiring an editor")}
            {field("Disqualifiers", "bad", "e.g. Has an in-house video team")}
            {field("Other criteria", "criteria", "Anything else the AI should weigh")}
            <div className="in"><span>How strict <Tip text="Lenient keeps more leads as Maybe. Strict marks Good only with clear proof." /></span>
              <div className="seg">{(["lenient", "balanced", "strict"] as const).map((v) => (
                <button key={v} type="button" className={offer.strictness === v ? "on" : ""} disabled={off} onClick={() => setOffer({ ...offer, strictness: v })}>{v[0].toUpperCase() + v.slice(1)}</button>
              ))}</div></div>
          </div>
          <div className="ksc-fields">
            <h3 className="ksc-section-title">The offer</h3>
            {field("Deliverables", "deliverables", "e.g. 8 short-form clips per month, captions, vertical formats (9:16)", 2, "Explicit deliverables client gets, e.g. 8 short-form clips per month.")}
            {field("Problems solved", "problems_solved", "e.g. Inconsistent social posting, internal editing bottleneck", 2, "Business pains this fixes, e.g. Inconsistent posting, editing bottleneck.")}
            {field("Dream outcome", "dream_outcome", "e.g. Consistent weekly video presence without hiring in-house", 2, "Transformation the client wants, e.g. Consistent presence without hiring.")}
            {field("Time to result", "time_to_result", "e.g. First batch delivered within 5 business days", 1, "How fast, e.g. First batch in 5 days.")}
            {field("Client effort", "client_effort", "e.g. Upload raw footage once a week to shared drive", 1, "What client must do, e.g. Upload raw footage weekly.")}
            {field("Risk reversal", "risk_reversal", "e.g. Full revision until satisfied or money-back guarantee", 1, "Guarantees or terms that lower risk.")}
            {field("First step offer", "first_step", "e.g. 1 free test edit from existing footage", 1, "Low-risk starting offer, e.g. 1 free test edit.")}

            <h3 className="ksc-section-title" style={{ marginTop: 12 }}>Signals + proof</h3>
            {field("Buying triggers", "buying_triggers", "e.g. Hiring a video editor, launched a new podcast or YouTube channel", 2, "Observable events: hiring, launches, funding.")}

            <div className="in">
              <span>Linked Proof Points <Tip text="Pick confirmed proof points from Your Business above to attach to this service. The AI only cites real proof." /></span>
              {about.proof.length > 0 ? (
                <div className="about-chips" style={{ marginTop: 2 }}>
                  {about.proof.map((p) => {
                    const checked = Array.isArray(offer.proof_ids) && offer.proof_ids.includes(p.id);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        className={`oa-chip${checked ? " on" : ""}`}
                        aria-pressed={checked}
                        disabled={off}
                        onClick={() => {
                          const cur = Array.isArray(offer.proof_ids) ? [...offer.proof_ids] : [];
                          const next = checked ? cur.filter((id) => id !== p.id) : [...cur, p.id];
                          setOffer({ ...offer, proof_ids: next });
                        }}
                      >
                        {p.title || p.result || "Proof item"}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p style={{ margin: "2px 0 0", fontSize: 13, color: "var(--label2)" }}>
                  Add proof in Business, proof and tone first
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="join-row">
          <button type="button" className="btn go" disabled={off || !offerReady(offer)} onClick={() => saveOffer(false)}>{busy === "offer" ? "Saving…" : offer.id ? "Save service" : "Save as service"}</button>
          {offer.id ? <button type="button" className="btn glass" disabled={off} onClick={() => saveOffer(true)}>Save as new…</button> : null}
        </div>
      </section>
    </div>
  );
}
