"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";

// Remembers the code in this browser, then claims it as soon as the visitor is signed in (here, or later in the App).
export const PENDING = "kestrel-access-code";
export async function claim(code: string) {
  const { data, error } = await supabaseBrowser().rpc("redeem_access", { code });
  if (error) return { ok: false, text: error.message.replace(/^ACCESS:\s*/, "") };
  const d = data as { plan: string; ends_at: string; days: number };
  return { ok: true, text: `Free ${d.plan[0].toUpperCase()}${d.plan.slice(1)} access for ${d.days} days, until ${new Date(d.ends_at).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}.` };
}

export default function Redeem() {
  const [state, setState] = useState<{ step: "loading" | "signin" | "done" | "error"; code: string; text: string }>({ step: "loading", code: "", text: "" });

  useEffect(() => {
    const code = (new URLSearchParams(location.search).get("code") || "").trim().toUpperCase();
    (async () => {
      if (!/^[A-Z0-9-]{6,40}$/.test(code)) { setState({ step: "error", code, text: "This invitation link is not complete. Ask for a new one." }); return; }
      const { data } = await supabaseBrowser().auth.getUser();
      if (!data.user) { try { localStorage.setItem(PENDING, code); } catch {} setState({ step: "signin", code, text: "" }); return; }
      const r = await claim(code);
      try { localStorage.removeItem(PENDING); } catch {}
      setState({ step: r.ok ? "done" : "error", code, text: r.text });
    })();
  }, []);

  if (state.step === "loading") return <p className="redeem-text">Checking your invitation…</p>;
  if (state.step === "signin") return (
    <>
      <h1>You are invited to Kestrel</h1>
      <p className="redeem-text">Your access code <b className="mono">{state.code}</b> gives your team free access. Sign up or log in, and it is added to your team by itself.</p>
      <div className="redeem-acts"><Link className="btn go" href="/signup">Create my account</Link><Link className="btn glass" href="/login">Log in</Link></div>
    </>
  );
  return (
    <>
      <h1>{state.step === "done" ? "Free access added" : "This code did not work"}</h1>
      <p className="redeem-text">{state.text}</p>
      <div className="redeem-acts"><Link className="btn go" href="/app">Open the App</Link></div>
    </>
  );
}
