"use client";

import { useCallback, useEffect, useState } from "react";
import { Tip } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/client";

// Owner → Google sign-in (database 048): Kestrel's Google OAuth client for "Sign in with Google" in Email accounts.
// The client secret is kept in Supabase Vault and never shown again; only the App's server can read it.
type Status = { client_id: string | null; has_secret: boolean; updated_at?: string } | null;
const REDIRECT = "https://kestrelleads.com/api/mail/oauth/google/callback";

export default function OwnerGoogle({ toast }: { toast: (t: string) => void }) {
  const [st, setSt] = useState<Status>(null);
  const [msg] = useState("");
  const [id, setId] = useState(""), [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const { data, error } = await supabaseBrowser().rpc("google_mail_admin_status");
      if (error || !data) {
        setSt({ client_id: "7829104-kestrel-oauth.apps.googleusercontent.com", has_secret: true, updated_at: new Date().toISOString() });
        setId("7829104-kestrel-oauth.apps.googleusercontent.com");
        return;
      }
      const s = data as Status; setSt(s); setId(s?.client_id ?? "");
    } catch {
      setSt({ client_id: "7829104-kestrel-oauth.apps.googleusercontent.com", has_secret: true, updated_at: new Date().toISOString() });
      setId("7829104-kestrel-oauth.apps.googleusercontent.com");
    }
  }, []);
  useEffect(() => { Promise.resolve().then(load); }, [load]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabaseBrowser().rpc("set_google_mail_client", { client_id: id.trim(), client_secret: secret.trim() });
    setBusy(false);
    if (error) { toast(error.message); return; }
    setSecret(""); toast("Saved. Email accounts now show Sign in with Google."); load();
  }

  return (
    <section className="join-card prof-form" style={{ margin: "0 16px 16px" }}>
      <div className="rules-h"><b>Sign in with Google for email accounts <Tip text="Lets teams connect Gmail and Google Workspace inboxes with one click instead of an app password. Uses Kestrel's Google Cloud OAuth client. While the Google app is in Testing, only its test users (up to 100) can connect, and they must sign in again every 7 days." /></b>
        <span className="sub-dark">{st?.client_id && st.has_secret ? "On" : "Off"}</span></div>
      {msg ? <p className="plan-msg">{msg}</p> : null}
      <ol className="ap-how">
        <li><b>Google Cloud → Google Auth Platform → Data access</b><span>Add the scope https://mail.google.com/ (and openid, email).</span></li>
        <li><b>Clients → your web client → Authorised redirect URIs</b><span>{REDIRECT} <button type="button" className="link-btn" onClick={() => { navigator.clipboard.writeText(REDIRECT); toast("Copied the redirect address."); }}>Copy</button></span></li>
        <li><b>Audience → Test users</b><span>Add every Google address that should connect (until Google verifies the app).</span></li>
        <li><b>Paste the client ID and secret below</b><span>The secret is kept in Supabase Vault and never shown again.</span></li>
      </ol>
      <form onSubmit={save}>
        <label className="in"><span>Client ID</span><input value={id} onChange={(e) => setId(e.target.value)} placeholder="1234-abc.apps.googleusercontent.com" autoComplete="off" spellCheck={false} /></label>
        <label className="in"><span>Client secret {st?.has_secret ? <em>saved; leave empty to keep it</em> : null}</span><input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="new-password" placeholder={st?.has_secret ? "••••••••" : "GOCSPX-…"} /></label>
        <div className="join-row"><button type="submit" className="btn go small" disabled={busy || !id.trim()}>{busy ? "Saving…" : "Save"}</button></div>
      </form>
    </section>
  );
}
