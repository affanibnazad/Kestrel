"use client";

// Creator links (kestrelleads.com/?ref=ALEX): remember which creator sent this visitor, so their sign-up is credited.
// The 30-day cookie is a marketing cookie, so it is saved only with marketing consent (now, or when the visitor agrees
// later on this visit). Without consent the code is kept only in this page's memory for the current visit, and the
// sign-up form always has a "Creator code" box.
import { useEffect } from "react";
import { hasConsent } from "./cookie-banner";

const KEY = "kestrel_ref";
const OK = /^[A-Za-z0-9]{3,20}$/;
let thisVisit = "";

// The saved code counts only while marketing consent is on; otherwise only a code from this visit.
export function readRef(): string {
  const m = typeof document === "undefined" || !hasConsent("marketing") ? null : document.cookie.match(/(?:^|;\s*)kestrel_ref=([A-Z0-9]{3,20})/);
  return m ? m[1] : thisVisit;
}
const drop = () => { document.cookie = `${KEY}=; max-age=0; path=/`; };

export default function RefCapture() {
  // Marketing consent taken back (Cookie settings): delete the saved code at once, on every page.
  useEffect(() => {
    const check = () => { if (!hasConsent("marketing")) drop(); };
    check();
    window.addEventListener("kestrel-consent", check);
    return () => window.removeEventListener("kestrel-consent", check);
  }, []);
  useEffect(() => {
    const code = new URLSearchParams(location.search).get("ref") ?? "";
    if (!OK.test(code)) return;
    if (!thisVisit) thisVisit = code.toUpperCase();
    // First creator wins: an existing cookie is never replaced.
    const keep = () => {
      if (!hasConsent("marketing") || /(?:^|;\s*)kestrel_ref=/.test(document.cookie)) return;
      document.cookie = `${KEY}=${thisVisit}; max-age=${30 * 86400}; path=/; samesite=lax${location.protocol === "https:" ? "; secure" : ""}`;
    };
    keep();
    window.addEventListener("kestrel-consent", keep);
    return () => window.removeEventListener("kestrel-consent", keep);
  }, []);
  return null;
}
