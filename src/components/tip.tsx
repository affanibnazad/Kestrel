"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// The "?" help circle. Every instruction lives here, never as text on the page.
// Opens only on click (or Enter/Space), never on hover. The text is drawn on top of the page (outside cards, tables and side
// panels), so it is never cut off, and it is kept inside the screen. Closes on a second click, a click elsewhere, Escape,
// scrolling or resizing.
export default function Tip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; above: boolean; arrow: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const id = useId();

  const place = useCallback(() => {
    const b = btn.current?.getBoundingClientRect(), p = pop.current;
    if (!b || !p) return;
    const w = p.offsetWidth, h = p.offsetHeight, vw = window.innerWidth, vh = window.innerHeight, gap = 8, edge = 12;
    const left = Math.max(edge, Math.min(b.left + b.width / 2 - w / 2, vw - w - edge));
    const above = b.bottom + gap + h > vh - edge && b.top - gap - h > edge;
    setPos({ left, top: above ? b.top - gap - h : b.bottom + gap, above, arrow: Math.max(12, Math.min(b.left + b.width / 2 - left, w - 12)) });
  }, []);
  useLayoutEffect(() => { if (open) place(); }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { const t = e.target as Node; if (!btn.current?.contains(t) && !pop.current?.contains(t)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); btn.current?.focus(); } };
    const close = () => setOpen(false);
    document.addEventListener("pointerdown", away, true);
    document.addEventListener("keydown", key, true);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("pointerdown", away, true);
      document.removeEventListener("keydown", key, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);

  return (
    <>
      <button ref={btn} type="button" className={`tip${open ? " on" : ""}`} aria-label={text} aria-expanded={open} aria-controls={open ? id : undefined}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((o) => !o); }}>
        ?
      </button>
      {open ? createPortal(
        <div ref={pop} id={id} role="tooltip" className={`tip-pop${pos?.above ? " above" : ""}`}
          style={pos ? { left: pos.left, top: pos.top, ["--arrow" as string]: `${pos.arrow}px` } : { left: -9999, top: 0, visibility: "hidden" }}>
          {text}
        </div>, document.body) : null}
    </>
  );
}
