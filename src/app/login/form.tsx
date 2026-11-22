"use client";

import { useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";
import { SUPABASE_KEY, SUPABASE_URL } from "@/lib/supabase/config";

// Email link (no password) or Google, for people who already have an account.
// New accounts are made on the Sign up page (/signup).
const ERRORS = {
  link: "That sign-in link has expired or was already used. Ask for a new one.",
  google: "Google sign-in was cancelled or did not finish. Try again, or use the email link.",
} as const;
export type LoginError = keyof typeof ERRORS | null;

export default function LoginForm({ ready, linkError }: { ready: boolean; linkError: LoginError }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">(linkError ? "error" : "idle");
  const [message, setMessage] = useState<string>(linkError ? ERRORS[linkError] : "");

  if (!ready) return <p className="login-note">Sign-in is not connected yet. The owner adds the Supabase settings to finish it.</p>;

  // Where to go after signing in: an App page from ?next= (only /app?view=…), else the App's home.
  const callback = () => {
    const next = new URLSearchParams(location.search).get("next") ?? "";
    const safe = /^\/app\?view=[a-z]{2,20}(&connect=1)?$/i.test(next) ? next : "/app";
    return `${location.origin}/auth/callback?next=${encodeURIComponent(safe)}`;
  };

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setState("sending"); setMessage("");
    const sb = supabaseBrowser();
    const { error } = await sb.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: callback(), shouldCreateUser: false } });
    if (!error) { setState("sent"); return; }
    if (/signups not allowed|not found|otp_disabled/i.test(error.message)) {
      // Started signing up but never confirmed? Send the confirmation email again (does nothing for unknown emails).
      const again = await sb.auth.resend({ type: "signup", email: email.trim(), options: { emailRedirectTo: callback() } });
      setState("error");
      setMessage(again.error
        ? "There is no Kestrel account for this email yet. Start a free trial, or ask your team owner for the team join link."
        : "If you started signing up with this email, we have sent your confirmation email again: open it to finish. Otherwise, start a free trial.");
      return;
    }
    setState("error");
    setMessage(/rate limit/i.test(error.message) ? "Too many emails were sent just now. Please wait a few minutes and try again." : error.message);
  }

  // signInWithOAuth only sends the browser to Supabase; if Google is switched off there, the person would land on
  // Supabase's raw error page. So ask Supabase first (its public settings list which providers are on).
  async function google() {
    setMessage("");
    const off = "Google sign-in is not switched on yet. Use the email link.";
    const on = await fetch(`${SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: SUPABASE_KEY } })
      .then((r) => (r.ok ? r.json() : null)).then((j: { external?: { google?: boolean } } | null) => j?.external?.google).catch(() => undefined);
    if (on === false) { setState("error"); setMessage(off); return; }
    const { error } = await supabaseBrowser().auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${callback()}&via=google` } });
    if (error) { setState("error"); setMessage(/provider is not enabled/i.test(error.message) ? off : error.message); }
  }

  if (state === "sent") return <div className="auth-sent"><b>Check your inbox</b><p>We sent a sign-in link to <b>{email}</b>. It works once and expires soon.</p></div>;

  return (
    <div className="auth-form">
      <button className="btn auth-google" type="button" onClick={google}><GoogleG /> Continue with Google</button>
      <div className="auth-or"><span>or</span></div>
      <form onSubmit={sendLink} className="auth-form">
        <label className="in"><span>Work email</span><input type="email" required autoComplete="email" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <button className="btn go auth-go" type="submit" disabled={state === "sending"}>{state === "sending" ? "Sending…" : "Email me a sign-in link"}</button>
      </form>
      {message ? <p className="login-note bad" role="alert">{message}</p> : null}
      <p className="auth-alt">New to Kestrel? <Link href="/pricing#plans">Start a free trial</Link></p>
    </div>
  );
}

// Google's "G" in its own colours, as Google asks for its sign-in button.
function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
