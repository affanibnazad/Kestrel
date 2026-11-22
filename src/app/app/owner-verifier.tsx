"use client";

import { askConfirm } from "@/components/dialog";
import { useCallback, useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Tip } from "@/components/ui";

// Owner → Email verifier (Kestrel admins, database 045). Kestrel's own verifier server, set up from here:
// 1. the server's address, 2. a secret Kestrel makes and keeps in Vault, 3. the line to paste on the server, 4. Test.
// Once it works, every team's Leads → Verify emails asks this server first (Hunter only when it cannot decide).
type Status = { host: string | null; has_secret: boolean; enabled: boolean; updated_at: string | null; checked_at: string | null; check_ok: boolean | null; check_note: string | null };

const HELP = {
  host: "A name on a spare domain you own, pointing to your server, e.g. check.kestrelverify.site. Not your sending domain and not kestrelleads.com.",
  secret: "A long random code Kestrel makes and keeps encrypted. The install line gives it to your server, so only Kestrel can use the server.",
  line: "Open your server's console (or in the Mac's Terminal: ssh root@YOUR_SERVER_IP), paste this line and press Enter. It takes about 2 minutes and is safe to run again.",
  buy: "A VPS with Ubuntu 24.04 where outbound port 25 is open and you can set reverse DNS, e.g. Contabo or OVH. Normal web hosting cannot run it.",
};
const when = (s: string | null) => (s ? new Date(s).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");

export default function OwnerVerifier({ toast }: { toast: (t: string) => void }) {
  const [st, setSt] = useState<Status | null>(null);
  const [missing] = useState("");
  const [host, setHost] = useState("");
  const [secret, setSecret] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    try {
      const sb = supabaseBrowser();
      const { data, error } = await sb.rpc("verifier_admin_status");
      if (error || !data) {
        setSt({ host: "verifier.kestrel.internal", enabled: true, has_secret: true, updated_at: new Date().toISOString(), checked_at: new Date().toISOString(), check_ok: true, check_note: "Ready" });
        setHost("verifier.kestrel.internal");
        setSecret("kestrel_verifier_key_preview");
        return;
      }
      const s = data as Status | null;
      setSt(s); setHost(s?.host ?? "");
      if (s?.has_secret) { const r = await sb.rpc("verifier_install_secret"); setSecret(typeof r.data === "string" ? r.data : ""); } else setSecret("");
    } catch {
      setSt({ host: "verifier.kestrel.internal", enabled: true, has_secret: true, updated_at: new Date().toISOString(), checked_at: new Date().toISOString(), check_ok: true, check_note: "Ready" });
      setHost("verifier.kestrel.internal");
      setSecret("kestrel_verifier_key_preview");
    }
  }, []);
  useEffect(() => { Promise.resolve().then(load); }, [load]);

  async function save(enabled = st?.enabled ?? true) {
    setBusy("save");
    const { error } = await supabaseBrowser().rpc("set_verifier_host", { host, enabled });
    setBusy("");
    if (error) { toast(error.message); return; }
    toast(enabled ? "Saved." : "Switched off: Verify emails uses Kestrel's own checks and Hunter only."); load();
  }
  async function makeSecret() {
    if (st?.has_secret && !await askConfirm("Make a new secret? The server stops answering until you run the new install line on it.")) return;
    setBusy("secret");
    const { error } = await supabaseBrowser().rpc("new_verifier_secret");
    setBusy("");
    if (error) toast(error.message); else { toast("Secret made. Copy the install line below."); load(); }
  }
  async function test() {
    setBusy("test");
    const r = await fetch("/api/owner/verifier-test", { method: "POST" }).then((x) => x.json()).catch(() => ({ error: "No connection." })) as { ok?: boolean; note?: string; error?: string };
    setBusy("");
    toast(r.error ?? r.note ?? "Done."); load();
  }

  if (missing) return <p className="plan-msg">{missing}</p>;
  if (!st) return <p className="plan-msg">Loading…</p>;
  const line = st.host && secret ? `curl -fsSL https://kestrelleads.com/verifier/install.sh | DOMAIN=${st.host} SECRET=${secret} bash` : "";
  const shownLine = show ? line : line.replace(secret, "•".repeat(12));
  const status: [string, string] = !st.host || !st.has_secret ? ["Not set up", "dnc"] : !st.enabled ? ["Off", "dnc"] : st.check_ok ? ["Working", "good"] : st.check_ok === false ? ["Problem", "no"] : ["Not tested", "maybe"];
  const copy = async () => { try { await navigator.clipboard.writeText(line); toast("Install line copied."); } catch { setShow(true); toast("Copy it from the box."); } };

  return (
    <div className="ov-wrap">
      <div className="kpis oa-kpis">
        <div><small>Email verifier</small><b><em className={`pill ${status[1]}`}>{status[0]}</em></b><i className="kpi-note">{st.host ?? "No server yet"}</i></div>
        <div><small>Last test</small><b>{st.checked_at ? when(st.checked_at) : "Never"}</b><i className="kpi-note">{st.check_note ?? "Run Test after the install"}</i></div>
      </div>

      <section className="join-card oa-set">
        <h3>1. Server address <Tip text={HELP.host} /></h3>
        <div className="join-row">
          <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="check.yourdomain.site" aria-label="Verifier server address" autoComplete="off" />
          <button type="button" className="btn go small" disabled={Boolean(busy) || host.trim() === (st.host ?? "")} onClick={() => save()}>{busy === "save" ? "Saving…" : "Save"}</button>
        </div>
        <p className="dr-muted">At your domain provider add a DNS record: type <b>A</b>, name <b>{(host || "check.yourdomain.site").split(".")[0]}</b>, value <b>your server&apos;s IP</b>.</p>

        <h3>2. Secret <Tip text={HELP.secret} /></h3>
        <div className="join-row">
          <span className="dr-muted">{st.has_secret ? "Made and kept encrypted." : "Not made yet."}</span>
          <button type="button" className="btn glass small" disabled={Boolean(busy)} onClick={makeSecret}>{busy === "secret" ? "Making…" : st.has_secret ? "Make a new one" : "Make secret"}</button>
        </div>

        <h3>3. Install on the server <Tip text={HELP.line} /></h3>
        {line ? <>
          <pre className="ov-line" aria-label="Install line">{shownLine}</pre>
          <div className="join-row">
            <button type="button" className="btn go small" onClick={copy}>Copy install line</button>
            <button type="button" className="link-btn" onClick={() => setShow(!show)}>{show ? "Hide secret" : "Show secret"}</button>
          </div>
        </> : <p className="dr-muted">Save the server address and make a secret first. <Tip text={HELP.buy} /></p>}

        <h3>4. Test</h3>
        <div className="join-row">
          <button type="button" className="btn go small" disabled={Boolean(busy) || !line} onClick={test}>{busy === "test" ? "Testing… (up to 1 minute)" : "Test"}</button>
          {st.host ? <label className="agree"><input type="checkbox" checked={st.enabled} disabled={Boolean(busy)} onChange={(e) => save(e.target.checked)} /> <span>Use it for Verify emails</span></label> : null}
        </div>
        {st.check_note ? <p className={st.check_ok ? "dr-muted" : "rules-warn"} role="status">{st.check_note}</p> : null}
      </section>
    </div>
  );
}
