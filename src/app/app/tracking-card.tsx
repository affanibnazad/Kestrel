"use client";

import { useCallback, useEffect, useState } from "react";
import { Tip } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/client";

// The team's own tracking domain for open tracking ("Seen"). Using your own domain keeps one sender's reputation
// from affecting anyone else. Setup: a DNS CNAME record to Vercel, the domain added to the Kestrel project, then Check.
const HELP = "Open tracking adds a tiny image to your emails. It loads from your own domain (for example track.yourdomain.com), never a shared one, so other senders can't hurt your inbox placement. Opens are estimates: Gmail counts the first open only, Apple Mail can show opens nobody made.";

export default function TrackingCard({ manage, demo, toast }: { manage: boolean; demo: boolean; toast: (t: string) => void }) {
  const [domain, setDomain] = useState("");
  const [saved, setSaved] = useState<{ domain: string | null; ok: boolean; checked_at: string | null } | null>(null);
  const [steps, setSteps] = useState<{ name: string; ok: boolean; detail: string }[]>([]);
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    if (demo) { setSaved({ domain: null, ok: false, checked_at: null }); return; }
    const { data } = await supabaseBrowser().rpc("my_tracking");
    const t = (data as { domain: string | null; ok: boolean; checked_at: string | null } | null) ?? { domain: null, ok: false, checked_at: null };
    setSaved(t); setDomain(t.domain ?? "");
  }, [demo]);
  useEffect(() => { Promise.resolve().then(load); }, [load]);

  async function save() {
    if (demo) { toast("This needs a signed-in team."); return; }
    setBusy("save");
    const { error } = await supabaseBrowser().rpc("set_tracking_domain", { domain: domain.trim().toLowerCase() });
    setBusy("");
    if (error) toast(error.message); else { toast("Saved. Now add the DNS record, then click Check."); setSteps([]); load(); }
  }
  async function check() {
    setBusy("check");
    const r = await fetch("/api/mail/tracking-check", { method: "POST" }).then((x) => x.json()).catch(() => ({ error: "No connection." })) as { ok?: boolean; steps?: typeof steps; error?: string };
    setBusy("");
    if (r.error) { toast(r.error); return; }
    setSteps(r.steps ?? []); toast(r.ok ? "Tracking domain works. Campaigns can now track opens." : "Not ready yet. See the steps below.");
    load();
  }

  if (!saved) return null;
  return (
    <section className="join-card prof-form trk-card">
      <b>Open tracking domain <Tip text={HELP} /></b>
      <p className="camp-note">{saved.domain ? (saved.ok ? <>✓ <b>{saved.domain}</b> works. Turn on “Track opens” in a campaign.</> : <><b>{saved.domain}</b> is saved but not checked yet.</>) : "Not set. Without it, campaigns send plain-text emails with no open tracking (best for delivery)."}</p>
      <div className="join-row">
        <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="track.yourdomain.com" aria-label="Tracking domain" disabled={!manage} />
        <button type="button" className="btn glass" disabled={!manage || busy !== "" || domain.trim().toLowerCase() === (saved.domain ?? "")} onClick={save}>{busy === "save" ? "Saving…" : "Save"}</button>
        <button type="button" className="btn go" disabled={!manage || busy !== "" || !saved.domain} onClick={check}>{busy === "check" ? "Checking…" : "Check"}</button>
      </div>
      {saved.domain && !saved.ok ? (
        <ol className="trk-steps">
          <li>At your domain provider (for example Hostinger → DNS), add a record: type <b>CNAME</b>, name <b>{saved.domain.split(".")[0]}</b>, value <b>cname.vercel-dns.com</b>.</li>
          <li>Ask for the domain to be added to the Kestrel project on Vercel (the Kestrel owner does this once).</li>
          <li>Wait a few minutes, then click <b>Check</b>.</li>
        </ol>
      ) : null}
      {steps.length ? <ul className="trk-result">{steps.map((s) => <li key={s.name} className={s.ok ? "ok" : "bad"}>{s.ok ? "✓" : "✗"} {s.name}: {s.detail}</li>)}</ul> : null}
    </section>
  );
}
