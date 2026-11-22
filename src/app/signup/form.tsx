"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";
import { PLANS, money, type PlanId } from "@/lib/plans";
import { offerFor, offerPrice, offerText, type PublicOffer } from "@/lib/offers";
import { readRef } from "@/components/ref-capture";

const SIZES = ["Just me", "2–5", "6–20", "21–50", "51–200", "200+"];
const HEARD = ["Google search", "LinkedIn", "YouTube", "A friend or colleague", "Facebook or Instagram", "X (Twitter)", "Reddit", "Other"];
const COUNTRIES = ["Australia", "Austria", "Bangladesh", "Belgium", "Brazil", "Canada", "China", "Colombia", "Czechia", "Denmark", "Egypt", "Finland", "France",
  "Germany", "Ghana", "Greece", "Hong Kong", "Hungary", "India", "Indonesia", "Ireland", "Israel", "Italy", "Japan", "Kenya", "Malaysia", "Mexico", "Morocco",
  "Nepal", "Netherlands", "New Zealand", "Nigeria", "Norway", "Pakistan", "Philippines", "Poland", "Portugal", "Qatar", "Romania", "Saudi Arabia", "Singapore",
  "South Africa", "South Korea", "Spain", "Sri Lanka", "Sweden", "Switzerland", "Thailand", "Turkey", "Ukraine", "United Arab Emirates", "United Kingdom",
  "United States", "Vietnam", "Other"];

// Create an account. No password: we email a link. With a team join link (?team=…) the person joins that team,
// so the company questions are skipped.
export default function SignupForm({ ready, joinCode, teamName, plan: startPlan, full = false }: { ready: boolean; joinCode: string; teamName: string | null; plan: PlanId; full?: boolean }) {
  const [f, setF] = useState({ name: "", email: "", job: "", company: "", website: "", size: "", country: "", heard: "", plan: startPlan, agree: false, news: false });
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");
  const joining = Boolean(joinCode && teamName && !full);
  // Simple bot trap (no keys needed): a hidden field people never see, and forms sent within 3 seconds are refused.
  // The clock is read after the page opens (not while Next.js pre-builds the page), so the build stays static.
  const openedAt = useRef(0);
  useEffect(() => { openedAt.current = Date.now(); }, []);
  const [trap, setTrap] = useState("");
  // A creator's code: from their link (?ref=, remembered by RefCapture) or typed here. Checked against the creator list.
  const [ref, setRef] = useState({ code: "", fromLink: "", creator: "" as string | null });
  // Or an offer code from Owner → Offers (database 046); and the creator discount as set there.
  const [offer, setOffer] = useState<PublicOffer | null>(null);
  const [creatorOffer, setCreatorOffer] = useState<PublicOffer | null>(null);
  useEffect(() => {
    supabaseBrowser().rpc("public_offers").then(({ data, error }) => { if (!error) setCreatorOffer((data as { creators?: PublicOffer | null } | null)?.creators ?? null); });
  }, []);
  useEffect(() => {
    const fromUrl = (new URLSearchParams(location.search).get("ref") ?? "").toUpperCase();
    const code = /^[A-Z0-9]{3,20}$/.test(fromUrl) ? fromUrl : readRef();
    if (code) Promise.resolve().then(() => setRef({ code, fromLink: code, creator: "" }));
  }, []);
  useEffect(() => {
    const code = ref.code.trim().toUpperCase();
    if (!/^[A-Z0-9]{3,20}$/.test(code)) return;
    const t = setTimeout(async () => {
      const { data, error } = await supabaseBrowser().rpc("creator_code_info", { code });
      if (error) return; // cannot check now (or before database 040): say nothing, the code is still sent
      const name = (data as { name?: string } | null)?.name ?? null;
      let o: PublicOffer | null = null;
      if (!name) { const r2 = await supabaseBrowser().rpc("check_offer_code", { code }); o = r2.error ? null : (r2.data as PublicOffer | null); }
      setRef((r) => (r.code.trim().toUpperCase() === code ? { ...r, creator: name ?? (o ? "" : null) } : r));
      setOffer(o);
    }, 350);
    return () => clearTimeout(t);
  }, [ref.code]);

  if (!ready) return <p className="login-note">Sign-up is not connected yet.</p>;
  if (joinCode && !teamName) return <p className="login-note bad">This team link is not valid any more. Ask your team owner for a new one.</p>;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!f.agree) { setState("error"); setMessage("Please agree to the Terms and Privacy Policy."); return; }
    if (trap || Date.now() - openedAt.current < 3000) { setState("error"); setMessage("That was very fast. Please check your details and try again."); return; }
    setState("sending"); setMessage("");
    const site = f.website.trim() && !/^https?:\/\//i.test(f.website.trim()) ? `https://${f.website.trim()}` : f.website.trim();
    const { error } = await supabaseBrowser().auth.signInWithOtp({
      email: f.email.trim(),
      options: {
        shouldCreateUser: true,
        emailRedirectTo: `${location.origin}/auth/callback?next=/app`,
        data: {
          full_name: f.name.trim(), job_title: f.job.trim(), accepted_terms_at: new Date().toISOString(), marketing: f.news ? "true" : "false",
          join_code: joining ? joinCode : "",
          ...(joining ? {} : { company: f.company.trim(), website: site, team_size: f.size, country: f.country, heard_from: f.heard, plan: f.plan,
            ...(ref.code.trim().length >= 3 && ref.creator ? { ref: ref.code.trim().toUpperCase(), ref_source: ref.code.trim().toUpperCase() === ref.fromLink ? "link" : "code" }
              : ref.code.trim().length >= 3 && offer ? { offer: ref.code.trim().toUpperCase() }
              : ref.code.trim().length >= 3 && ref.creator !== null ? { ref: ref.code.trim().toUpperCase(), ref_source: ref.code.trim().toUpperCase() === ref.fromLink ? "link" : "code" } : {}) }),
        },
      },
    });
    if (error) {
      setState("error");
      setMessage(/signups not allowed|otp_disabled/i.test(error.message) ? "New sign-ups are paused right now. Please try again later." : /rate limit/i.test(error.message) ? "Too many emails were sent just now. Please wait a few minutes and try again." : error.message);
    } else setState("sent");
  }

  if (state === "sent") return (
    <div className="auth-sent">
      <b>Check your inbox</b>
      <p>We sent a link to <b>{f.email}</b>. Open it in this browser to finish creating your account.</p>
    </div>
  );

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF({ ...f, [k]: k === "agree" || k === "news" ? (e.target as HTMLInputElement).checked : e.target.value });
  return (
    <form onSubmit={submit} className="auth-form">
      {joining ? <p className="auth-join">You&rsquo;re joining <b>{teamName}</b>.</p> : null}
      {joinCode && teamName && full ? <p className="login-note bad"><b>{teamName}</b> is full on its plan. Ask the team owner to choose a bigger plan, or create your own account below (it gets its own free trial).</p> : null}
      <label className="hp-field" aria-hidden="true">Leave this empty<input tabIndex={-1} autoComplete="off" value={trap} onChange={(e) => setTrap(e.target.value)} name="kst_hp_check" data-lpignore="true" data-1p-ignore="true" /></label>
      <fieldset>
        <legend>About you</legend>
        <div className="row2">
          <label className="in"><span>Full name</span><input required autoComplete="name" value={f.name} onChange={set("name")} /></label>
          <label className="in"><span>Job title</span><input autoComplete="organization-title" placeholder="Founder, Marketing lead…" value={f.job} onChange={set("job")} /></label>
        </div>
        <label className="in"><span>Work email</span><input required type="email" autoComplete="email" placeholder="you@company.com" value={f.email} onChange={set("email")} /></label>
      </fieldset>
      {joining ? null : (
        <>
          <fieldset>
            <legend>Your company</legend>
            <div className="row2">
              <label className="in"><span>Company name</span><input required autoComplete="organization" value={f.company} onChange={set("company")} /></label>
              <label className="in"><span>Website</span><input type="text" inputMode="url" autoComplete="url" placeholder="company.com" value={f.website} onChange={set("website")} /></label>
            </div>
            <div className="row2">
              <label className="in"><span>Team size</span><select required value={f.size} onChange={set("size")}><option value="" disabled>Choose</option>{SIZES.map((x) => <option key={x}>{x}</option>)}</select></label>
              <label className="in"><span>Country</span><select required value={f.country} onChange={set("country")}><option value="" disabled>Choose</option>{COUNTRIES.map((x) => <option key={x}>{x}</option>)}</select></label>
            </div>
          </fieldset>
          <fieldset>
            <legend>Plan after your trial</legend>
            <div className="plan-pick" role="radiogroup" aria-label="Plan">
              {PLANS.map((p) => (
                <label key={p.id} className={`pp${f.plan === p.id ? " on" : ""}`}>
                  <input type="radio" name="plan" value={p.id} checked={f.plan === p.id} onChange={() => setF({ ...f, plan: p.id })} />
                  <b>{p.name}</b>
                  <span>{(() => { const o = ref.creator ? creatorOffer : offerFor(offer, p.id) ? offer : null;
                    return o ? <>{money(offerPrice(p.price, o))}<s>{money(p.price)}</s></> : money(p.price); })()}<small>/mo</small></span>
                </label>
              ))}
            </div>
            <label className="in"><span>Creator or offer code <em>Optional</em></span><input value={ref.code} maxLength={20} autoComplete="off" spellCheck={false} placeholder="From a video or newsletter" onChange={(e) => setRef({ ...ref, code: e.target.value.replace(/[^a-z0-9]/gi, "").toUpperCase(), creator: "" })} /></label>
            {ref.code.length >= 3 && ref.creator ? <p className="login-note">Code from <b>{ref.creator}</b>{creatorOffer ? `: ${offerText(creatorOffer)}` : ""} when you choose a plan.</p>
              : ref.code.length >= 3 && offer ? <p className="login-note"><b>{offer.name}</b>: {offerText(offer)}{offer.plans.length ? ` on ${offer.plans.map((x) => PLANS.find((p) => p.id === x)?.name ?? x).join(", ")}` : ""} when you choose a plan.</p>
              : ref.code.length >= 3 && ref.creator === null ? <p className="login-note bad">We don&rsquo;t know this code. Check the spelling, or leave it empty.</p> : null}
            <label className="in"><span>How did you hear about us? <em>Optional</em></span><select value={f.heard} onChange={set("heard")}><option value="">Choose</option>{HEARD.map((x) => <option key={x}>{x}</option>)}</select></label>
          </fieldset>
        </>
      )}
      <label className="agree"><input type="checkbox" checked={f.agree} onChange={set("agree")} /> <span>I agree to the <Link href="/terms" target="_blank">Terms</Link> and <Link href="/privacy" target="_blank">Privacy Policy</Link>.</span></label>
      <label className="agree"><input type="checkbox" checked={f.news} onChange={set("news")} /> <span>Send me Kestrel news and special offers (optional, unsubscribe any time).</span></label>
      <button className="btn go auth-go" type="submit" disabled={state === "sending"}>{state === "sending" ? "Sending…" : joining ? "Join the team" : "Start free trial"}</button>
      {message ? <p className="login-note bad" role="alert">{message}</p> : null}
      <p className="auth-alt">Already have an account? <Link href="/login">Log in</Link></p>
    </form>
  );
}
