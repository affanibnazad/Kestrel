"use client";

import { useState } from "react";

// The contact form: saved for the Kestrel team and emailed to the team inbox. Replies come to your email.
const TOPICS: [string, string][] = [["question", "Product question"], ["sales", "Plans and teams"], ["billing", "Billing"], ["privacy", "Privacy or data request"], ["security", "Security"], ["other", "Something else"]];

export default function ContactForm() {
  const [f, setF] = useState({ name: "", email: "", company: "", topic: "question", message: "", website: "" });
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [msg, setMsg] = useState("");
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setState("sending"); setMsg("");
    const res = await fetch("/api/contact", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(f) }).catch(() => null);
    const out = res ? await res.json().catch(() => ({})) : { error: "Network problem. Check your connection and try again." };
    if (res?.ok) { setState("sent"); return; }
    setState("error"); setMsg(out.error ?? "Your message could not be sent. Please try again.");
  }

  if (state === "sent") return <div className="contact-card contact-sent" role="status"><b>Thank you, {f.name.split(" ")[0]}.</b><p>Your message has reached the Kestrel team. We reply to <b>{f.email}</b>, usually within one working day.</p></div>;

  return (
    <form className="contact-card" onSubmit={send}>
      <div className="row2">
        <label className="in"><span>Your name</span><input required maxLength={120} autoComplete="name" value={f.name} onChange={set("name")} /></label>
        <label className="in"><span>Work email</span><input required type="email" maxLength={200} autoComplete="email" placeholder="you@company.com" value={f.email} onChange={set("email")} /></label>
      </div>
      <div className="row2">
        <label className="in"><span>Company <em>optional</em></span><input maxLength={120} autoComplete="organization" value={f.company} onChange={set("company")} /></label>
        <label className="in"><span>Topic</span><select value={f.topic} onChange={set("topic")}>{TOPICS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      </div>
      <label className="in"><span>Message</span><textarea required minLength={5} maxLength={5000} rows={6} placeholder="How can we help?" value={f.message} onChange={set("message")} /></label>
      <label className="hp" aria-hidden="true">Website<input tabIndex={-1} autoComplete="off" value={f.website} onChange={set("website")} /></label>
      <button className="btn go" type="submit" disabled={state === "sending"}>{state === "sending" ? "Sending…" : "Send message"}</button>
      {msg ? <p className="login-note bad" role="alert">{msg}</p> : null}
      <p className="contact-fine">We use your details only to answer you. See our <a href="/privacy">privacy policy</a>.</p>
    </form>
  );
}
