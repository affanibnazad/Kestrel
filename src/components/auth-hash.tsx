"use client";

import { useEffect } from "react";
import { supabaseReady } from "@/lib/supabase/config";

// Older Supabase email links put the sign-in (or an error) after a # in the address, which the server
// never sees. This picks it up on any page: a valid sign-in opens the App, an error opens Log in with
// a clear message. Nothing happens on normal visits.
export default function AuthHash() {
  useEffect(() => {
    const hash = location.hash.startsWith("#") ? location.hash.slice(1) : "";
    if (!hash || !supabaseReady) return;
    const p = new URLSearchParams(hash);
    if (p.get("error") || p.get("error_code")) { location.replace("/login?error=link"); return; }
    const access = p.get("access_token"), refresh = p.get("refresh_token");
    if (!access || !refresh) return;
    // The Supabase library (~70 KB) loads only here, so normal visits to the website do not download it.
    import("@/lib/supabase/client").then(({ supabaseBrowser }) => supabaseBrowser().auth.setSession({ access_token: access, refresh_token: refresh }))
      .then(({ error }) => { location.replace(error ? "/login?error=link" : "/app"); })
      .catch(() => location.replace("/login?error=link"));
  }, []);
  return null;
}
