"use client";

// Leads → Pipeline (Phase 1, Affan 18 Nov 2026): every lead in one column, from To review to Won / Lost.
// Drag a card to another column (or use its Move menu, which also works with the keyboard). Columns Kestrel fills by
// itself (In outreach, Replied) do not take drops. Stage rules: lib/pipeline.ts.
import { useMemo, useState } from "react";
import { Tip } from "@/components/ui";
import { BizAvatar, siteOfEmail, Socials } from "./biz";
import { placeOf, LEADS_DRAG, type LeadRow } from "@/lib/leads";
import { LOST_REASONS, OFF_BOARD, STAGES, leadStage, readResult, type ConvStage, type MailState, type StageId } from "@/lib/pipeline";
import { Globe, MoreHorizontal } from "lucide-react";

const PER_COLUMN = 40;
export type PipelineMove = "review" | "good" | "nofit" | "meeting" | "won" | "lost";

export default function PipelineView({ leads, mailState, convStage, editable, onMove, onOpen, onView }: {
  leads: LeadRow[]; mailState: Record<string, MailState>; convStage: Record<string, ConvStage>; editable: boolean;
  onMove: (lead: LeadRow, to: PipelineMove) => void; onOpen: (id: string) => void; onView: (view: string) => void;
}) {
  const [more, setMore] = useState<Record<string, number>>({});
  const [over, setOver] = useState<StageId | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  const byStage = useMemo(() => {
    const m: Record<string, LeadRow[]> = {};
    for (const l of leads) {
      const s = leadStage({ verdict: l.verdict, status: l.status, email: l.email, written: Boolean(l.w1 || l.w0), result: readResult(l.result) }, mailState[l.id], convStage[l.id]);
      (m[s] ||= []).push(l);
    }
    return m;
  }, [leads, mailState, convStage]);

  const moveFor = (to: StageId): PipelineMove | null => {
    const d = STAGES.find((s) => s.id === to)?.drop;
    return d === "review" ? "review" : d === "good" ? "good" : d === "result" ? (to as "meeting" | "won" | "lost") : to === "nofit" ? "nofit" : null;
  };
  const drop = (to: StageId) => {
    const l = leads.find((x) => x.id === dragId);
    setOver(null); setDragId(null);
    const m = moveFor(to);
    if (l && m) onMove(l, m);
  };

  return (
    <div className="pipe">
      <div className="pipe-board" role="list" aria-label="Pipeline">
        {STAGES.map((st) => {
          const all = byStage[st.id] ?? [];
          const shown = all.slice(0, more[st.id] ?? PER_COLUMN);
          const accepts = editable && st.drop !== "none";
          const value = st.id === "won" ? all.reduce((n, l) => n + (readResult(l.result)?.value ?? 0), 0) : 0;
          return (
            <section key={st.id} role="listitem" aria-label={`${st.name}, ${all.length} leads`} className={`pipe-col${over === st.id && accepts ? " over" : ""}`}
              onDragOver={(e) => { if (accepts && dragId) { e.preventDefault(); setOver(st.id); } }}
              onDragLeave={() => setOver((o) => (o === st.id ? null : o))}
              onDrop={(e) => { e.preventDefault(); if (accepts) drop(st.id); }}>
              <header className="pipe-h">
                <div className="pipe-h-left">
                  <b>{st.name}</b>
                  <span className="pipe-n">{all.length.toLocaleString()}</span>
                </div>
                <Tip text={st.help} />
              </header>
              {value ? <p className="pipe-sum">{value.toLocaleString(undefined, { maximumFractionDigits: 0 })} won</p> : null}
              <div className="pipe-cards">
                {shown.map((l) => {
                  const r = readResult(l.result);
                  const locationText = placeOf(l) || l.location;
                  return (
                    <article key={l.id} className={`pipe-card${dragId === l.id ? " drag" : ""}`} draggable={editable}
                      onDragStart={(e) => { setDragId(l.id); e.dataTransfer.effectAllowed = "copyMove"; e.dataTransfer.setData("text/plain", l.id); e.dataTransfer.setData(LEADS_DRAG, JSON.stringify([{ id: l.id, name: l.name ?? "Lead" }])); }}
                      onDragEnd={() => { setDragId(null); setOver(null); }}
                      onClick={() => onOpen(l.id)}>
                      {/* Top Row: Profile avatar, company name, move dropdown */}
                      <div className="pipe-card-top">
                        <div className="pipe-card-identity">
                          <BizAvatar name={l.name} website={l.website || siteOfEmail(l.email)} size={34} />
                          <div className="pipe-card-title-wrap">
                            <b
                              className="pipe-card-title"
                              title={l.name ?? ""}
                              style={{ whiteSpace: "normal", wordBreak: "break-word", overflow: "visible", textOverflow: "clip", lineHeight: 1.35 }}
                            >
                              {l.name ?? "No name"}
                            </b>
                          </div>
                        </div>
                        {editable ? (
                          <details className="kdrop kdrop-right pipe-card-drop" onClick={(e) => e.stopPropagation()}>
                            <summary className="pipe-more-btn" aria-label={`Move ${l.name ?? "lead"}`} title="Move to stage">
                              <MoreHorizontal size={15} />
                            </summary>
                            <div className="kmenu" onClick={(e) => { if ((e.target as HTMLElement).closest("button")) (e.currentTarget.closest("details") as HTMLDetailsElement).open = false; }}>
                              <p className="kmenu-h">Move to stage</p>
                              {st.id !== "review" ? <button type="button" onClick={() => onMove(l, "review")}>To review</button> : null}
                              {!["email", "write", "ready"].includes(st.id) ? <button type="button" onClick={() => onMove(l, "good")}>Good fit</button> : null}
                              <button type="button" onClick={() => onMove(l, "nofit")}>Not a fit</button>
                              {st.id !== "meeting" ? <button type="button" onClick={() => onMove(l, "meeting")}>Meeting</button> : null}
                              {st.id !== "won" ? <button type="button" onClick={() => onMove(l, "won")}>Won</button> : null}
                              {st.id !== "lost" ? <button type="button" onClick={() => onMove(l, "lost")}>Lost</button> : null}
                            </div>
                          </details>
                        ) : null}
                      </div>

                      {/* Middle: Category & Location */}
                      <div className="pipe-card-meta">
                        {l.category ? <span className="pipe-meta-cat">{l.category}</span> : null}
                        {l.category && locationText ? <span className="pipe-meta-dot">·</span> : null}
                        {locationText ? <span className="pipe-meta-place">{locationText}</span> : null}
                      </div>

                      {/* Bottom Row: Bare social media icons & website icon */}
                      <div className="pipe-card-foot" onClick={(e) => e.stopPropagation()}>
                        <div className="pipe-card-links">
                          {l.socials && Object.keys(l.socials).length > 0 ? (
                            <Socials socials={l.socials} max={3} />
                          ) : null}
                          {l.website ? (
                            <a
                              href={l.website.startsWith("http") ? l.website : `https://${l.website}`}
                              target="_blank"
                              rel="noreferrer"
                              className="pipe-site-icon"
                              title={l.website}
                              aria-label="Website"
                            >
                              <Globe size={13.5} strokeWidth={1.8} />
                            </a>
                          ) : null}
                        </div>
                        {r?.stage === "won" && r.value ? (
                          <span className="pipe-won-tag">{r.currency ?? ""} {r.value.toLocaleString()}</span>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
                {all.length > shown.length ? (
                  <button type="button" className="link-btn pipe-more" onClick={() => setMore((m) => ({ ...m, [st.id]: (m[st.id] ?? PER_COLUMN) + PER_COLUMN }))}>
                    Show {Math.min(PER_COLUMN, all.length - shown.length)} more
                  </button>
                ) : null}
                {!all.length ? <p className="pipe-empty">{accepts ? "Drag leads here" : "Nothing here yet"}</p> : null}
              </div>
            </section>
          );
        })}
      </div>
      <p className="pipe-off">
        {OFF_BOARD.map((o, i) => (
          <span key={o.id}>{i ? " · " : ""}{o.id === "removed"
            ? <button type="button" className="link-btn" onClick={() => onView("removed")}>{o.name}: {(byStage[o.id] ?? []).length.toLocaleString()}</button>
            : <>{o.name}: {(byStage[o.id] ?? []).length.toLocaleString()}</>}</span>
        ))}
        <Tip text={`Not a fit = marked No. Removed = in Removed. Lost reasons Kestrel offers: ${LOST_REASONS.join(", ")}.`} />
      </p>
    </div>
  );
}
