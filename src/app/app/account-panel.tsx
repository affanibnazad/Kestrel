"use client";

import { askConfirm } from "@/components/dialog";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Tip } from "@/components/ui";
import { PROVIDERS, SAFE_DAILY, healthScore, type DnsCheck, type Mailbox, type MailboxToday } from "@/lib/mail";
import SideDrawer from "./side-drawer";
import BlacklistCard, { type Monitor } from "./blacklist-card";

// One email account, opened from the Email accounts table (like the leading tools): Settings · Domain health.
// Warmup was removed on 14 Nov 2026 (archived in Outreach Engine/kestrel-archive/warmup); the slow start stays.
// A new account opens on Settings only. Passwords go straight to the encrypted store and are never shown again.
export type Box = Mailbox & { warmup_started_at: string | null; warmup_override: boolean; ramp_up: boolean; warmup_service?: string | null };
type Form = { id: string | null; provider: string; email: string; from_name: string; username: string; password: string; smtp_host: string; smtp_port: number;
  imap_host: string; imap_port: number; daily_limit: number; signature: string };
const P0 = PROVIDERS[0];
const EMPTY: Form = { id: null, provider: P0.id, email: "", from_name: "", username: "", password: "", smtp_host: P0.smtp[0], smtp_port: P0.smtp[1],
  imap_host: P0.imap[0], imap_port: P0.imap[1], daily_limit: SAFE_DAILY, signature: "" };
export const STATUS: Record<Mailbox["status"], [string, string]> = { new: ["Not tested", "maybe"], ok: ["Ready", "good"], error: ["Problem", "no"], paused: ["Paused", "dnc"] };
const RAMP_HELP = "A new inbox starts at 5 emails a day and adds 2 a day up to its daily limit, so providers see a natural increase.";
const HEALTH_HELP = "Kestrel's own estimate from 0 to 100: a sign-in problem is 0; bounces in the last 7 days and red DNS records take points off. Aim for 90+.";
export type Tab = "settings" | "domain";

export default function AccountPanel({ box, today, dns, monitor, monitorBusy, manage, demo, toast, onClose, onChanged, onCheck, onBlacklist, startTab }: {
  box: Box | null; today?: MailboxToday; dns?: DnsCheck[] | "loading"; monitor?: Monitor; monitorBusy?: boolean; manage: boolean; demo: boolean;
  toast: (t: string) => void; onClose: () => void; onChanged: () => void; onCheck: (domain: string) => void; onBlacklist: (domain: string) => void; startTab?: Tab;
}) {
  const [tab, setTab] = useState<Tab>(box ? startTab ?? "settings" : "settings");
  const [busy, setBusy] = useState("");
  const [form, setForm] = useState<Form>(() => box ? { id: box.id, provider: box.provider, email: box.email, from_name: box.from_name, username: box.username, password: "",
    smtp_host: box.smtp_host, smtp_port: box.smtp_port, imap_host: box.imap_host ?? "", imap_port: box.imap_port ?? 993, daily_limit: box.daily_limit, signature: box.signature } : { ...EMPTY });
  const provider = PROVIDERS.find((p) => p.id === form.provider) ?? PROVIDERS[PROVIDERS.length - 1];
  const domain = box?.email.split("@")[1] ?? "";
  const dnsList = Array.isArray(dns) ? dns : undefined;
  const score = box ? healthScore({ status: box.status, today, dns: dnsList, listed: monitor?.listed }) : null;

  const pickProvider = (id: string) => { const p = PROVIDERS.find((x) => x.id === id)!; setForm((f) => ({ ...f, provider: id, smtp_host: p.smtp[0], smtp_port: p.smtp[1], imap_host: p.imap[0], imap_port: p.imap[1] })); };

  async function test(id: string, send: boolean) {
    if (demo) { toast("Testing needs a signed-in team."); return; }
    setBusy(send ? "send" : "test");
    const r = await fetch("/api/mail/test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, send }) })
      .then((x) => x.json()).catch(() => ({ error: "No connection." })) as { smtp?: boolean; imap?: boolean | null; sent?: boolean; to?: string; problems?: string[]; error?: string };
    setBusy("");
    if (r.error) { toast(r.error); return; }
    toast(r.sent ? `Test email sent to ${r.to}. Check it reached your inbox, not spam.` : r.smtp && r.imap !== false ? "Connected: sending and reading both work." : (r.problems ?? []).join(" ") || "The test did not pass.");
    onChanged();
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const email = form.email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { toast("Type the mailbox's email address."); return; }
    if (!form.id && !form.password) { toast("Add the app password."); return; }
    if (!form.smtp_host.trim()) { toast("Add the SMTP server (ask your provider)."); return; }
    if (demo) { toast("Saving needs a signed-in team."); return; }
    setBusy("save");
    const { data, error } = await supabaseBrowser().rpc("save_mailbox", {
      box_id: form.id, email, from_name: form.from_name, provider: form.provider, smtp_host: form.smtp_host, smtp_port: Number(form.smtp_port),
      imap_host: form.imap_host, imap_port: form.imap_host ? Number(form.imap_port) : null, username: form.username.trim() || email, password: form.password,
      daily_limit: Math.max(1, Math.min(200, Math.round(Number(form.daily_limit) || SAFE_DAILY))), signature: form.signature,
    });
    setBusy("");
    if (error) { toast(/duplicate|unique/i.test(error.message) ? "This mailbox is already connected." : /save_mailbox|schema cache/i.test(error.message) ? "Mailboxes are coming soon to your workspace." : error.message); return; }
    toast("Saved. Testing the connection…");
    setForm((f) => ({ ...f, password: "" }));
    onChanged();
    test(String(data), false);
    if (!box) onClose();
  }
  async function pause() {
    if (!box || demo) { toast("This needs a signed-in team."); return; }
    const { error } = await supabaseBrowser().rpc("pause_mailbox", { box_id: box.id, paused: box.status !== "paused" });
    if (error) toast(error.message); else onChanged();
  }
  async function remove() {
    if (!box || demo || !await askConfirm(`Remove ${box.email} from Kestrel? Its saved password is deleted. Emails already sent are not affected.`)) return;
    const { error } = await supabaseBrowser().rpc("remove_mailbox", { box_id: box.id });
    if (error) toast(error.message); else { toast("Email account removed."); onChanged(); onClose(); }
  }
  // The slow start switch (the database function still has its old name).
  async function setRamp(patch: Partial<Box>) {
    if (!box || demo) { toast("This needs a signed-in team."); return; }
    const n = { ...box, ...patch };
    const { error } = await supabaseBrowser().rpc("set_mailbox_warmup", { box_id: box.id, started: n.warmup_started_at, override: n.warmup_override, ramp: n.ramp_up });
    if (error) toast(error.message); else onChanged();
  }

  return (
    <SideDrawer label={box ? `Email account: ${box.email}` : "Add an email account"} onClose={onClose}>
      <header className="dr-head">
        <div>
          <h2 className="acct-title">{box ? box.email : "Add an email account"}</h2>
          <p>{box ? <><em className={`pill ${STATUS[box.status][1]}`}>{STATUS[box.status][0]}</em>{box.from_name ? ` ${box.from_name}` : ""}</> : "Any provider: Google, Microsoft, Zoho, Hostinger or SMTP/IMAP."}</p>
        </div>
        <button type="button" className="dr-x" aria-label="Close" onClick={onClose}>×</button>
      </header>

      {box ? (
        <>
          <div className="dr-facts acct-facts">
            <div><small>Sent today</small><b>{today ? `${today.sent_24h} / ${today.limit_today}` : "—"}</b></div>
            <div><small>Bounces, 7 days</small><b className={today && today.bounce_rate_7d > 3 ? "dlv-bad" : ""}>{today ? `${today.bounce_rate_7d}%` : "—"}</b></div>
            <div><small>Health <Tip text={HEALTH_HELP} /></small><b className={`health h${score === null ? "x" : score >= 90 ? "g" : score >= 60 ? "m" : "b"}`}>{score === null ? "—" : `${score}%`}</b></div>
          </div>
          {box.last_error ? <p className="dr-dnc mb-err" role="status">{box.last_error}</p> : null}
          {(box.scan_failures ?? 0) >= 3 ? (
            <p className="dr-dnc mb-err" role="status" style={{ background: "rgba(217, 119, 6, 0.12)", color: "var(--warning, #d97706)", borderColor: "rgba(217, 119, 6, 0.3)" }}>
              Can&apos;t read inbox — replies may be missed{box.scan_error ? ` (${box.scan_error})` : ""}
            </p>
          ) : null}
          {manage ? (
            <div className="dr-actions acct-actions">
              <button type="button" className="btn small glass" disabled={Boolean(busy)} onClick={() => test(box.id, false)}>{busy === "test" ? "Testing…" : "Test connection"}</button>
              <button type="button" className="btn small glass" disabled={Boolean(busy) || box.smtp_ok === false} onClick={() => test(box.id, true)}>{busy === "send" ? "Sending…" : "Send test to me"}</button>
              <button type="button" className="btn small glass" onClick={pause}>{box.status === "paused" ? "Resume" : "Pause"}</button>
              <button type="button" className="link-btn danger" onClick={remove}>Remove</button>
            </div>
          ) : null}
          <div className="seg acct-tabs" role="tablist" aria-label="Account sections">
            {([["settings", "Settings"], ["domain", "Domain health"]] as [Tab, string][]).map(([id, name]) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "on" : ""} onClick={() => setTab(id)}>{name}</button>
            ))}
          </div>
        </>
      ) : null}

      {tab === "settings" ? (
        <form className="dr-block acct-form" onSubmit={save}>
          <h3>Sender</h3>
          <label className="in"><span>Provider <Tip text={provider.help} /></span>
            <select value={form.provider} disabled={!manage} onChange={(e) => pickProvider(e.target.value)}>{PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          {!box && form.provider === "google" ? <p className="dr-muted">Easier for Gmail and Google Workspace: close this and click <b>Sign in with Google</b> on the Email accounts page (no app password), when your workspace shows that button.</p> : null}
          <label className="in"><span>Email address</span><input type="email" value={form.email} disabled={!manage || Boolean(box)} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="alex@yourstudio-mail.com" autoComplete="off" required /></label>
          <label className="in"><span>Sender name <Tip text="What people see in their inbox." /></span><input value={form.from_name} disabled={!manage} onChange={(e) => setForm({ ...form, from_name: e.target.value })} placeholder="Alex from Northlight" maxLength={80} /></label>
          <label className="in"><span>App password <Tip text={box ? "Leave empty to keep the saved one." : "Not your normal password: an app password from your email provider."} /></span>
            <input type="password" value={form.password} disabled={!manage} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" placeholder={box ? "••••••••" : "Paste the app password"} /></label>
          <label className="in"><span>Signature <Tip text="Added under every email from this account." /></span><textarea rows={3} value={form.signature} disabled={!manage} onChange={(e) => setForm({ ...form, signature: e.target.value })} placeholder={"Alex Example\nNorthlight Studio"} maxLength={2000} /></label>

          <h3>Sending limit</h3>
          <label className="in"><span>Emails a day <Tip text={`Best practice is ${SAFE_DAILY} a day per inbox, follow-ups included. More raises the risk of spam folders and blocked inboxes.`} /></span>
            <input type="number" min={1} max={200} value={form.daily_limit} disabled={!manage} onChange={(e) => setForm({ ...form, daily_limit: Number(e.target.value) })} />
            {form.daily_limit > SAFE_DAILY ? <em className="rules-warn">Above {SAFE_DAILY} a day raises the spam risk.</em> : null}
            {!box ? <small className="muted-line">New accounts start slowly: 5 emails on the first day, then 2 more each day until they reach this number.</small> : null}</label>
          {box ? <>
            <label className="agree"><input type="checkbox" checked={box.ramp_up} disabled={!manage} onChange={(e) => setRamp({ ramp_up: e.target.checked })} /> <span>Slow start: 5 a day, then 2 more each day <Tip text={RAMP_HELP} /></span></label>
            <p className="dr-muted">Today&apos;s limit: {today ? `${today.limit_today} of ${box.daily_limit}` : box.daily_limit}{today && box.ramp_up && today.limit_today < box.daily_limit ? ` (slow start: +2 a day, ${box.daily_limit} a day in about ${Math.ceil((box.daily_limit - today.limit_today) / 2)} days)` : ""}. Auto-pause when bounces pass 3% in 7 days.</p>
          </> : null}

          <details className="mb-adv" open={form.provider === "other"}>
            <summary>Server settings (SMTP / IMAP)</summary>
            <div className="filters-grid two">
              <label className="in"><span>SMTP server</span><input value={form.smtp_host} disabled={!manage} onChange={(e) => setForm({ ...form, smtp_host: e.target.value })} placeholder="smtp.example.com" /></label>
              <label className="in"><span>SMTP port</span><select value={form.smtp_port} disabled={!manage} onChange={(e) => setForm({ ...form, smtp_port: Number(e.target.value) })}><option value={465}>465 (SSL)</option><option value={587}>587 (STARTTLS)</option><option value={2525}>2525</option><option value={25}>25</option></select></label>
              <label className="in"><span>IMAP server <Tip text="Used to read replies." /></span><input value={form.imap_host} disabled={!manage} onChange={(e) => setForm({ ...form, imap_host: e.target.value })} placeholder="imap.example.com" /></label>
              <label className="in"><span>IMAP port</span><select value={form.imap_port} disabled={!manage} onChange={(e) => setForm({ ...form, imap_port: Number(e.target.value) })}><option value={993}>993 (SSL)</option><option value={143}>143</option></select></label>
              <label className="in"><span>Username <Tip text="Usually the email address." /></span><input value={form.username} disabled={!manage} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder={form.email || "same as the email"} autoComplete="off" /></label>
            </div>
          </details>
          {box ? <p className="dr-muted acct-tested">Last tested: {box.tested_at ? new Date(box.tested_at).toLocaleString() : "never"} · Sending {box.smtp_ok === null ? "not tested" : box.smtp_ok ? "works" : "failed"} · Reading {!box.imap_host ? "not set" : box.imap_ok === null ? "not tested" : box.imap_ok ? "works" : "failed"}</p> : null}
          {manage ? <div className="join-row"><button className="btn go" type="submit" disabled={Boolean(busy)}>{busy === "save" ? "Saving…" : box ? "Save and test" : "Connect and test"}</button></div>
            : <p className="plan-msg">Only the owner or a manager can change email accounts.</p>}
        </form>
      ) : null}

      {box && tab === "domain" ? (
        <section className="dr-block">
          <div className="dr-row"><h3>{domain}</h3>
            <button type="button" className="btn small glass" disabled={dns === "loading"} onClick={() => onCheck(domain)}>{dns === "loading" ? "Checking…" : dns ? "Check again" : "Check"}</button></div>
          {dnsList ? <ul className="trk-result">{dnsList.map((x) => (
            <li key={x.name} className={x.ok === true ? "ok" : x.ok === false ? "bad" : ""}>{x.ok === true ? "✓" : x.ok === false ? "✗" : "•"} <b>{x.name}</b>: {x.detail}{x.ok === false && x.fix ? <small className="muted-line">{x.fix}</small> : null}</li>
          ))}</ul> : <p className="dr-muted">Checks MX, SPF, DKIM and DMARC for this domain.</p>}
          <BlacklistCard domain={domain} monitor={monitor} busy={Boolean(monitorBusy)} manage={manage} onCheck={onBlacklist} />
        </section>
      ) : null}
    </SideDrawer>
  );
}
