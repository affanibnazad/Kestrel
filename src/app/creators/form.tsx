"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";

// Creator application (database 040, creator_apply). Saved for Kestrel admins: Owner → Creators → Applications.
const SIZES = ["Under 1,000", "1,000–10,000", "10,000–50,000", "50,000–250,000", "250,000+"];

export default function ApplyForm() {
  const [f, setF] = useState({ name: "", email: "", link: "", audience: "", about: "", agree: false });
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [msg, setMsg] = useState("");
  const [trap, setTrap] = useState("");
  const openedAt = useRef(0);
  useEffect(() => { openedAt.current = Date.now(); }, []);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setF({ ...f, [k]: k === "agree" ? (e.target as HTMLInputElement).checked : e.target.value });

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!f.agree) { setState("error"); setMsg("Please agree to the creator terms."); return; }
    if (trap || Date.now() - openedAt.current < 3000) { setState("error"); setMsg("That was very fast. Please check your details and try again."); return; }
    setState("sending"); setMsg("");
    const { error } = await supabaseBrowser().rpc("creator_apply", { name: f.name.trim(), email: f.email.trim(), link: f.link.trim(), audience: f.audience, about: f.about.trim() });
    if (!error) { setState("sent"); return; }
    setState("error");
    setMsg(/TOO_MANY/.test(error.message) ? error.message.replace(/^TOO_MANY:\s*/, "") : /creator_apply|schema cache/.test(error.message) ? "Applications open soon. Please try again in a few days." : "Your application could not be sent. Please check the details and try again.");
  }

  if (state === "sent") return <div className="contact-card contact-sent" role="status"><b>Thank you, {f.name.split(" ")[0]}.</b><p>We have your application and reply to <b>{f.email}</b> within a few days.</p></div>;

  return (
    <form className="contact-card" onSubmit={send}>
      <div className="row2">
        <label className="in"><span>Your name</span><input required maxLength={80} autoComplete="name" value={f.name} onChange={set("name")} /></label>
        <label className="in"><span>Email</span><input required type="email" maxLength={200} autoComplete="email" value={f.email} onChange={set("email")} /></label>
      </div>
      <div className="row2">
        <label className="in"><span>Your channel, newsletter or community</span><input required minLength={4} maxLength={300} placeholder="youtube.com/@you" value={f.link} onChange={set("link")} /></label>
        <label className="in"><span>Audience size</span><select value={f.audience} onChange={set("audience")}><option value="">Choose</option>{SIZES.map((x) => <option key={x}>{x}</option>)}</select></label>
      </div>
      <label className="in"><span>Who is your audience? <em>optional</em></span><textarea maxLength={2000} rows={4} placeholder="Agency owners learning cold email…" value={f.about} onChange={set("about")} /></label>
      <label className="hp" aria-hidden="true">Website<input tabIndex={-1} autoComplete="off" value={trap} onChange={(e) => setTrap(e.target.value)} /></label>
      <label className="agree"><input type="checkbox" checked={f.agree} onChange={set("agree")} /> <span>I have read the <Link href="/creators/terms" target="_blank">creator terms</Link>.</span></label>
      <button className="btn go" type="submit" disabled={state === "sending"}>{state === "sending" ? "Sending…" : "Apply"}</button>
      {msg ? <p className="login-note bad" role="alert">{msg}</p> : null}
      <p className="contact-fine">We use your details only to review your application. See our <a href="/privacy">privacy policy</a>.</p>
    </form>
  );
}
