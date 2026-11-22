"use client";

import { useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

// New-reply alerts anywhere in the App (Inbox Pro): a message in the App, a short sound, and a browser notification
// when the person allowed them. Kestrel reads the email accounts about every minute; this checks every 20 seconds.
// The on/off choice is kept in this browser only.
const KEY = "kestrel:reply-alerts";
const EVENT = "kestrel-reply-alerts";
type NewReply = { id: string; from_email: string; lead_email: string | null; snippet: string | null; received_at: string | null };

export function alertsOn() {
  try { return localStorage.getItem(KEY) !== "off"; } catch { return true; }
}
export function setAlertsOn(on: boolean) {
  try { localStorage.setItem(KEY, on ? "on" : "off"); } catch { /* private window: the choice lasts until reload */ }
  window.dispatchEvent(new Event(EVENT));
}
export function useAlertsSetting(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(true);
  useEffect(() => {
    const sync = () => setOn(alertsOn());
    sync();
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, []);
  return [on, (v: boolean) => { setAlertsOn(v); setOn(v); }];
}

// Two soft tones. Browsers only allow sound after the person has clicked somewhere in the page; otherwise it stays quiet.
function chime() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx(), now = ctx.currentTime;
    [[880, 0], [1320, 0.14]].forEach(([f, t]) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = f; o.type = "sine";
      g.gain.setValueAtTime(0.0001, now + t); g.gain.exponentialRampToValueAtTime(0.12, now + t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, now + t + 0.35);
      o.connect(g).connect(ctx.destination); o.start(now + t); o.stop(now + t + 0.4);
    });
    setTimeout(() => ctx.close().catch(() => {}), 1200);
  } catch { /* no sound available */ }
}

export function useReplyAlerts(active: boolean, onNew: (text: string) => void, openUnibox: () => void) {
  const [on] = useAlertsSetting();
  const since = useRef<string | null>(null);
  const cb = useRef({ onNew, openUnibox });
  useEffect(() => { cb.current = { onNew, openUnibox }; }, [onNew, openUnibox]);
  useEffect(() => {
    if (!active || !on) return;
    let stop = false;
    const check = async () => {
      const { data, error } = await supabaseBrowser().from("mail_replies").select("id,from_email,lead_email,snippet,received_at")
        .eq("kind", "reply").order("received_at", { ascending: false }).limit(5);
      if (stop || error) return;
      const rows = (data ?? []) as NewReply[];
      const newest = rows[0]?.received_at ?? null;
      if (since.current === null) { since.current = newest ?? new Date(0).toISOString(); return; }   // first look: no alert for old replies
      const fresh = rows.filter((r) => r.received_at && r.received_at > since.current!);
      if (!fresh.length) return;
      since.current = newest;
      const who = fresh[0].lead_email || fresh[0].from_email;
      const text = fresh.length === 1 ? `New reply from ${who}` : `${fresh.length} new replies`;
      cb.current.onNew(text);
      chime();
      if ("Notification" in window && Notification.permission === "granted") {
        try {
          const n = new Notification(text, { body: (fresh[0].snippet ?? "").slice(0, 140), tag: "kestrel-reply", icon: "/icon.svg" });
          n.onclick = () => { window.focus(); cb.current.openUnibox(); n.close(); };
        } catch { /* some browsers only allow notifications from a service worker */ }
      }
    };
    check();
    const t = setInterval(check, 20000);
    return () => { stop = true; clearInterval(t); };
  }, [active, on]);
}
