"use client";

import { askConfirm } from "@/components/dialog";
import { useCallback, useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Tip } from "@/components/ui";

// Connections → Webhooks: send Kestrel events to Zapier, Make, n8n or your own server (database 037). Each webhook has
// a signing secret; every request carries X-Kestrel-Signature: t=<time>,v1=<HMAC-SHA256 of "time.body">.
const EVENTS: [string, string][] = [["reply.received", "Reply received"], ["lead.stage_changed", "Lead status changed"], ["lead.unsubscribed", "Unsubscribed"],
  ["email.bounced", "Email bounced"], ["email.sent", "Email sent"]];
type Hook = { id: string; url: string; events: string[]; active: boolean; last_status: number | null; last_error: string | null; last_at: string | null };
const DEMO: Hook[] = [{ id: "d1", url: "https://hooks.zapier.com/hooks/catch/123/abc", events: ["reply.received", "lead.stage_changed"], active: true, last_status: 200, last_error: null, last_at: new Date().toISOString() }];
const HELP = "Send Kestrel events to Zapier, Make, n8n or your own server, for example to add interested leads to a Google Sheet or post replies in Slack. Kestrel sends a JSON POST to your https address for each event you choose, signed with the webhook's secret (header X-Kestrel-Signature: t=time,v1=HMAC-SHA256 of \"time.body\"). Failed deliveries are tried again 5 times over about 30 minutes.";

export default function Webhooks({ manage, demo, toast }: { manage: boolean; demo: boolean; toast: (t: string) => void }) {
  const [hooks, setHooks] = useState<Hook[] | null>(null);
  const [missing, setMissing] = useState(false);
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>(["reply.received", "lead.stage_changed"]);
  const [busy, setBusy] = useState("");
  const [secret, setSecret] = useState<{ id: string; value: string } | null>(null);

  const load = useCallback(async () => {
    if (demo) { setHooks(DEMO); return; }
    const { data, error } = await supabaseBrowser().from("team_webhooks").select("id,url,events,active,last_status,last_error,last_at").order("created_at");
    setMissing(Boolean(error)); setHooks((data as Hook[] | null) ?? []);
  }, [demo]);
  useEffect(() => { Promise.resolve().then(load); }, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!/^https:\/\/[^\s<>"]+$/.test(url.trim())) { toast("The address must start with https://"); return; }
    if (!events.length) { toast("Choose at least one event."); return; }
    if (demo) { toast("Adding needs a signed-in team."); return; }
    setBusy("add");
    const { error } = await supabaseBrowser().rpc("save_webhook", { hook_id: null, url: url.trim(), events, active: true });
    setBusy("");
    if (error) { toast(/save_webhook|schema cache/i.test(error.message) ? "Webhooks are coming soon to your workspace." : error.message); return; }
    setUrl(""); toast("Webhook added. Send a test to check it."); load();
  }
  async function test(h: Hook) {
    if (demo) { toast("Testing needs a signed-in team."); return; }
    setBusy(`t:${h.id}`);
    const r = await fetch("/api/integrations/test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: h.id }) })
      .then((x) => x.json()).catch(() => ({ error: "No connection." })) as { ok?: boolean; note?: string; error?: string };
    setBusy(""); toast(r.error ?? r.note ?? "Done."); load();
  }
  async function toggle(h: Hook) {
    if (demo) return;
    const { error } = await supabaseBrowser().rpc("save_webhook", { hook_id: h.id, url: h.url, events: h.events, active: !h.active });
    if (error) toast(error.message); else load();
  }
  async function remove(h: Hook) {
    if (demo || !await askConfirm(`Remove the webhook to ${h.url}? Events stop being sent there.`)) return;
    const { error } = await supabaseBrowser().rpc("remove_webhook", { hook_id: h.id });
    if (error) toast(error.message); else { toast("Removed."); load(); }
  }
  async function showSecret(h: Hook) {
    if (secret?.id === h.id) { setSecret(null); return; }
    if (demo) { setSecret({ id: h.id, value: "whsec_example_only" }); return; }
    const { data, error } = await supabaseBrowser().rpc("webhook_secret", { hook_id: h.id });
    if (error) toast(error.message); else setSecret({ id: h.id, value: String(data ?? "") });
  }

  return (
    <section className="cn-sec">
      <div className="cn-sec-h"><h2>Webhooks</h2><Tip text={HELP} /></div>
      {missing ? <p className="plan-msg">Webhooks are coming soon to your workspace.</p> : null}
      {!manage && !demo ? <p className="dr-muted">Only the owner or a manager can see and change webhooks (their addresses work like passwords).</p> : null}
      {hooks?.length ? (
        <div className="table-card members acct-table"><table className="leads">
          <thead><tr><th>Address</th><th>Events</th><th>Last delivery</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{hooks.map((h) => (
            <tr key={h.id}>
              <td><b className="wh-url">{h.url}</b>{!h.active ? <small className="muted-line">Paused</small> : null}
                {secret?.id === h.id ? <small className="muted-line wh-secret">Signing secret: <code>{secret.value}</code></small> : null}</td>
              <td>{h.events.map((e) => EVENTS.find((x) => x[0] === e)?.[1] ?? e).join(", ")}</td>
              <td>{h.last_at ? <em className={`pill ${h.last_error ? "no" : "good"}`}>{h.last_error ? `Failed${h.last_status ? ` (${h.last_status})` : ""}` : `OK (${h.last_status})`}</em> : "Not yet"}
                {h.last_error ? <small className="muted-line">{h.last_error}</small> : null}</td>
              <td className="pl-actions">{manage ? <>
                <button type="button" className="btn glass small" disabled={busy === `t:${h.id}`} onClick={() => test(h)}>{busy === `t:${h.id}` ? "Sending…" : "Send test"}</button>
                <button type="button" className="link-btn" onClick={() => showSecret(h)}>{secret?.id === h.id ? "Hide secret" : "Secret"}</button>
                <button type="button" className="link-btn" onClick={() => toggle(h)}>{h.active ? "Pause" : "Resume"}</button>
                <button type="button" className="link-btn danger" onClick={() => remove(h)}>Remove</button>
              </> : null}</td>
            </tr>
          ))}</tbody>
        </table></div>
      ) : null}
      {manage && (hooks?.length ?? 0) < 5 ? (
        <form className="join-card wh-form" onSubmit={add}>
          <label className="in"><span>Webhook address <Tip text="In Zapier: Webhooks by Zapier → Catch Hook → copy the URL. In Make: Webhooks → Custom webhook → copy the address. In n8n: Webhook node → Production URL." /></span>
            <input type="url" aria-label="Webhook address" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://hooks.zapier.com/hooks/catch/…" inputMode="url" /></label>
          <fieldset className="wh-events"><legend>Send these events</legend>
            {EVENTS.map(([id, name]) => (
              <label key={id} className="agree"><input type="checkbox" checked={events.includes(id)} onChange={(e) => setEvents((v) => (e.target.checked ? [...v, id] : v.filter((x) => x !== id)))} /> <span>{name}</span></label>
            ))}
          </fieldset>
          <div className="join-row"><button type="submit" className="btn go small" disabled={busy === "add"}>{busy === "add" ? "Adding…" : "Add webhook"}</button></div>
        </form>
      ) : null}
    </section>
  );
}
