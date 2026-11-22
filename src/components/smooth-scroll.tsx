"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import Lenis from "lenis";
import "lenis/dist/lenis.css";

// Smooth, weighted scrolling like Framer sites (Lenis). Website pages only, not the app.
// Off when the computer asks for reduced motion. "Jump to section" links glide to their section,
// and every new page starts at the top.
export default function SmoothScroll() {
  const path = usePathname();
  const off = path.startsWith("/app") || path.startsWith("/login");
  const lenisRef = useRef<Lenis | null>(null);

  useEffect(() => {
    if (off || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const lenis = new Lenis({ lerp: 0.085, smoothWheel: true, wheelMultiplier: 0.9, anchors: { offset: -100 } });
    lenisRef.current = lenis;
    let id = 0;
    const raf = (t: number) => { lenis.raf(t); id = requestAnimationFrame(raf); };
    id = requestAnimationFrame(raf);
    return () => { cancelAnimationFrame(id); lenis.destroy(); lenisRef.current = null; };
  }, [off]);

  // New page: start at the top (or at the section named in the address).
  useEffect(() => {
    const lenis = lenisRef.current;
    if (!lenis || location.hash) return;
    lenis.scrollTo(0, { immediate: true, force: true });
  }, [path]);

  return null;
}
