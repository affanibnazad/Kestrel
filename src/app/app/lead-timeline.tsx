"use client";

import { useEffect, useState } from "react";
import { Tip } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/client";

// The lead's email history in its profile: every campaign email (sent or planned), opens (estimates), replies,
// bounces and unsubscribes, newest campaign first. Reloads every 30 seconds while the panel is open.
type Row = { id: string; campaign_id: string; status: string; to_email: string; steps: { day: number; subject: string; body: string }[]; next_step: number; next_at: string | null; first_sent_at: string | null };
type Ev = { campaign_lead_id: string; step: number | null; kind: string; at: string; detail: string | null };
type Rep = { campaign_lead_id: string; kind: string; subject: string | null; snippet: string | null; body?: string | null; received_at: string | null };

const when = (s: string | null) => (s ? new Date(s).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
const STATUS: Record<string, string> = { active: "Sending", done: "All steps sent", replied: "Replied", unsubscribed: "Unsubscribed", bounced: "Bounced", blocked: "Do-not-contact", failed: "Failed", stopped: "Stopped" };
const KIND: Record<string, string> = { reply: "Reply", remove: "Asked to be removed", bounce: "Bounced", auto: "Out of office" };
const OPEN_HELP = "Opens are estimates. Gmail loads the image once and keeps it, so later opens are often not counted. Apple Mail loads images by itself, so it can show an open nobody made. Shown only for campaigns with open tracking on.";

export default function LeadTimeline({ leadId, demo }: { leadId: string; demo: boolean }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [events, setEvents] = useState<Ev[]>([]);
  const [replies, setReplies] = useState<Rep[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<string>("");

  useEffect(() => {
    let live = true;
    const load = async () => {
      if (demo) {
        const now = Date.now(), d = (h: number) => new Date(now - h * 3600000).toISOString();
        if (live) {
          setRows([{ id: "x", campaign_id: "c", status: "replied", to_email: "hello@example.test", next_step: 1, next_at: null, first_sent_at: d(30),
            steps: [{ day: 0, subject: "short-form edits for retail brands", body: "Hey Harbour Social,\n\nSaw you post short-form video every week…" }, { day: 5, subject: "", body: "Hey Harbour Social,\n\nDo your clients…" }] }]);
          setEvents([{ campaign_lead_id: "x", step: 0, kind: "sent", at: d(30), detail: null }, { campaign_lead_id: "x", step: 0, kind: "opened", at: d(29), detail: "Gmail" },
            { campaign_lead_id: "x", step: 0, kind: "opened", at: d(5), detail: "Gmail" }, { campaign_lead_id: "x", step: 0, kind: "replied", at: d(4), detail: null }]);
          setReplies([{ campaign_lead_id: "x", kind: "reply", subject: "Re: short-form edits", snippet: "Hi, yes we get busy around launches. Can you share examples?", received_at: d(4) }]);
          setNames({ c: "Video agencies, London (example)" });
        }
        return;
      }
      const sb = supabaseBrowser();
      const { data } = await sb.from("campaign_leads").select("id,campaign_id,status,to_email,steps,next_step,next_at,first_sent_at").eq("lead_id", leadId).order("first_sent_at", { ascending: false, nullsFirst: true });
      const list = (data as Row[] | null) ?? [];
      const ids = list.map((r) => r.id);
      const [ev, rp, cs] = ids.length ? await Promise.all([
        sb.from("mail_events").select("campaign_lead_id,step,kind,at,detail").in("campaign_lead_id", ids).order("at"),
        sb.from("mail_replies").select("campaign_lead_id,kind,subject,snippet,body,received_at").in("campaign_lead_id", ids).order("received_at"),
        sb.from("campaigns").select("id,name").in("id", [...new Set(list.map((r) => r.campaign_id))]),
      ]) : [{ data: [] }, { data: [] }, { data: [] }];
      if (!live) return;
      setRows(list); setEvents((ev.data as Ev[] | null) ?? []); setReplies((rp.data as Rep[] | null) ?? []);
      setNames(Object.fromEntries(((cs.data as { id: string; name: string }[] | null) ?? []).map((c) => [c.id, c.name])));
    };
    load();
    const t = setInterval(load, 30000);
    return () => { live = false; clearInterval(t); };
  }, [leadId, demo]);

  if (rows === null) return <p className="dr-muted">Loading the email history…</p>;
  if (!rows.length) return <p className="dr-muted">Not in a campaign yet. When a campaign emails this lead, every email, open and reply shows here.</p>;

  return (
    <div className="tl">
      {rows.map((r) => {
        const ev = events.filter((e) => e.campaign_lead_id === r.id), rp = replies.filter((x) => x.campaign_lead_id === r.id);
        return (
          <div key={r.id} className="tl-camp">
            <div className="tl-head"><b>{names[r.campaign_id] ?? "Campaign"}</b><span className="tl-status">{STATUS[r.status] ?? r.status}</span></div>
            {r.steps.map((s, i) => {
              const sent = ev.find((e) => e.kind === "sent" && e.step === i), opens = ev.filter((e) => e.kind === "opened" && e.step === i);
              const planned = !sent && r.status === "active" && i === r.next_step && r.next_at;
              if (!sent && !planned) return null;
              const key = `${r.id}:${i}`;
              return (
                <div key={i} className={`tl-step${sent ? "" : " planned"}`}>
                  <div className="tl-row">
                    <span className="tl-dot" aria-hidden="true" />
                    <div className="tl-main">
                      <b>{i === 0 ? "First email" : `Follow-up ${i}`}</b>
                      <small>{sent ? `Sent ${when(sent.at)}` : `Planned ${when(r.next_at)}`}{s.subject ? ` · ${s.subject}` : ""}</small>
                      {opens.length ? <small className="tl-open">Opened {opens.length} {opens.length === 1 ? "time" : "times"} (estimate) · last {when(opens[opens.length - 1].at)}{opens[0].detail ? ` · ${opens[0].detail}` : ""} <Tip text={OPEN_HELP} /></small> : null}
                      <button type="button" className="link-btn" onClick={() => setOpen(open === key ? "" : key)}>{open === key ? "Hide email" : "Show email"}</button>
                      {open === key ? <pre className="dr-draft">{s.body}</pre> : null}
                    </div>
                  </div>
                </div>
              );
            })}
            {ev.filter((e) => e.kind === "sent" && e.step === null).map((e, i) => (
              <div key={`a${i}`} className="tl-step tl-answer">
                <div className="tl-row"><span className="tl-dot" aria-hidden="true" />
                  <div className="tl-main"><b>Your answer</b><small>{when(e.at)}</small>{e.detail ? <p className="tl-snippet">{e.detail.replace(/^Answer: /, "")}</p> : null}</div>
                </div>
              </div>
            ))}
            {rp.map((x, i) => (
              <div key={`r${i}`} className={`tl-step tl-reply ${x.kind}`}>
                <div className="tl-row"><span className="tl-dot" aria-hidden="true" />
                  <div className="tl-main"><b>{KIND[x.kind] ?? "Reply"}</b><small>{when(x.received_at)}{x.subject ? ` · ${x.subject}` : ""}</small>{x.body || x.snippet ? <p className="tl-snippet">{x.body || x.snippet}</p> : null}</div>
                </div>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
