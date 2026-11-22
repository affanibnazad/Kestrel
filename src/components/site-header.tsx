"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Brand, Icon } from "@/components/ui";
import { NAV } from "@/lib/site";

// Floating liquid-glass top bar. "onColor" = sitting on the gradient band (white text).
export default function SiteHeader({ onColor = false }: { onColor?: boolean }) {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(!onColor);
  const path = usePathname();
  // Clear glass over the colour band; light frosted glass once the page scrolls past it.
  useEffect(() => {
    if (!onColor) return;
    // Switch once the page title area has mostly scrolled under the bar.
    const hero = document.querySelector<HTMLElement>(".home-hero, .page-hero");
    // Light frosted bar with dark text as soon as the page moves, so nothing slides under white text.
    const onScroll = () => setScrolled(window.scrollY > 40);
    // Tell the background where the title area ends, so the frosted layer starts right below it on any screen.
    const onResize = () => { if (hero) document.documentElement.style.setProperty("--fade", `${hero.offsetHeight}px`); onScroll(); };
    onResize();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    return () => { window.removeEventListener("scroll", onScroll); window.removeEventListener("resize", onResize); };
  }, [onColor]);
  return (
    <>
    <header className={`site-header${onColor ? " on-color" : ""}${scrolled ? " scrolled" : ""}${open ? " open" : ""}`}>
      <a className="skip-link" href="#content">Skip to content</a>
      <div className="wrap">
      <div className="header-row">
        <Link href="/" aria-label="Kestrel home"><Brand /></Link>
        <nav className="header-links" aria-label="Main">
          {NAV.map((n) => <Link key={n.href} href={n.href} className={path === n.href ? "on" : ""}>{n.label}</Link>)}
        </nav>
        <div className="header-end">
          <Link className="hlink" href="/login">Log in</Link>
          <Link className={`btn small ${onColor ? "light" : "go"}`} href="/pricing#plans">Start free trial</Link>
          <button type="button" className="menu-btn" aria-label="Menu" aria-expanded={open} onClick={() => setOpen(!open)}><Icon name="menu" /></button>
        </div>
      </div>
      </div>
      {open ? (
        <nav className="mobile-nav" aria-label="Mobile">
          {NAV.map((n) => <Link key={n.href} href={n.href} onClick={() => setOpen(false)}>{n.label}</Link>)}
          <Link href="/login" onClick={() => setOpen(false)}>Log in</Link>
        </nav>
      ) : null}
    </header>
    <span id="content" tabIndex={-1} className="skip-target" />
    </>
  );
}
