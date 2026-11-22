"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Line, Tip } from "@/components/ui";
import { BizAvatar, siteOfEmail } from "./biz";

// Home → Today (Affan: "home page with more context"): what needs you now, today's mail at a glance, the latest
// replies and quick actions. Reads with the person's own permissions; any part missing (older database) is skipped.
type Camp = { id: string; name: string; status: string; paused_reason: string | null };
type Box = { id: string; email: string; status: string; warmup_started_at: string | null; warmup_override: boolean };
type Today = { id: string; warm: boolean; limit_today: number; sent_24h: number; bounce_rate_7d: number };
type Rep = { id: string; from_email: string; snippet: string | null; received_at: string | null; handled: boolean };
type Data = { camps: Camp[]; boxes: Box[]; today: Today[]; replies: Rep[] };

const ago = (s: string | null) => {
  if (!s) return "";
  const m = Math.round((Date.now() - Date.parse(s)) / 60000);
  return m < 60 ? `${Math.max(1, m)} min` : m < 1440 ? `${Math.round(m / 60)} h` : new Date(s).toLocaleDateString(undefined, { day: "numeric", month: "short" });
};
const DEMO: Data = {
  camps: [{ id: "c1", name: "Video agencies, London", status: "running", paused_reason: null }, { id: "c2", name: "Cafés, Manchester", status: "paused", paused_reason: "Bounces above 5% on alex@northlight-studio.test" }],
  boxes: [{ id: "b1", email: "alex@northlight-studio.test", status: "ok", warmup_started_at: "2026-10-01", warmup_override: false },
    { id: "b2", email: "sam@northlight-mail.test", status: "ok", warmup_started_at: new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10), warmup_override: false }],
  today: [{ id: "b1", warm: true, limit_today: 25, sent_24h: 18, bounce_rate_7d: 0.8 }, { id: "b2", warm: true, limit_today: 13, sent_24h: 4, bounce_rate_7d: 0 }],
  replies: [{ id: "r1", from_email: "hello@harbour-example.test", snippet: "Hi, yes we get busy around launches. Can you share examples?", received_at: new Date(Date.now() - 15 * 60000).toISOString(), handled: false },
    { id: "r2", from_email: "info@quickprint-example.test", snippet: "Thanks, not right now. Maybe next quarter.", received_at: new Date(Date.now() - 26 * 3600000).toISOString(), handled: true }],
};

// compact (design v2): the Dashboard above already lists the latest replies, so that card is left out here.
export default function HomeToday({ demo, go, onSpam, compact = false }: { demo: boolean; go: (view: string) => void; onSpam: () => void; compact?: boolean }) {
  const [d, setD] = useState<Data | null>(null);
  useEffect(() => {
    if (demo) { Promise.resolve().then(() => setD(DEMO)); return; }
    let live = true;
    const sb = supabaseBrowser();
    Promise.all([
      sb.from("campaigns").select("id,name,status,paused_reason").order("created_at", { ascending: false }).limit(50),
      sb.from("mailboxes").select("id,email,status,warmup_started_at,warmup_override"),
      sb.rpc("mailbox_today"),
      sb.from("mail_replies").select("id,from_email,snippet,received_at,handled").eq("kind", "reply").order("received_at", { ascending: false }).limit(50),
    ]).then(([c, b, t, r]) => {
      if (!live) return;
      setD({ camps: (c.data ?? []) as Camp[], boxes: (b.data ?? []) as Box[], today: (t.data ?? []) as Today[], replies: (r.data ?? []) as Rep[] });
    });
    return () => { live = false; };
  }, [demo]);

  if (!d) return <p className="plan-msg">Loading today…</p>;
  const byBox = new Map(d.today.map((t) => [t.id, t]));
  const waiting = d.replies.filter((r) => !r.handled);
  const sending = d.camps.filter((c) => c.status === "running");
  const paused = d.camps.filter((c) => c.status === "paused");
  const problem = d.boxes.filter((b) => b.status === "error" || b.status === "paused");
  const ready = d.boxes.filter((b) => b.status === "ok");
  const sent = d.today.reduce((n, t) => n + t.sent_24h, 0), cap = ready.reduce((n, b) => n + (byBox.get(b.id)?.limit_today ?? 0), 0);

  const todo: { tone: string; text: string; action: [string, () => void] }[] = [
    ...(waiting.length ? [{ tone: "good", text: `${waiting.length} ${waiting.length === 1 ? "reply needs" : "replies need"} an answer`, action: ["Open Replies", () => go("inbox")] as [string, () => void] }] : []),
    ...problem.map((b) => ({ tone: "no", text: `${b.email} has a problem and is not sending`, action: ["Fix", () => go("mailboxes")] as [string, () => void] })),
    ...paused.map((c) => ({ tone: "maybe", text: `“${c.name}” is paused${c.paused_reason ? `: ${c.paused_reason}` : ""}`, action: ["Open", () => go("campaigns")] as [string, () => void] })),
  ].slice(0, 6);

  return (
    <>
      <div className="home-grid">
        <section className="home-card">
          <div className="home-card-head"><b>Needs your attention</b><span className="sub-dark">{todo.length ? `${todo.length} ${todo.length === 1 ? "thing" : "things"}` : "All clear"}</span></div>
          {todo.length ? (
            <ul className="todo-list">{todo.map((t) => (
              <li key={t.text}><span className={`todo-dot ${t.tone}`} aria-hidden="true" /><span className="t">{t.text}</span>
                <button type="button" className="btn small glass" onClick={t.action[1]}>{t.action[0]}</button></li>
            ))}</ul>
          ) : <p className="home-empty">Nothing waits for you. Replies, account problems and paused campaigns show here.</p>}
        </section>
        <section className="home-card">
          <div className="home-card-head"><b>Mail today <Tip text="Last 24 hours. Capacity is today's sending limit of the email accounts that are ready, with ramp-up." /></b>
            <button type="button" className="link-btn" onClick={() => go("analytics")}>Analytics</button></div>
          <div className="today-grid">
            <button type="button" className="today-tile" onClick={() => go("campaigns")}><b>{sent.toLocaleString()}<i> / {cap.toLocaleString()}</i></b><span>Emails sent</span>
              <span className="today-meter" aria-hidden="true"><i style={{ width: `${cap ? Math.min(100, (sent / cap) * 100) : 0}%` }} /></span></button>
            <button type="button" className="today-tile" onClick={() => go("inbox")}><b>{waiting.length}</b><span>Replies to answer</span></button>
            <button type="button" className="today-tile" onClick={() => go("campaigns")}><b>{sending.length}</b><span>Campaigns sending</span></button>
            <button type="button" className="today-tile" onClick={() => go("mailboxes")}><b>{ready.length}<i> / {d.boxes.length}</i></b><span>Accounts ready</span></button>
          </div>
        </section>
      </div>
      <div className="home-grid">
        {compact ? null : <section className="home-card">
          <div className="home-card-head"><b>Latest replies</b><button type="button" className="link-btn" onClick={() => go("inbox")}>Replies</button></div>
          {d.replies.length ? (
            <ul className="recent">{d.replies.slice(0, 4).map((r) => (
              <li key={r.id}><BizAvatar name={r.from_email} website={siteOfEmail(r.from_email)} /><span className="t"><b>{r.from_email}</b><small>{(r.snippet ?? "").slice(0, 90)}</small></span>
                {!r.handled ? <em className="pill good">To answer</em> : <small className="sub-dark">{ago(r.received_at)}</small>}</li>
            ))}</ul>
          ) : <p className="home-empty">No replies yet. They show here as soon as someone answers a campaign.</p>}
        </section>}
        <section className="home-card">
          <div className="home-card-head"><b>Quick actions</b></div>
          <div className="quick-grid">
            {([["sparkle", "Ask Kestrel AI", () => go("ai")], ["send", "New campaign", () => go("campaigns")], ["steps", "Write a sequence", () => go("sequences")],
              ["shield", "Check an email for spam", onSpam], ["at", "Add an email account", () => go("mailboxes")], ["search", "Find more leads", () => go("progress")]] as [string, string, () => void][]).map(([icon, label, fn]) => (
              <button key={label} type="button" className="quick-btn" onClick={fn}><span className="quick-ic"><Line name={icon} /></span>{label}</button>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
