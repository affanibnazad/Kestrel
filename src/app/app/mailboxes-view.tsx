"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Tip } from "@/components/ui";
import { MAILBOX_COLUMNS, healthScore, type DnsCheck, type MailboxToday } from "@/lib/mail";
import AccountPanel, { STATUS, type Box } from "./account-panel";
import SideDrawer from "./side-drawer";
import { BizAvatar } from "./biz";
import TrackingCard from "./tracking-card";
import type { Monitor } from "./blacklist-card";

// Mail → Email accounts, organised like the leading tools: one table (status, sent today, health, limit);
// click an account for its panel (Settings · Domain health). Warmup was removed on 14 Nov 2026 (archived). Domain checks run by themselves when the page opens.
type Acct = { team_id: string; role: string } | null;
type Filter = "all" | "ok" | "error" | "paused";
const COLUMNS_074 = `${MAILBOX_COLUMNS},warmup_started_at,warmup_override,ramp_up,scan_failures,scan_error`;
const COLUMNS_FALLBACK = `${MAILBOX_COLUMNS},warmup_started_at,warmup_override,ramp_up`;
const now = () => new Date().toISOString();
const DEMO: Box[] = [
  { id: "demo-1", email: "alex@northlight-studio.test", from_name: "Alex Example", provider: "google", smtp_host: "smtp.gmail.com", smtp_port: 465, imap_host: "imap.gmail.com", imap_port: 993,
    username: "alex@northlight-studio.test", daily_limit: 25, signature: "Alex Example\nNorthlight Studio", status: "ok", last_error: null, smtp_ok: true, imap_ok: true, tested_at: now(), created_at: now(),
    warmup_started_at: "2026-10-20", warmup_override: false, ramp_up: true },
  { id: "demo-2", email: "sam@northlight-mail.test", from_name: "Sam Example", provider: "zoho", smtp_host: "smtp.zoho.com", smtp_port: 465, imap_host: "imap.zoho.com", imap_port: 993,
    username: "sam@northlight-mail.test", daily_limit: 25, signature: "Sam Example\nNorthlight Studio", status: "ok", last_error: null, smtp_ok: true, imap_ok: true, tested_at: now(), created_at: now(),
    warmup_started_at: new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10), warmup_override: false, ramp_up: true },
];
const DEMO_TODAY: Record<string, MailboxToday> = {
  "demo-1": { id: "demo-1", warm: true, limit_today: 25, sent_24h: 18, bounce_rate_7d: 0.8 },
  "demo-2": { id: "demo-2", warm: true, limit_today: 13, sent_24h: 0, bounce_rate_7d: 0 },
};
const DEMO_DNS: DnsCheck[] = [{ name: "MX", ok: true, detail: "Mail server found" }, { name: "SPF", ok: true, detail: "v=spf1 include:_spf.google.com ~all" },
  { name: "DKIM", ok: true, detail: "Found at google._domainkey" }, { name: "DMARC", ok: false, detail: "No DMARC record", fix: "Add a TXT record at _dmarc with v=DMARC1; p=none" }];
const demoMonitor = (domain: string, ip: boolean): Monitor => ({ domain, listed: false, age_days: ip ? 9 : 412, registered: ip ? null : "2025-09-27T10:00:00Z", checked_at: now(),
  lists: [{ name: "Spamhaus DBL", kind: "domain", target: domain, status: "clean" }, { name: "SURBL", kind: "domain", target: domain, status: "clean" }, { name: "URIBL", kind: "domain", target: domain, status: ip ? "unknown" : "clean" }],
  server: { host: ip ? "smtp.zoho.com" : "smtp.gmail.com", ip: null, ptr: null, shared: true } });

export default function MailboxesView({ account, demo, toast }: { account: Acct; demo: boolean; toast: (t: string) => void }) {
  const [boxes, setBoxes] = useState<Box[] | null>(null);
  const [today, setToday] = useState<Record<string, MailboxToday>>({});
  const [dns, setDns] = useState<Record<string, DnsCheck[] | "loading">>({});
  const [open, setOpen] = useState<string | null>(null);   // an account id, "new" or "tracking"
  const [startTab, setStartTab] = useState<"domain" | undefined>(undefined);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [missing, setMissing] = useState(false);
  const [mon, setMon] = useState<Record<string, Monitor>>({});   // Spam Guard B: last blacklist check per domain
  const [monBusy, setMonBusy] = useState("");
  const manage = Boolean(account && ["owner", "manager"].includes(account.role));
  // Sign in with Google (database 048): shown when Kestrel's Google client is set up (Owner → Google sign-in).
  const [google, setGoogle] = useState(false);
  useEffect(() => {
    if (demo || !account) { Promise.resolve().then(() => setGoogle(true)); return; }
    supabaseBrowser().rpc("google_mail_ready").then(({ data }) => setGoogle(data === true));
  }, [account, demo]);
  // Back from Google: say what happened, then take the note out of the address bar.
  useEffect(() => {
    const code = new URLSearchParams(location.search).get("google");
    if (!code) return;
    const said: Record<string, string> = {
      ok: "Gmail connected. Sending and reading replies both work.",
      tested: "Gmail connected, but a test failed. Open the account to see why (often: turn on IMAP in Gmail settings).",
      cancelled: "Google sign-in was cancelled. Nothing was changed.",
      scope: "Kestrel needs the box \u201cRead, compose, send and delete your email\u201d ticked on Google's page. Try again and tick it.",
      refresh: "Google did not give Kestrel lasting access. Remove Kestrel at myaccount.google.com/permissions, then sign in again.",
      expired: "That sign-in took too long or was started elsewhere. Click Sign in with Google again.",
      role: "Only the owner or a manager can add email accounts.",
      setup: "Sign in with Google is not set up on Kestrel yet. Use an app password for now.",
      client: "Kestrel's Google settings are wrong (Owner → Google sign-in).",
      save: "Google signed you in, but the account could not be saved. Try again.",
      failed: "Google sign-in did not finish. Try again.",
    };
    Promise.resolve().then(() => { toast(said[code] ?? said.failed); history.replaceState(null, "", "/app?view=mailboxes"); });
  }, [toast]);

  const load = useCallback(async () => {
    if (demo || !account) {
      setBoxes(DEMO); setToday(DEMO_TODAY);
      setMon({ "northlight-studio.test": demoMonitor("northlight-studio.test", false), "northlight-mail.test": demoMonitor("northlight-mail.test", true) });
      return;
    }
    const sb = supabaseBrowser();
    const boxQ = (cols: string) => sb.from("mailboxes").select(cols).eq("team_id", account.team_id).order("created_at");
    const [bRes, t, m] = await Promise.all([
      boxQ(COLUMNS_074).then(async (res) => {
        if (res.error && /scan_failures|scan_error/i.test(res.error.message)) {
          return await boxQ(COLUMNS_FALLBACK);
        }
        return res;
      }),
      sb.rpc("mailbox_today"),
      sb.from("domain_monitor").select("domain,results").eq("team_id", account.team_id),
    ]);
    const b = bRes;
    setMon(Object.fromEntries(((m.data as { domain: string; results: Monitor }[] | null) ?? []).filter((r) => r.results?.lists).map((r) => [r.domain, r.results])));
    if (b.error) setMissing(true);
    setBoxes((b.data as Box[] | null) ?? []);
    setToday(Object.fromEntries(((t.data as MailboxToday[] | null) ?? []).map((x) => [x.id, x])));
  }, [account, demo]);
  useEffect(() => { Promise.resolve().then(load); }, [load]);

  const check = useCallback(async (domain: string) => {
    if (demo) { setDns((c) => ({ ...c, [domain]: DEMO_DNS })); return; }
    setDns((c) => ({ ...c, [domain]: "loading" }));
    const r = await fetch(`/api/mail/domain-check?domain=${encodeURIComponent(domain)}`).then((x) => x.json()).catch(() => ({ error: "No connection." })) as { checks?: DnsCheck[]; error?: string };
    if (r.error) { toast(r.error); setDns((c) => { const n = { ...c }; delete n[domain]; return n; }); return; }
    setDns((c) => ({ ...c, [domain]: r.checks ?? [] }));
  }, [demo, toast]);

  const blacklist = useCallback(async (domain: string) => {
    if (demo) { toast("Checking blacklists needs a signed-in team. The preview shows example results."); return; }
    setMonBusy(domain);
    const r = await fetch("/api/mail/blacklist", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ domain }) })
      .then((x) => x.json()).catch(() => ({ error: "No connection." })) as Monitor & { error?: string };
    setMonBusy("");
    if (r.error) { toast(r.error); return; }
    setMon((c) => ({ ...c, [domain]: r }));
    toast(r.listed ? `${domain} is on a blacklist. Its email accounts are paused.` : r.cached ? "Checked a few minutes ago: no change." : "Blacklist check done.");
    if (r.listed) load();
  }, [demo, toast, load]);

  // Like the leading tools: every sending domain is checked by itself when the page opens (DNS lookups only).
  const domains = useMemo(() => [...new Set((boxes ?? []).map((b) => b.email.split("@")[1]))], [boxes]);
  const [autoChecked, setAutoChecked] = useState(false);
  useEffect(() => {
    if (autoChecked || !domains.length) return;
    Promise.resolve().then(() => { setAutoChecked(true); domains.forEach((d) => check(d)); });
  }, [domains, autoChecked, check]);

  const list = boxes ?? [];
  const dnsOf = (b: Box) => { const d = dns[b.email.split("@")[1]]; return Array.isArray(d) ? d : undefined; };
  const shown = list.filter((b) => {
    if (q && !`${b.email} ${b.from_name}`.toLowerCase().includes(q.trim().toLowerCase())) return false;
    return filter === "all" || b.status === filter;
  });
  const ready = list.filter((b) => b.status === "ok");
  const capacity = list.filter((b) => b.status === "ok").reduce((n, b) => n + (today[b.id]?.limit_today ?? b.daily_limit), 0);
  const sentToday = Object.values(today).reduce((n, t) => n + t.sent_24h, 0);
  const current = list.find((b) => b.id === open) ?? null;
  const listed = Object.values(mon).filter((x) => x.listed).map((x) => x.domain);

  return (
    <div className="app-page">
      <header className="head">
        <div>
          <h1>Email accounts <Tip text="The inboxes your team sends cold email from. Use look-alike domains, never your main domain, and start each new inbox slowly (5 a day, then 2 more each day). Kestrel sends through each inbox's own server, so emails really come from that inbox." /></h1>
          <span className="sub">{list.length} accounts · {ready.length} ready · {sentToday.toLocaleString()} of {capacity.toLocaleString()} sent in the last 24 hours</span>
        </div>
        <div className="head-actions">
          <button type="button" className="btn glass small" onClick={() => setOpen("tracking")}>Tracking domain</button>
          {manage && google ? (
            <a className="btn glass small g-signin" href={demo ? undefined : "/api/mail/oauth/google/start"} onClick={(e) => { if (demo) { e.preventDefault(); toast("In your own team this opens Google's sign-in page (example)."); } }}>
              <svg viewBox="0 0 24 24" aria-hidden="true" width="16" height="16"><path fill="#4285F4" d="M22.6 12.3c0-.8-.1-1.5-.2-2.3H12v4.4h6a5.1 5.1 0 0 1-2.2 3.3v2.7h3.6c2-1.9 3.2-4.7 3.2-8.1z"/><path fill="#34A853" d="M12 23c3 0 5.5-1 7.3-2.7l-3.6-2.7c-1 .7-2.2 1.1-3.7 1.1-2.9 0-5.3-1.9-6.2-4.5H2.1v2.8A11 11 0 0 0 12 23z"/><path fill="#FBBC05" d="M5.8 14.2a6.6 6.6 0 0 1 0-4.3V7.1H2.1a11 11 0 0 0 0 9.9z"/><path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.2-3.2A11 11 0 0 0 2.1 7.1l3.7 2.8C6.7 7.3 9.1 5.4 12 5.4z"/></svg>
              Sign in with Google <Tip text="Connect a Gmail or Google Workspace account in one click: no app password. Kestrel sends your campaign emails through it and reads its inbox for replies. Remove access any time at myaccount.google.com/permissions." />
            </a>
          ) : null}
          {manage ? <button type="button" className="btn go small" onClick={() => setOpen("new")}>Add new</button> : null}
        </div>
      </header>
      {missing ? <p className="plan-msg">Email accounts are coming soon to your workspace.</p> : null}
      {listed.length ? (
        <p className="bl-banner" role="alert">✗ {listed.join(", ")} {listed.length > 1 ? "are" : "is"} on a blacklist, so Kestrel paused {listed.length > 1 ? "their" : "its"} email accounts.
          <button type="button" className="link-btn" onClick={() => { const b = list.find((x) => x.email.split("@")[1] === listed[0]); if (b) { setStartTab("domain"); setOpen(b.id); } }}>See what to do</button></p>
      ) : null}

      <div className="acct-bar">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search accounts" aria-label="Search email accounts" />
        <div className="seg" role="group" aria-label="Show">
          {([["all", "All"], ["ok", "Ready"], ["error", "Problem"], ["paused", "Paused"]] as [Filter, string][]).map(([id, name]) => (
            <button key={id} type="button" className={filter === id ? "on" : ""} aria-pressed={filter === id} onClick={() => setFilter(id)}>{name}</button>
          ))}
        </div>
      </div>

      <div className="table-card members acct-table">
        <table className="leads">
          <thead><tr><th>Email</th><th>Status</th><th>Sent today</th><th>Health <Tip text="Kestrel's own estimate from bounces (7 days) and the domain's DNS records. Aim for 90+." /></th><th>Daily limit</th></tr></thead>
          <tbody>{shown.map((b) => {
            const t = today[b.id], score = healthScore({ status: b.status, today: t, dns: dnsOf(b), listed: mon[b.email.split("@")[1]]?.listed });
            return (
              <tr key={b.id} className="acct-row" onClick={() => setOpen(b.id)}>
                <td><button type="button" className="acct-open biz" onClick={(e) => { e.stopPropagation(); setOpen(b.id); }}><BizAvatar name={b.from_name || b.email} /><span className="biz-txt"><b>{b.email}</b>{b.from_name ? <small>{b.from_name}</small> : null}</span></button></td>
                <td>
                  <em className={`pill ${STATUS[b.status][1]}`}>{STATUS[b.status][0]}</em>
                  {(b.scan_failures ?? 0) >= 3 ? (
                    <span className="pill warn" style={{ marginLeft: 6 }} title={b.scan_error || "Can't read inbox"}>
                      Can&apos;t read inbox — replies may be missed
                    </span>
                  ) : null}
                </td>
                <td>{t ? <span className="acct-sent"><span className="acct-meter" aria-hidden="true"><i style={{ width: `${Math.min(100, (t.sent_24h / Math.max(1, t.limit_today)) * 100)}%` }} /></span>{t.sent_24h} / {t.limit_today}</span> : "—"}</td>
                <td><b className={`health h${score === null ? "x" : score >= 90 ? "g" : score >= 60 ? "m" : "b"}`}>{score === null ? "—" : `${score}%`}</b></td>
                <td>{b.daily_limit}</td>
              </tr>
            );
          })}</tbody>
        </table>
        {boxes && !list.length ? <div className="empty"><div><b>No email accounts yet</b><Tip text="Gmail and Google Workspace: Sign in with Google is easiest. Other providers: the inbox's email address and an app password. Start with one inbox and send a test to yourself." />{manage ? <button type="button" className="btn go small" onClick={() => setOpen("new")}>Add your first email account</button> : null}</div></div> : null}
        {list.length && !shown.length ? <div className="empty"><div><b>No accounts match</b></div></div> : null}
      </div>

      {open === "tracking" ? (
        <SideDrawer label="Tracking domain" onClose={() => setOpen(null)}>
          <header className="dr-head"><div><h2>Tracking domain</h2><p>For the whole team</p></div><button type="button" className="dr-x" aria-label="Close" onClick={() => setOpen(null)}>×</button></header>
          <TrackingCard manage={manage} demo={demo} toast={toast} />
        </SideDrawer>
      ) : open === "new" || current ? (
        <AccountPanel key={open} box={current} today={current ? today[current.id] : undefined} dns={current ? dns[current.email.split("@")[1]] : undefined}
          monitor={current ? mon[current.email.split("@")[1]] : undefined} monitorBusy={Boolean(current && monBusy === current.email.split("@")[1])} onBlacklist={blacklist}
          manage={manage} demo={demo} toast={toast} onClose={() => { setOpen(null); setStartTab(undefined); }} onChanged={load} onCheck={check} startTab={startTab} />
      ) : null}
    </div>
  );
}
