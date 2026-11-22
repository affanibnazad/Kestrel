"use client";

import { useState } from "react";

// Business avatar and social links for lead rows, Replies and panels (like the leading outreach tools):
// the business's own website icon when it has one, otherwise its initials on a calm brand-family colour.

export const domainOf = (url: string | null | undefined) => {
  if (!url) return "";
  try { return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; }
};
// A business's site from its email when no website is known (hello@northlight.co → northlight.co), so its logo still
// shows (Phase 1: a profile picture for every lead everywhere). Free mail (Gmail, Outlook…) says nothing about the business.
const FREE_MAIL = /^(gmail|googlemail|yahoo|ymail|outlook|hotmail|live|msn|icloud|me|mac|aol|proton|protonmail|pm|gmx|yandex|mail|zoho|fastmail|hey|tutanota|qq|163|126|web|t-online|orange|free|libero|wanadoo|btinternet|comcast|verizon)\./i;
export const siteOfEmail = (email: string | null | undefined) => {
  const d = (email ?? "").split("@")[1]?.trim().toLowerCase() ?? "";
  return d && /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d) && !FREE_MAIL.test(d) ? d : "";
};
const initials = (name: string) => {
  const w = name.replace(/\(.*?\)/g, "").replace(/[^\p{L}\p{N} ]/gu, " ").trim().split(/\s+/).filter(Boolean);
  return ((w[0]?.[0] ?? "?") + (w.length > 1 ? w[1][0] : w[0]?.[1] ?? "")).toUpperCase();
};
// Six quiet tones from the periwinkle family, picked by name so a business keeps its colour.
const TONES = ["#3d62b3", "#5b6fa8", "#4a7f8c", "#6b5ea8", "#59708a", "#7a6a55"];
const toneOf = (s: string) => TONES[[...s].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7) % TONES.length];

export function BizAvatar({ name, website, size = 32 }: { name: string | null; website?: string | null; size?: number }) {
  const label = name || website || "?";
  const d = domainOf(website);
  const [failed, setFailed] = useState(false);
  const style = { width: size, height: size, fontSize: Math.round(size * 0.38) };
  // Example data uses reserved .test / .example domains: no logo exists, so show initials without asking the server.
  if (d && !failed && !/\.(test|example|invalid|localhost)$/.test(d)) {
    // eslint-disable-next-line @next/next/no-img-element
    return <span className="biz-av logo" style={style} aria-hidden="true"><img src={`/api/logo?d=${encodeURIComponent(d)}`} alt="" loading="lazy" onError={() => setFailed(true)} /></span>;
  }
  return <span className="biz-av" style={{ ...style, background: toneOf(label) }} aria-hidden="true">{initials(label)}</span>;
}

// Simple one-colour glyphs (they take the text colour). Unknown networks are skipped.
const GLYPH: Record<string, [string, string]> = {
  instagram: ["Instagram", "M7.5 3h9A4.5 4.5 0 0 1 21 7.5v9a4.5 4.5 0 0 1-4.5 4.5h-9A4.5 4.5 0 0 1 3 16.5v-9A4.5 4.5 0 0 1 7.5 3zm0 1.8A2.7 2.7 0 0 0 4.8 7.5v9a2.7 2.7 0 0 0 2.7 2.7h9a2.7 2.7 0 0 0 2.7-2.7v-9a2.7 2.7 0 0 0-2.7-2.7zM12 7.6a4.4 4.4 0 1 1 0 8.8 4.4 4.4 0 0 1 0-8.8zm0 1.8a2.6 2.6 0 1 0 0 5.2 2.6 2.6 0 0 0 0-5.2zM17 5.9a1.1 1.1 0 1 1 0 2.2 1.1 1.1 0 0 1 0-2.2z"],
  facebook: ["Facebook", "M13.6 21v-7.5h2.5l.4-3h-2.9V8.6c0-.9.3-1.5 1.5-1.5h1.6V4.4c-.3 0-1.2-.1-2.3-.1-2.3 0-3.8 1.4-3.8 3.9v2.3H8v3h2.6V21z"],
  linkedin: ["LinkedIn", "M4.5 3.5a1.9 1.9 0 1 1 0 3.8 1.9 1.9 0 0 1 0-3.8zM2.9 9h3.3v11.5H2.9zm5.4 0h3.1v1.6h.1c.4-.8 1.5-1.8 3.2-1.8 3.4 0 4 2.2 4 5.1v6.6h-3.3v-5.9c0-1.4 0-3.2-2-3.2s-2.2 1.5-2.2 3.1v6H8.3z"],
  twitter: ["X", "M17.6 3h3.1l-6.8 7.7L22 21h-6.3l-4.9-6.4L5.2 21H2.1l7.3-8.3L1.8 3h6.4l4.4 5.8zm-1.1 16.2h1.7L7.5 4.7H5.7z"],
  x: ["X", "M17.6 3h3.1l-6.8 7.7L22 21h-6.3l-4.9-6.4L5.2 21H2.1l7.3-8.3L1.8 3h6.4l4.4 5.8zm-1.1 16.2h1.7L7.5 4.7H5.7z"],
  youtube: ["YouTube", "M21.6 7.2a2.6 2.6 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4A2.6 2.6 0 0 0 2.4 7.2 27 27 0 0 0 2 12a27 27 0 0 0 .4 4.8 2.6 2.6 0 0 0 1.8 1.8c1.6.4 7.8.4 7.8.4s6.2 0 7.8-.4a2.6 2.6 0 0 0 1.8-1.8A27 27 0 0 0 22 12a27 27 0 0 0-.4-4.8zM10 15V9l5.2 3z"],
  tiktok: ["TikTok", "M16.6 3c.3 2.3 1.6 3.7 3.9 3.9v2.6a6.7 6.7 0 0 1-3.8-1.2v5.9c0 3.4-2.4 5.8-5.7 5.8a5.6 5.6 0 0 1-5.6-5.7c0-3.4 2.7-5.9 6.3-5.6v2.8c-1.8-.3-3.4.8-3.4 2.8 0 1.6 1.2 2.9 2.8 2.9 1.7 0 2.9-1.2 2.9-3.2V3z"],
  pinterest: ["Pinterest", "M12 2a10 10 0 0 0-3.6 19.3c-.1-.8-.2-2 0-2.9l1.2-5s-.3-.6-.3-1.5c0-1.4.8-2.5 1.8-2.5.9 0 1.3.7 1.3 1.5 0 .9-.6 2.2-.9 3.4-.2 1 .5 1.9 1.6 1.9 1.9 0 3.3-2 3.3-4.9 0-2.5-1.8-4.3-4.4-4.3-3 0-4.8 2.3-4.8 4.6 0 .9.4 1.9.8 2.4l.1.4-.3 1.2c0 .2-.2.3-.4.2-1.4-.6-2.2-2.7-2.2-4.3 0-3.5 2.5-6.7 7.3-6.7 3.8 0 6.8 2.7 6.8 6.4 0 3.8-2.4 6.9-5.8 6.9-1.1 0-2.2-.6-2.5-1.3l-.7 2.6c-.3 1-.9 2.2-1.4 2.9A10 10 0 1 0 12 2z"],
};

export function Socials({ socials, max = 4 }: { socials?: Record<string, string> | null; max?: number }) {
  const list = Object.entries(socials ?? {}).filter(([k, v]) => v && GLYPH[k.toLowerCase()] && /^https?:\/\//i.test(v)).slice(0, max);
  if (!list.length) return null;
  return (
    <span className="biz-soc" onClick={(e) => e.stopPropagation()}>
      {list.map(([k, v]) => {
        const [label, d] = GLYPH[k.toLowerCase()];
        return <a key={k} href={v} target="_blank" rel="noreferrer" aria-label={label} title={label}><svg viewBox="0 0 24 24" aria-hidden="true"><path d={d} fillRule="evenodd" /></svg></a>;
      })}
    </span>
  );
}

// A person (not a business): their own photo when they added one (Profile), else initials. Always round.
export function PersonAvatar({ name, photo, size = 28 }: { name: string | null; photo?: string | null; size?: number }) {
  const label = name || "?";
  const style = { width: size, height: size, fontSize: Math.round(size * 0.4) };
  // Only photos saved by Kestrel (data URLs checked by the database) are shown.
  if (photo && /^data:image\/(png|jpeg|webp);base64,/.test(photo)) {
    // eslint-disable-next-line @next/next/no-img-element
    return <span className="person-av photo" style={style} aria-hidden="true"><img src={photo} alt="" /></span>;
  }
  return <span className="person-av" style={{ ...style, background: toneOf(label) }} aria-hidden="true">{initials(label)}</span>;
}
