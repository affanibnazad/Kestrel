"use client";

import { useEffect, useRef, type ReactNode } from "react";

// Framer-style scroll effect: the app picture starts a little lower and smaller, then rises and grows
// to full size as you scroll. No tilt, so its shape never bends. The movement eases toward the target every frame,
// so it glides instead of jumping. Off for reduced motion.
export default function ScrollTilt({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let current = 0, frame = 0;
    const apply = (p: number) => {
      const e = 1 - Math.pow(1 - p, 3);
      el.style.transform = `translate3d(0, ${((1 - e) * 36).toFixed(2)}px, 0) scale(${(0.93 + e * 0.07).toFixed(4)})`;
    };
    const target = () => Math.min(1, Math.max(0, window.scrollY / (window.innerHeight * 0.6)));
    const tick = () => {
      const t = target();
      current += (t - current) * 0.12;
      if (Math.abs(t - current) < 0.0005) current = t;
      apply(current);
      frame = current === t ? 0 : requestAnimationFrame(tick);
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(tick); };
    current = target(); apply(current);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { window.removeEventListener("scroll", onScroll); if (frame) cancelAnimationFrame(frame); };
  }, []);
  // The soft fade lives on the outer, still layer; only the inner layer moves (smoother on the graphics card).
  return <div className="feather"><div ref={ref} className="tilt">{children}</div></div>;
}
