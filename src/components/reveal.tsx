"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

// Apple-style scroll reveal: as each block comes into view it fades in and rises a little, one after another.
// Only things below the first screen are animated, so nothing flickers on load. Off when the computer asks
// for reduced motion. Uses the browser's own animations (element.animate), so the page's HTML is never
// changed: no extra classes or styles, and no mismatch with what React built.
const TARGETS = [
  ".section h2", ".section .eyebrow", ".section .intro", ".grid > *", ".tcols > *", ".tlist > *",
  ".faq-head", ".faq details", ".legal-row", ".help-group", ".split > *", ".cta-band", ".footer-panel",
  ".steps3 > li", ".marquee", ".wtile", ".showcase", ".flist > div", ".works-group", ".tile", ".wordmark",
].join(", ");

export default function Reveal() {
  const path = usePathname();

  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const all = Array.from(document.querySelectorAll<HTMLElement>(TARGETS));
    const set = new Set(all);
    // Animate a block once, not also each thing inside it; skip what is already on screen.
    const pending = all.filter((el) => !el.parentElement?.closest(TARGETS) && el.getBoundingClientRect().top > window.innerHeight * 0.92);
    const delayOf = new Map<HTMLElement, number>();
    for (const el of pending) {
      // Neighbours in a row come in one after another.
      let i = 0;
      for (let s = el.previousElementSibling; s; s = s.previousElementSibling) if (set.has(s as HTMLElement)) i++;
      delayOf.set(el, Math.min(i, 6) * 70);
    }
    const running: Animation[] = [];
    const show = (el: HTMLElement) => {
      running.push(el.animate(
        [{ opacity: 0, transform: "translateY(28px)" }, { opacity: 1, transform: "none" }],
        { duration: 900, delay: delayOf.get(el) ?? 0, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "backwards" },
      ));
    };
    // Checked on scroll (simple and dependable): anything whose top has entered the screen is revealed.
    let frame = 0;
    let left = pending.slice();
    const check = () => {
      frame = 0;
      const line = window.innerHeight * 0.94;
      left = left.filter((el) => { if (el.getBoundingClientRect().top < line) { show(el); return false; } return true; });
      if (!left.length) stop();
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(check); };
    const stop = () => { window.removeEventListener("scroll", onScroll); window.removeEventListener("resize", onScroll); };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    check();

    return () => {
      stop();
      if (frame) cancelAnimationFrame(frame);
      running.forEach((a) => a.cancel());
    };
  }, [path]);

  return null;
}
