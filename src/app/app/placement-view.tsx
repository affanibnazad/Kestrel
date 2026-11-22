"use client";

import { askConfirm } from "@/components/dialog";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Tip } from "@/components/ui";
import { renderStep, type Step } from "@/lib/sequence";
import { scoreEmail } from "@/lib/spamguard";
import { PLACEMENT, SEED_PROVIDERS, TEST_STATUS, advice, seedProvider, summarize, type PlacementResult, type PlacementTest, type Seed } from "@/lib/placement";
import SideDrawer from "./side-drawer";
import { ScoreBadge } from "./spam-check";

// Mail → Inbox placement (Spam Guard C), like Smartlead SmartDelivery and Instantly placement tests: connect 2–6 test inboxes you
// own, send your real email from your accounts to them, and see where it landed (Inbox, Promotions, Spam). Accounts that land in
// spam are paused by themselves (can be turned off). Optional weekly test.
type Acct = { team_id: string; role: string } | null;
type Box = { id: string; email: string; from_name: string; status: string };
type Settings = { weekly: boolean; auto_pause: boolean };
type Open = { kind: "seed"; seed: Seed | null } | { kind: "new" } | { kind: "test"; id: string } | null;

const HELP = "A placement test sends your real email from your email accounts to test inboxes you own (Gmail, Yahoo, iCloud, Zoho…) and reads where it landed: the main inbox, Gmail's Promotions tab, or spam. Use it before a campaign and every week. Results are a sample: they show trends, not a promise for every lead.";
const SEED_HELP = "Inboxes you own on different providers, only for testing (not your sending accounts). Kestrel only reads them by IMAP; it never sends from them or changes anything. Test connection sends each one short check email from one of your ready email accounts, to confirm the inbox is yours. Add 2–6: at least one Gmail and one Outlook.";
const SAMPLE_PARTS = { first_name: "Sam", subject: "quick question about your reels", icebreaker: "Saw your weekly reels for local cafés, they look great.", question: "Would a few sample edits be useful?", follow_ups: [] };
const ago = (iso: string) => new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

// ---------- preview data
const T0 = new Date(Date.now() - 3 * 86400000).toISOString(), T1 = new Date(Date.now() - 10 * 86400000).toISOString();
const DEMO_SEEDS: Seed[] = [
  { id: "s1", email: "kestrel.test1@gmail.test", provider: "gmail", imap_host: "imap.gmail.com", imap_port: 993, username: "kestrel.test1@gmail.test", status: "ok", last_error: null, tested_at: T0 },
  { id: "s2", email: "kestrel.test2@icloud.test", provider: "icloud", imap_host: "imap.mail.me.com", imap_port: 993, username: "kestrel.test2@icloud.test", status: "ok", last_error: null, tested_at: T0 },
  { id: "s3", email: "kestrel.test3@yahoo.test", provider: "yahoo", imap_host: "imap.mail.yahoo.com", imap_port: 993, username: "kestrel.test3@yahoo.test", status: "error", last_error: "Sign-in refused: check the address and app password.", tested_at: T0 },
];
const DEMO_BOXES: Box[] = [{ id: "b1", email: "alex@northlight-studio.test", from_name: "Alex Example", status: "ok" }, { id: "b2", email: "sam@northlight-mail.test", from_name: "Sam Example", status: "ok" }];
const DEMO_TESTS: PlacementTest[] = [
  { id: "t1", created_at: T0, status: "done", scheduled: true, subject: "quick question about your reels", body: "", finished_at: T0, total: 4, inbox: 2, promotions: 1, spam: 1, missing: 0, paused: 0 },
  { id: "t2", created_at: T1, status: "done", scheduled: false, subject: "video edits for Harbour Social", body: "", finished_at: T1, total: 4, inbox: 3, promotions: 1, spam: 0, missing: 0, paused: 0 },
];
const dr = (id: string, test: string, box: Box, seed: Seed, state: PlacementResult["state"], folder: string | null): PlacementResult =>
  ({ id, test_id: test, mailbox_id: box.id, seed_id: seed.id, from_email: box.email, seed_email: seed.email, seed_provider: seed.provider, state, folder, detail: null });
const DEMO_RESULTS: PlacementResult[] = [
  dr("r1", "t1", DEMO_BOXES[0], DEMO_SEEDS[0], "inbox", "INBOX"), dr("r2", "t1", DEMO_BOXES[0], DEMO_SEEDS[1], "inbox", "INBOX"),
  dr("r3", "t1", DEMO_BOXES[1], DEMO_SEEDS[0], "promotions", "INBOX"), dr("r4", "t1", DEMO_BOXES[1], DEMO_SEEDS[1], "spam", "Junk"),
  dr("r5", "t2", DEMO_BOXES[0], DEMO_SEEDS[0], "inbox", "INBOX"), dr("r6", "t2", DEMO_BOXES[0], DEMO_SEEDS[1], "inbox", "INBOX"),
  dr("r7", "t2", DEMO_BOXES[1], DEMO_SEEDS[0], "promotions", "INBOX"), dr("r8", "t2", DEMO_BOXES[1], DEMO_SEEDS[1], "inbox", "INBOX"),
];

const pctOf = (n: number, t: number) => (t ? `${Math.round((n / t) * 100)}%` : "—");

export default function PlacementView({ account, demo, toast, go }: { account: Acct; demo: boolean; toast: (t: string) => void; go: (v: string) => void }) {
  const [seeds, setSeeds] = useState<Seed[] | null>(null);
  const [tests, setTests] = useState<PlacementTest[]>([]);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [settings, setSettings] = useState<Settings>({ weekly: false, auto_pause: true });
  const [missing, setMissing] = useState(false);
  const [open, setOpen] = useState<Open>(null);
  const [busy, setBusy] = useState("");
  const manage = demo || Boolean(account && ["owner", "manager"].includes(account.role));

  const load = useCallback(async () => {
    if (demo) { setSeeds(DEMO_SEEDS); setTests(DEMO_TESTS); setBoxes(DEMO_BOXES); setSettings({ weekly: true, auto_pause: true }); return; }
    if (!account) return;   // signed in, account still loading: never show example data
    const sb = supabaseBrowser();
    const [s, t, b, st] = await Promise.all([
      sb.from("seed_inboxes").select("id,email,provider,imap_host,imap_port,username,status,last_error,tested_at").eq("team_id", account.team_id).order("created_at"),
      sb.from("placement_tests").select("*").eq("team_id", account.team_id).order("created_at", { ascending: false }).limit(30),
      sb.from("mailboxes").select("id,email,from_name,status").eq("team_id", account.team_id).order("created_at"),
      sb.from("placement_settings").select("weekly,auto_pause").eq("team_id", account.team_id).maybeSingle(),
    ]);
    setMissing(Boolean(s.error));
    setSeeds((s.data as Seed[] | null) ?? []);
    setTests((t.data as PlacementTest[] | null) ?? []);
    setBoxes((b.data as Box[] | null) ?? []);
    if (st.data) setSettings(st.data as Settings);
  }, [account, demo]);
  useEffect(() => { Promise.resolve().then(load); }, [load]);

  // While a test runs, refresh every 15 seconds.
  const running = tests.some((t) => t.status === "sending" || t.status === "checking");
  useEffect(() => {
    if (!running || demo) return;
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, [running, demo, load]);

  async function testSeed(id: string) {
    if (demo) { toast("Testing needs a signed-in team."); return; }
    setBusy(`t:${id}`);
    const r = await fetch("/api/mail/seed-test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) })
      .then((x) => x.json()).catch(() => ({ error: "No connection." })) as { ok?: boolean; problem?: string; error?: string };
    setBusy("");
    toast(r.error ?? (r.ok ? (r.problem || "Connected and confirmed.") : r.problem || "The test did not pass."));
    load();
  }
  async function removeSeed(s: Seed) {
    if (demo) { toast("Removing needs a signed-in team."); return; }
    if (!await askConfirm(`Remove ${s.email} from test inboxes? Kestrel forgets its password.`)) return;
    const { error } = await supabaseBrowser().rpc("remove_seed_inbox", { seed_id: s.id });
    toast(error ? error.message : "Removed."); load();
  }
  async function saveSettings(next: Settings) {
    if (demo) { setSettings(next); return; }
    const { error } = await supabaseBrowser().rpc("set_placement_settings", { weekly: next.weekly, auto_pause: next.auto_pause });
    if (error) { toast(error.message); return; }
    setSettings(next); toast("Saved.");
  }

  const okSeeds = (seeds ?? []).filter((s) => s.status === "ok");
  const last = tests.find((t) => t.status === "done" && t.total > 0);
  const lastDone = last?.total ?? 0;

  return (
    <div className="app-page">
      <header className="head">
        <div>
          <h1>Deliverability <Tip text={HELP} /></h1>
          <span className="sub">{okSeeds.length} test inboxes ready · {tests.length} tests{running ? " · a test is running" : ""}</span>
        </div>
        <div className="head-actions">
          <button type="button" className="btn glass small" title="Score any email for spam words, links and layout, and fix it with AI"
            onClick={() => window.dispatchEvent(new CustomEvent("kestrel-spam-check", { detail: { subject: "", body: "" } }))}>Spam check</button>
          {manage ? <button type="button" className="btn glass small" onClick={() => setOpen({ kind: "seed", seed: null })}>Add test inbox</button> : null}
          {manage ? <button type="button" className="btn go small" disabled={running} onClick={() => setOpen({ kind: "new" })}>New test</button> : null}
        </div>
      </header>
      {missing ? <p className="plan-msg">Placement tests are coming soon to your workspace.</p> : null}

      {last ? (
        <div className="kpis">
          <div><small>Inbox <Tip text="Main inbox, last finished test." /></small><b className="pl-good">{pctOf(last.inbox, lastDone)}</b></div>
          <div><small>Promotions <Tip text="Gmail's Promotions tab. Not spam, but read less." /></small><b>{pctOf(last.promotions, lastDone)}</b></div>
          <div><small>Spam</small><b className={last.spam ? "dlv-bad" : ""}>{pctOf(last.spam, lastDone)}</b></div>
          <div><small>Not arrived <Tip text="Not found in Inbox or Spam after 20 minutes, or could not be sent. Often a blocked or broken account." /></small><b className={last.missing ? "dlv-bad" : ""}>{pctOf(last.missing, lastDone)}</b></div>
          <div><small>Last test</small><b className="pl-date">{ago(last.created_at)}</b></div>
        </div>
      ) : null}

      <h2 className="an-h">Tests</h2>
      <div className="table-card members acct-table">
        <table className="leads">
          <thead><tr><th>Date</th><th>Subject</th><th>Emails</th><th>Inbox</th><th>Promotions</th><th>Spam</th><th>Not arrived</th><th>Status</th></tr></thead>
          <tbody>{tests.map((t) => (
            <tr key={t.id} className="acct-row" onClick={() => setOpen({ kind: "test", id: t.id })}>
              <td><button type="button" className="link-btn" onClick={(e) => { e.stopPropagation(); setOpen({ kind: "test", id: t.id }); }}>{ago(t.created_at)}</button>{t.scheduled ? <small className="muted-line">Weekly</small> : null}</td>
              <td>{t.subject}</td><td>{t.total}</td>
              <td>{t.status === "done" ? pctOf(t.inbox, t.total) : "—"}</td><td>{t.status === "done" ? pctOf(t.promotions, t.total) : "—"}</td>
              <td className={t.spam ? "dlv-bad" : ""}>{t.status === "done" ? pctOf(t.spam, t.total) : "—"}</td><td>{t.status === "done" ? pctOf(t.missing, t.total) : "—"}</td>
              <td><em className={`pill ${t.status === "done" ? "good" : t.status === "cancelled" ? "dnc" : "maybe"}`}>{TEST_STATUS[t.status]}</em>{t.paused ? <small className="muted-line">{t.paused} paused</small> : null}</td>
            </tr>
          ))}</tbody>
        </table>
        {!tests.length ? <div className="empty"><div><b>No tests yet</b><Tip text="Add 2 test inboxes (for example a Gmail and an Outlook address you own), test their connection, then click New test." />{manage ? <button type="button" className="btn go small" onClick={() => setOpen({ kind: "seed", seed: null })}>Add a test inbox</button> : null}</div></div> : null}
      </div>

      <h2 className="an-h">Test inboxes <Tip text={SEED_HELP} /></h2>
      <div className="table-card members acct-table">
        <table className="leads">
          <thead><tr><th>Inbox</th><th>Provider</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{(seeds ?? []).map((s) => (
            <tr key={s.id}>
              <td><b>{s.email}</b>{s.last_error ? <small className="muted-line">{s.last_error}</small> : null}</td>
              <td>{seedProvider(s.provider).name}</td>
              <td><em className={`pill ${s.status === "ok" ? "good" : s.status === "error" ? "no" : "maybe"}`}>{s.status === "ok" ? "Connected" : s.status === "error" ? "Problem" : "Not tested"}</em></td>
              <td className="pl-actions">{manage ? <>
                <button type="button" className="btn glass small" disabled={busy === `t:${s.id}`} onClick={() => testSeed(s.id)}>{busy === `t:${s.id}` ? "Testing…" : "Test connection"}</button>
                <button type="button" className="link-btn" onClick={() => setOpen({ kind: "seed", seed: s })}>Edit</button>
                <button type="button" className="link-btn danger" onClick={() => removeSeed(s)}>Remove</button>
              </> : null}</td>
            </tr>
          ))}</tbody>
        </table>
        {seeds && !seeds.length ? <div className="empty"><div><b>No test inboxes yet</b><Tip text={SEED_HELP} /></div></div> : null}
      </div>

      <h2 className="an-h">Settings</h2>
      <div className="pl-settings">
        <label className="agree"><input type="checkbox" checked={settings.weekly} disabled={!manage} onChange={(e) => saveSettings({ ...settings, weekly: e.target.checked })} />
          <span>Run a test every week <Tip text="Repeats your last test 7 days later with all ready email accounts, so you see problems early." /></span></label>
        <label className="agree"><input type="checkbox" checked={settings.auto_pause} disabled={!manage} onChange={(e) => saveSettings({ ...settings, auto_pause: e.target.checked })} />
          <span>Pause an email account whose emails land in spam <Tip text="When at least 2 of an account's test emails, and at least half of those that arrived, are in spam, Kestrel pauses it so campaigns stop using it. Resume it in Email accounts after fixing." /></span></label>
      </div>

      {open?.kind === "seed" ? <SeedDrawer seed={open.seed} demo={demo} toast={toast} onClose={() => setOpen(null)} onSaved={(id) => { setOpen(null); load().then(() => testSeed(id)); }} /> : null}
      {open?.kind === "new" ? <NewTestDrawer boxes={boxes} seeds={okSeeds} demo={demo} toast={toast} go={go} onClose={() => setOpen(null)} onStarted={(id) => { load(); setOpen({ kind: "test", id }); }} /> : null}
      {open?.kind === "test" ? <ReportDrawer test={tests.find((t) => t.id === open.id) ?? null} id={open.id} demo={demo} manage={manage} toast={toast} onClose={() => setOpen(null)} onChanged={load} /> : null}
    </div>
  );
}

// ---------- add or change a test inbox
function SeedDrawer({ seed, demo, toast, onClose, onSaved }: { seed: Seed | null; demo: boolean; toast: (t: string) => void; onClose: () => void; onSaved: (id: string) => void }) {
  const [provider, setProvider] = useState(seed?.provider ?? "gmail");
  const [email, setEmail] = useState(seed?.email ?? "");
  const [password, setPassword] = useState("");
  const p = seedProvider(provider);
  const [host, setHost] = useState(seed?.imap_host ?? p.imap[0]);
  const [port, setPort] = useState(seed?.imap_port ?? 993);
  const [busy, setBusy] = useState(false);
  const pick = (id: string) => { const n = seedProvider(id); setProvider(id); if (n.imap[0]) { setHost(n.imap[0]); setPort(n.imap[1]); } };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const em = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) { toast("Type the test inbox's email address."); return; }
    if (!seed && !password) { toast("Add the app password."); return; }
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host.trim())) { toast("Add the IMAP server (ask your provider)."); return; }
    if (demo) { toast("Saving needs a signed-in team."); return; }
    setBusy(true);
    const { data, error } = await supabaseBrowser().rpc("save_seed_inbox", { seed_id: seed?.id ?? null, email: em, provider, imap_host: host.trim().toLowerCase(), imap_port: Number(port), username: em, password });
    setBusy(false);
    if (error) { toast(/save_seed_inbox|schema cache/i.test(error.message) ? "Placement tests are coming soon to your workspace." : error.message); return; }
    toast("Saved. Testing the connection…");
    onSaved(String(data));
  }

  return (
    <SideDrawer label={seed ? "Change test inbox" : "Add test inbox"} onClose={onClose}>
      <header className="dr-head"><div><h2>{seed ? "Change test inbox" : "Add test inbox"}</h2><p>Kestrel only reads it, to see where test emails land.</p></div><button type="button" className="dr-x" aria-label="Close" onClick={onClose}>×</button></header>
      <form className="acct-form" onSubmit={save}>
        <label className="in"><span>Provider</span><select value={provider} onChange={(e) => pick(e.target.value)}>{SEED_PROVIDERS.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
        <label className="in"><span>Email address</span><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="yourname.test@gmail.com" autoComplete="off" /></label>
        <label className="in"><span>App password <Tip text={p.help} /></span><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={seed ? "Leave empty to keep it (needed again if you change the address or server)" : "16-character app password"} autoComplete="new-password" /></label>
        <div className="filters-grid two">
          <label className="in"><span>IMAP server</span><input value={host} onChange={(e) => setHost(e.target.value)} placeholder="imap.example.com" /></label>
          <label className="in"><span>Port</span><select value={port} onChange={(e) => setPort(Number(e.target.value))}><option value={993}>993</option><option value={143}>143</option></select></label>
        </div>
        <div className="cn-btns"><button type="submit" className="btn go small" disabled={busy}>{busy ? "Saving…" : "Save and test"}</button></div>
      </form>
    </SideDrawer>
  );
}

// ---------- start a test
type Seq = { id: string; name: string; steps: Step[] };
function NewTestDrawer({ boxes, seeds, demo, toast, go, onClose, onStarted }: { boxes: Box[]; seeds: Seed[]; demo: boolean; toast: (t: string) => void; go: (v: string) => void; onClose: () => void; onStarted: (id: string) => void }) {
  const ready = boxes.filter((b) => b.status === "ok");
  const [chosen, setChosen] = useState<string[]>(() => ready.slice(0, 10).map((b) => b.id));
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [seqs, setSeqs] = useState<Seq[]>([]);
  const [busy, setBusy] = useState(false);
  const score = useMemo(() => scoreEmail({ subject, body }), [subject, body]);

  useEffect(() => {
    if (demo) { Promise.resolve().then(() => setSeqs([{ id: "q1", name: "Agencies — video", steps: [{ day: 0, subject: "{{SUBJECT}}", body: "Hi {{FIRST_NAME}},\n\n{{ICEBREAKER}}\n\nWe edit short-form video for agencies so your team can post more without hiring. {{QUESTION}}" }] }])); return; }
    supabaseBrowser().from("sequences").select("id,name,steps").order("name").then(({ data }) => setSeqs((data as Seq[] | null) ?? []));
  }, [demo]);
  async function fromSequence(id: string) {
    const q = seqs.find((s) => s.id === id);
    if (!q?.steps?.[0]) return;
    let sender = { sender_name: boxes[0]?.from_name ?? "", business: "", address: "", signature: "" };
    if (!demo) {
      const sbb = supabaseBrowser();
      const first = await sbb.from("team_ai").select("sender_name,business,address,signature,booking_link").maybeSingle();
      const { data } = first.error ? await sbb.from("team_ai").select("sender_name,business,address,signature").maybeSingle() : first;   // before database 037
      if (data) sender = { ...sender, ...(data as typeof sender) };
    }
    const r = renderStep(q.steps[0], 0, SAMPLE_PARTS, "", sender);
    setSubject(r.subject); setBody(r.body);
  }
  async function start() {
    if (!chosen.length) { toast("Choose at least one email account."); return; }
    if (!subject.trim() || !body.trim()) { toast("Add the subject and the email."); return; }
    if (score.blocked) { toast("Fix the red spam-check items first."); return; }
    if (demo) { toast("Running a test needs a signed-in team."); return; }
    setBusy(true);
    const { data, error } = await supabaseBrowser().rpc("start_placement_test", { box_ids: chosen, subject: subject.trim(), body });
    setBusy(false);
    if (error) { toast(/start_placement_test|schema cache/i.test(error.message) ? "Placement tests are coming soon to your workspace." : error.message); return; }
    toast("Test started. Results come in over the next few minutes.");
    onStarted(String(data));
  }
  const toggle = (id: string) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : c.length >= 10 ? c : [...c, id]));

  return (
    <SideDrawer label="New placement test" onClose={onClose} wide>
      <header className="dr-head"><div><h2>New placement test</h2><p>{chosen.length} accounts × {seeds.length} test inboxes = {chosen.length * seeds.length} emails</p></div><button type="button" className="dr-x" aria-label="Close" onClick={onClose}>×</button></header>
      <div className="sg-panel">
        {!seeds.length ? <p className="bl-sum bad">Add a test inbox and test its connection first.</p> : null}
        <h3 className="acct-h3">Send from <Tip text="Ready email accounts only (up to 10). Each sends one email to each test inbox, a few seconds apart. These emails are not counted in campaign numbers." /></h3>
        {ready.length ? <div className="pl-boxes">{ready.map((b) => (
          <label key={b.id} className="agree"><input type="checkbox" checked={chosen.includes(b.id)} onChange={() => toggle(b.id)} /> <span>{b.email}</span></label>
        ))}</div> : <p className="dr-muted">No ready email accounts. <button type="button" className="link-btn" onClick={() => go("mailboxes")}>Add one in Email accounts</button></p>}
        <h3 className="acct-h3">Email <Tip text="Use the real email you will send, so the test is honest. Pick a sequence to fill it with its first email and an example lead." /></h3>
        {seqs.length ? <label className="in"><span>From a sequence</span><select defaultValue="" onChange={(e) => fromSequence(e.target.value)}><option value="" disabled>Choose a sequence</option>{seqs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label> : null}
        <label className="in"><span>Subject</span><input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={300} placeholder="quick question about your reels" /></label>
        <label className="in"><span>Email</span><textarea rows={9} value={body} onChange={(e) => setBody(e.target.value)} maxLength={6000} placeholder="Paste the email you will send" /></label>
        {body.trim() ? <div className="sg-head"><ScoreBadge score={score} /><div><b>{score.blocked ? "Fix the red items in Spam check first" : "Spam check passed"}</b><small>{score.words} words</small></div></div> : null}
        <div className="cn-btns"><button type="button" className="btn go small" disabled={busy || !seeds.length || !chosen.length} onClick={start}>{busy ? "Starting…" : "Start test"}</button></div>
      </div>
    </SideDrawer>
  );
}

// ---------- one test's report
function ReportDrawer({ test, id, demo, manage, toast, onClose, onChanged }: { test: PlacementTest | null; id: string; demo: boolean; manage: boolean; toast: (t: string) => void; onClose: () => void; onChanged: () => void }) {
  const [rows, setRows] = useState<PlacementResult[] | null>(null);
  const live = test?.status === "sending" || test?.status === "checking";
  const load = useCallback(async () => {
    if (demo) { setRows(DEMO_RESULTS.filter((r) => r.test_id === id)); return; }
    const { data } = await supabaseBrowser().from("placement_results").select("id,test_id,mailbox_id,seed_id,from_email,seed_email,seed_provider,state,folder,detail").eq("test_id", id);
    setRows((data as PlacementResult[] | null) ?? []);
  }, [demo, id]);
  useEffect(() => { Promise.resolve().then(load); }, [load]);
  useEffect(() => { if (!live || demo) return; const t = setInterval(load, 10000); return () => clearInterval(t); }, [live, demo, load]);

  const sum = useMemo(() => summarize(rows ?? []), [rows]);
  const seedsIn = [...new Set((rows ?? []).map((r) => r.seed_email))];
  const accounts = [...new Set((rows ?? []).map((r) => r.from_email))];
  async function cancel() {
    if (demo) return;
    const { error } = await supabaseBrowser().rpc("cancel_placement_test", { test_id: id });
    toast(error ? error.message : "Stopped."); onChanged(); load();
  }

  return (
    <SideDrawer label="Placement test" onClose={onClose} wide>
      <header className="dr-head"><div><h2>{test?.subject ?? "Placement test"}</h2><p>{test ? `${ago(test.created_at)} · ${TEST_STATUS[test.status]}${test.scheduled ? " · weekly" : ""}` : ""}</p></div><button type="button" className="dr-x" aria-label="Close" onClick={onClose}>×</button></header>
      <div className="sg-panel">
        <div className="kpis pl-kpis">
          <div><small>Inbox</small><b className="pl-good">{sum.inbox}%</b></div>
          <div><small>Promotions</small><b>{sum.promotions}%</b></div>
          <div><small>Spam</small><b className={sum.spam ? "dlv-bad" : ""}>{sum.spam}%</b></div>
          <div><small>Not arrived</small><b className={sum.missing ? "dlv-bad" : ""}>{sum.missing}%</b></div>
        </div>
        <p className="dr-muted" aria-live="polite">{live ? `Checked ${sum.done} of ${sum.total}. ` : ""}{advice(sum)}</p>
        {test?.paused ? <p className="bl-sum bad">{test.paused} email account{test.paused > 1 ? "s were" : " was"} paused because {test.paused > 1 ? "their" : "its"} emails landed in spam.</p> : null}

        <h3 className="acct-h3">By provider</h3>
        <div className="table-card members acct-table"><table className="leads">
          <thead><tr><th>Provider</th><th>Inbox</th><th>Promotions</th><th>Spam</th><th>Not arrived</th></tr></thead>
          <tbody>{sum.providers.map((p) => <tr key={p.key}><td>{seedProvider(p.key).name}</td><td>{p.inbox}%</td><td>{p.promotions}%</td><td className={p.spam ? "dlv-bad" : ""}>{p.spam}%</td><td>{p.missing}%</td></tr>)}</tbody>
        </table></div>

        <h3 className="acct-h3">By email account</h3>
        <div className="table-card members acct-table pl-grid"><table className="leads">
          <thead><tr><th>Email account</th>{seedsIn.map((s) => <th key={s}>{s.split("@")[0]}<small className="muted-line">{s.split("@")[1]}</small></th>)}</tr></thead>
          <tbody>{accounts.map((a) => (
            <tr key={a}><td><b>{a}</b></td>{seedsIn.map((s) => {
              const r = (rows ?? []).find((x) => x.from_email === a && x.seed_email === s);
              return <td key={s}>{r ? <em className={`pill ${PLACEMENT[r.state][1]}`} title={r.detail ?? r.folder ?? ""}>{PLACEMENT[r.state][0]}</em> : "—"}</td>;
            })}</tr>
          ))}</tbody>
        </table></div>
        {rows === null ? <p className="dr-muted">Loading…</p> : null}
        {live && manage ? <div className="cn-btns"><button type="button" className="btn glass small" onClick={cancel}>Stop test</button></div> : null}
      </div>
    </SideDrawer>
  );
}
