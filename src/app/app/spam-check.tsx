"use client";

import { useMemo, useState } from "react";
import { Tip } from "@/components/ui";
import { gradeTone, scoreEmail, type Score } from "@/lib/spamguard";
import SideDrawer from "./side-drawer";

// Kestrel Spam Guard, part A on screen: the score badge, the list of problems with how to fix each, and the Spam check
// side panel (paste any email, see its score, let the AI fix only what was flagged).
export const SCORE_HELP = "Kestrel's spam score checks the words, subject, length, links and opt-out line, like the spam checkers in Instantly and Mailmeteor. Red items can send you to spam: fix them before sending (campaigns will not start with red items). Content is only part of inbox placement; warmup and your domain's reputation matter too.";

export function ScoreBadge({ score, compact }: { score: Score; compact?: boolean }) {
  return (
    <span className={`sg-badge ${gradeTone(score.grade)}`} title={`Spam score ${score.score} of 100`}>
      <b>{score.grade}</b>{compact ? null : <span>{score.score}</span>}
    </span>
  );
}

export function IssueList({ score, limit }: { score: Score; limit?: number }) {
  const list = score.issues.filter((i) => i.level !== "info").slice(0, limit ?? 99);
  const info = score.issues.filter((i) => i.level === "info");
  if (!list.length && !info.length) return <p className="sg-clean">No problems found.</p>;
  return (
    <ul className="sg-list">
      {list.map((i) => <li key={i.id} className={i.level}><b>{i.title}</b><span>{i.fix}</span></li>)}
      {info.map((i) => <li key={i.id} className="info"><b>{i.title}</b><span>{i.fix}</span></li>)}
    </ul>
  );
}

type Mode = "email" | "template" | "reply";
const MODES: [Mode, string][] = [["email", "Cold email"], ["template", "Sequence template"], ["reply", "Reply to a lead"]];
const SAMPLE = { subject: "quick question about your reels", body: "Hi Harbour Social,\n\nSaw your weekly reels for local cafés. They look great.\n\nWe edit short-form video for agencies so your team can post more without hiring. Would a few sample edits be useful?\n\nAlex, Northlight Studio\n12 King Street, London\n\nNot relevant? Reply \"no\" and I won't write again." };

export function SpamCheckPanel({ onClose, demo, toast, start }: { onClose: () => void; demo: boolean; toast: (t: string) => void; start?: { subject: string; body: string; mode?: Mode; sent?: boolean } }) {
  // sent: opened from a campaign for a lead's finished email, which must carry its own opt-out (strict check).
  const sent = Boolean(start?.sent);
  const [subject, setSubject] = useState(start?.subject ?? "");
  const [body, setBody] = useState(start?.body ?? "");
  const [mode, setMode] = useState<Mode>(start?.mode ?? "email");
  const [busy, setBusy] = useState(false);
  const [undo, setUndo] = useState<{ subject: string; body: string } | null>(null);
  const score = useMemo(() => scoreEmail({ subject, body, template: mode === "template", reply: mode === "reply", paste: mode === "email" && !sent }), [subject, body, mode, sent]);

  async function fix() {
    if (demo) { toast("AI fix needs a signed-in team. In the preview, fix the items by hand."); return; }
    setBusy(true);
    const r = await fetch("/api/spam/fix", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ subject, body, mode }) })
      .then((x) => x.json()).catch(() => ({ error: "No connection. Try again." })) as { subject?: string; body?: string; error?: string; note?: string; before?: number; score?: Score };
    setBusy(false);
    if (r.error) { toast(r.error); return; }
    if (r.note) { toast(r.note); return; }
    setUndo({ subject, body });
    setSubject(r.subject ?? subject); setBody(r.body ?? body);
    toast(`Fixed: score ${r.before ?? score.score} → ${r.score?.score ?? "?"}. Read it before you use it.`);
  }
  async function copy() {
    try { await navigator.clipboard.writeText(subject ? `${subject}\n\n${body}` : body); toast("Copied."); } catch { toast("Select the text and copy it."); }
  }

  return (
    <SideDrawer label="Spam check" onClose={onClose} wide>
      <header className="dr-head"><div><h2>Spam check</h2><p>Paste any email to see its spam score and what to fix.</p></div><button type="button" className="dr-x" aria-label="Close" onClick={onClose}>×</button></header>
      <div className="sg-panel">
        <div className="seg" role="group" aria-label="What kind of email">
          {MODES.map(([id, name]) => <button key={id} type="button" className={mode === id ? "on" : ""} aria-pressed={mode === id} onClick={() => setMode(id)}>{name}</button>)}
        </div>
        <label className="in"><span>Subject</span><input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="quick question about your reels" maxLength={300} /></label>
        <label className="in"><span>Email</span><textarea rows={10} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Paste the email text here" maxLength={6000} /></label>
        {!body && !subject ? <button type="button" className="link-btn" onClick={() => { setSubject(SAMPLE.subject); setBody(SAMPLE.body); }}>Try an example</button> : null}
        {body.trim() ? (
          <section className="sg-result" aria-live="polite">
            <div className="sg-head">
              <ScoreBadge score={score} />
              <div><b>{score.grade === "A" ? "Ready to send" : score.blocked ? "Fix the red items before sending" : "Good, can be better"}</b><small>{score.words} words <Tip text={SCORE_HELP} /></small></div>
            </div>
            <IssueList score={score} />
            <div className="cn-btns">
              <button type="button" className="btn go small" disabled={busy || !score.issues.some((i) => i.level !== "info")} onClick={fix}>{busy ? "Fixing…" : "AI fix"}</button>
              {undo ? <button type="button" className="btn glass small" onClick={() => { setSubject(undo.subject); setBody(undo.body); setUndo(null); }}>Undo</button> : null}
              <button type="button" className="btn glass small" onClick={copy}>Copy</button>
              <Tip text="AI fix rewrites only the flagged words with Claude (Kestrel's AI) and keeps your {{FIELDS}} and opt-out line. It uses one of today's Kestrel AI messages. Always read the result before using it." />
            </div>
          </section>
        ) : null}
      </div>
    </SideDrawer>
  );
}
