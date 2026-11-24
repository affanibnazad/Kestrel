"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Tip } from "@/components/ui";
import { placeOf, SOURCE_NAMES, type LeadRow } from "@/lib/leads";

// Review mode, like the extension's: one lead at a time. 1 Good, 2 Maybe, 3 No; arrows move; Esc finishes.
// The list is fixed when Review starts (the leads in the current view), so a decision never reshuffles it.
type Verdict = "Good" | "Maybe" | "No";
type Extra = { description?: string; address?: string; rating?: number; reviews?: number };
const KEYS: [Verdict, string][] = [["Good", "1"], ["Maybe", "2"], ["No", "3"]];

export default function Review({ list, editable, demo, onChange, onClose }: {
  list: LeadRow[]; editable: boolean; demo: boolean;
  onChange: (id: string, patch: Partial<LeadRow>) => void; onClose: (decided: number) => void;
}) {
  const [ids] = useState(() => list.map((l) => l.id));
  const [at, setAt] = useState(0);
  const [decided, setDecided] = useState<Record<string, Verdict>>({});
  const [extra, setExtra] = useState<Record<string, Extra>>({});
  const [note, setNote] = useState("");
  const [byId, setById] = useState(() => new Map(list.map((l) => [l.id, l])));
  const lead = byId.get(ids[at]);
  const put = (l: LeadRow) => setById((m) => new Map(m).set(l.id, l));
  const count = Object.keys(decided).length;

  // Description and address live in the full lead (data); load this one and the next.
  useEffect(() => {
    if (demo) return;
    const need = ids.slice(at, at + 2).filter((id) => !extra[id]);
    if (!need.length) return;
    supabaseBrowser().from("leads").select("id,data").in("id", need).then(({ data }) => {
      const add: Record<string, Extra> = {};
      for (const r of (data as { id: string; data: Extra | null }[] | null) ?? []) add[r.id] = r.data ?? {};
      for (const id of need) add[id] ||= {};
      setExtra((e) => ({ ...e, ...add }));
    });
  }, [at, ids, demo, extra]);

  const finish = useCallback(() => onClose(count), [onClose, count]);
  const decide = useCallback(async (v: Verdict) => {
    if (!lead) return;
    if (!editable) { setNote("Read-only: this team cannot change leads right now."); return; }
    const before = lead.verdict;
    onChange(lead.id, { verdict: v });
    put({ ...lead, verdict: v });
    setDecided((d) => ({ ...d, [lead.id]: v }));
    setNote("");
    if (at + 1 >= ids.length) setTimeout(() => onClose(count + (decided[lead.id] ? 0 : 1)), 250); else setAt(at + 1);
    if (demo) return;
    const { error } = await supabaseBrowser().from("leads").update({ verdict: v }).eq("id", lead.id);
    if (error) { onChange(lead.id, { verdict: before }); put({ ...lead, verdict: before }); setNote(`Not saved for ${lead.name}: ${error.message}`); }
  }, [lead, editable, onChange, at, ids.length, onClose, count, decided, demo]);

  // Keyboard. Focus stays inside the review, and the page behind it does not scroll.
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    box.current?.focus();
    const overflow = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = overflow; before?.focus?.(); };
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA") return;
      if (e.key === "Escape") { e.preventDefault(); finish(); }
      else if (e.key === "1" || e.key === "2" || e.key === "3") { e.preventDefault(); decide(KEYS[Number(e.key) - 1][0]); }
      else if (e.key === "ArrowRight") { e.preventDefault(); setAt((a) => Math.min(ids.length - 1, a + 1)); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); setAt((a) => Math.max(0, a - 1)); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [decide, finish, ids.length]);

  if (!lead) return null;
  const x = extra[lead.id] ?? {};
  const site = lead.website?.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
  const facts: [string, React.ReactNode][] = [
    ["Email", lead.email], ["Phone", lead.phone],
    ["Website", site ? <a href={lead.website!} target="_blank" rel="noreferrer">{site}</a> : null],
    ["Place", x.address || placeOf(lead)], ["Rating", x.rating ? `${x.rating}${x.reviews ? ` from ${x.reviews} reviews` : ""}` : null],
    ["Source", SOURCE_NAMES[lead.source ?? ""] ?? lead.source],
  ].filter(([, v]) => v) as [string, React.ReactNode][];
  const now = decided[lead.id] ?? lead.verdict;

  return (
    <div ref={box} className="review-mode" role="dialog" aria-modal="true" aria-label="Review leads" tabIndex={-1}>
      <header className="rv-top">
        <span className="rv-pos" aria-live="polite">{at + 1} of {ids.length}</span>
        <div className="rv-bar" aria-hidden="true"><i style={{ transform: `scaleX(${(at + 1) / ids.length})` }} /></div>
        <span className="rv-done-n">{count} decided</span>
        <Tip text="Press 1 for Good, 2 for Maybe, 3 for No. The next lead opens by itself. Left and right arrows move without deciding. Esc finishes. Every choice is saved for your whole team at once." />
        <button type="button" className="btn small glass" onClick={finish}>Finish</button>
      </header>

      <article className="rv-card" key={lead.id}>
        <h2>{lead.name}</h2>
        {lead.category ? <p className="rv-cat">{lead.category}</p> : null}
        {lead.reason ? <p className="rv-reason"><span className={`pill ${(lead.verdict ?? "").toLowerCase()}`}>{lead.verdict ?? "AI"}</span> {lead.reason}</p> : null}
        {x.description ? <p className="rv-desc">{x.description}</p> : null}
        <dl className="rv-facts">
          {facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
        </dl>
      </article>

      <div className="rv-decide" role="group" aria-label="Fit">
        {KEYS.map(([v, k]) => (
          <button key={v} type="button" className={`rv-key ${v.toLowerCase()}${now === v ? " on" : ""}`} onClick={() => decide(v)} aria-keyshortcuts={k} aria-pressed={now === v}>
            <kbd>{k}</kbd><span>{v}</span>
          </button>
        ))}
      </div>
      <nav className="rv-move" aria-label="Move">
        <button type="button" className="link-btn" disabled={at === 0} onClick={() => setAt(at - 1)}>Back</button>
        <button type="button" className="link-btn" disabled={at + 1 >= ids.length} onClick={() => setAt(at + 1)}>Skip</button>
      </nav>
      {note ? <p className="rv-note" role="alert">{note}</p> : null}
    </div>
  );
}
