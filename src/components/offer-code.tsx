"use client";

import { useState } from "react";
import { offerText, type PublicOffer } from "@/lib/offers";

// Plan page: the team owner types an offer code (database 046). It is kept on the team and applied at checkout.
export default function OfferCode({ demo }: { demo: boolean }) {
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function apply(e: React.FormEvent) {
    e.preventDefault();
    if (demo) { setMsg({ ok: false, text: "Codes work on a signed-in team." }); return; }
    setBusy(true);
    const { supabaseBrowser } = await import("@/lib/supabase/client");
    const { data, error } = await supabaseBrowser().rpc("apply_offer_code", { code });
    setBusy(false);
    if (error) setMsg({ ok: false, text: /apply_offer_code|schema cache/i.test(error.message) ? "Offer codes are not set up yet." : error.message });
    else { const o = data as PublicOffer; setMsg({ ok: true, text: `${o.name}: ${offerText(o)}, applied when you choose a plan below.` }); setCode(""); }
  }
  return (
    <form className="offer-code" onSubmit={apply}>
      <label className="in"><span>Offer code</span>
        <input value={code} maxLength={20} placeholder="e.g. BLACKFRIDAY" autoComplete="off" spellCheck={false} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} /></label>
      <button type="submit" className="btn glass small" disabled={busy || code.length < 3}>{busy ? "Checking…" : "Apply"}</button>
      {msg ? <p className={`login-note${msg.ok ? "" : " bad"}`} role="status">{msg.text}</p> : null}
    </form>
  );
}
