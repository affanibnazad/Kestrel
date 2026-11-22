"use client";

// Cookie consent: Accept all, Reject all, or choose per category. The choice is saved in this browser
// (localStorage "kestrel-consent") and can be changed any time from "Cookie settings" in the footer.
// Essential storage is always on. Optional categories stay off until the visitor agrees, and
// nothing optional is loaded today; any future analytics must check hasConsent("analytics") first.
import { useEffect, useState } from "react";
import Link from "next/link";

const KEY = "kestrel-consent";
const VERSION = 1;
type Choice = { v: number; analytics: boolean; marketing: boolean; at: string };

export function readConsent(): Choice | null {
  try {
    const c = JSON.parse(localStorage.getItem(KEY) || "null");
    return c && c.v === VERSION ? c : null;
  } catch { return null; }
}
export function hasConsent(kind: "analytics" | "marketing") { return !!readConsent()?.[kind]; }

export default function CookieBanner() {
  const [show, setShow] = useState(false);
  const [custom, setCustom] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [marketing, setMarketing] = useState(false);

  useEffect(() => {
    const open = () => {
      const c = readConsent();
      setAnalytics(!!c?.analytics); setMarketing(!!c?.marketing); setCustom(true); setShow(true);
    };
    // The made-up-data App preview and standalone AI chat never ask; they store nothing.
    const preview = (location.pathname === "/app" && new URLSearchParams(location.search).get("preview") === "1") || location.pathname.startsWith("/kestrel-ai-chat");
    const t = setTimeout(() => { if (!readConsent() && !preview) setShow(true); }, 0);
    window.addEventListener("kestrel-cookie-settings", open);
    return () => { clearTimeout(t); window.removeEventListener("kestrel-cookie-settings", open); };
  }, []);

  const save = (a: boolean, m: boolean) => {
    const choice: Choice = { v: VERSION, analytics: a, marketing: m, at: new Date().toISOString() };
    try { localStorage.setItem(KEY, JSON.stringify(choice)); } catch { /* private mode: ask again next time */ }
    window.dispatchEvent(new CustomEvent("kestrel-consent", { detail: choice }));
    setShow(false); setCustom(false);
  };

  if (!show) return null;
  return (
    <div className="cookie" role="dialog" aria-live="polite" aria-label="Cookie preferences">
      <div className="cookie-text">
        <b>Your privacy</b>
        <p>We use essential storage to run this site. With your permission, we may also use optional cookies to understand how the site is used. <Link href="/cookies">Cookie Policy</Link></p>
      </div>
      {custom ? (
        <div className="cookie-options">
          <label><input type="checkbox" checked disabled /> <span><b>Essential</b> Needed for the site and sign-in. Always on.</span></label>
          <label><input type="checkbox" checked={analytics} onChange={(e) => setAnalytics(e.target.checked)} /> <span><b>Analytics</b> Anonymous visit counts to improve the site.</span></label>
          <label><input type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} /> <span><b>Marketing</b> Measuring campaigns that bring visitors here.</span></label>
        </div>
      ) : null}
      <div className="cookie-actions">
        {custom ? <button type="button" className="btn small go" onClick={() => save(analytics, marketing)}>Save choices</button> : <button type="button" className="btn small" onClick={() => setCustom(true)}>Choose</button>}
        <button type="button" className="btn small" onClick={() => save(false, false)}>Reject all</button>
        <button type="button" className="btn small go" onClick={() => save(true, true)}>Accept all</button>
      </div>
    </div>
  );
}
