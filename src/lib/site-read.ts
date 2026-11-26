import "server-only";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import { lookup as lookupCb, type LookupAddress } from "node:dns";
import { isPublicIP } from "./net";

// The Research bot reads a lead's own website (Phase 4B, 19 Nov 2026). Websites are other people's servers and other
// people's text, so: http(s) on port 80/443 only, no password in the address, every address the name points to must be
// a public internet address (checked inside the connection's own lookup, so the checked address is the one used),
// at most 3 redirects (each checked again), 8 seconds, 600 KB, HTML only. The text is information for the AI, never
// instructions, and email addresses and phone numbers are removed before the AI sees it.
const MAX_BYTES = 600_000, TIMEOUT_MS = 8_000, MAX_REDIRECTS = 3;

function guardedLookup(name: string, opts: { all?: boolean }, cb: (err: Error | null, address: string | LookupAddress[], family?: number) => void) {
  lookupCb(name, { all: true, verbatim: true }, (err, list) => {
    const addrs = (list ?? []) as LookupAddress[];
    if (err || !addrs.length) return cb(err ?? new Error("not found"), "", 4);
    if (!addrs.every((a) => isPublicIP(a.address))) return cb(new Error("not a public internet server"), "", 4);
    const a = addrs.find((x) => x.family === 4) ?? addrs[0];
    return opts?.all ? cb(null, [a]) : cb(null, a.address, a.family);
  });
}

export function siteUrl(raw: string): URL | null {
  const s = String(raw || "").trim();
  if (!s || s.length > 500) return null;
  let u: URL;
  try { u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`); } catch { return null; }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password) return null;
  if (u.port && !["80", "443"].includes(u.port)) return null;
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) ? !isPublicIP(host) : !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host)) return null;
  return u;
}

function getOnce(u: URL): Promise<{ status: number; location?: string; type: string; body: string }> {
  const lib = u.protocol === "http:" ? http : https;
  return new Promise((resolve, reject) => {
    const req = lib.request({
      hostname: u.hostname.replace(/^\[|\]$/g, ""), port: u.port || (u.protocol === "http:" ? 80 : 443), path: `${u.pathname}${u.search}`, method: "GET",
      timeout: TIMEOUT_MS, lookup: guardedLookup as never,
      headers: { "user-agent": "Mozilla/5.0 (compatible; KestrelResearch/1.0; +https://kestrelleads.com)", accept: "text/html,application/xhtml+xml", "accept-language": "en" },
    }, (res) => {
      const status = res.statusCode ?? 0, type = String(res.headers["content-type"] ?? "");
      if (status >= 300 && status < 400) { res.resume(); return resolve({ status, location: String(res.headers.location ?? ""), type, body: "" }); }
      if (!/text\/html|application\/xhtml/i.test(type)) { res.resume(); return resolve({ status, type, body: "" }); }
      const chunks: Buffer[] = []; let n = 0;
      res.on("data", (c: Buffer) => { n += c.length; if (n <= MAX_BYTES) chunks.push(c); else req.destroy(); });
      res.on("end", () => resolve({ status, type, body: Buffer.concat(chunks).toString("utf8") }));
      res.on("close", () => resolve({ status, type, body: Buffer.concat(chunks).toString("utf8") }));
    });
    const all = setTimeout(() => req.destroy(new Error("timeout")), TIMEOUT_MS + 2_000);
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", (e) => { clearTimeout(all); reject(e); });
    req.on("close", () => clearTimeout(all));
    req.end();
  });
}

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", ndash: "–", mdash: "—", hellip: "…" };
const decode = (s: string) => s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
  if (e[0] === "#") { const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return n > 31 && n < 0x110000 ? String.fromCodePoint(n) : " "; }
  return ENT[e.toLowerCase()] ?? m;
});
// Removes emails and phone numbers: the AI never sees them (same rule as every other lead detail Kestrel sends to AI).
export const scrub = (s: string) => s.replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, " ").replace(/\+?\d[\d\s().-]{7,}\d/g, " ");

// The readable part of a page: title, description, headings, then the visible text, at most ~3,500 characters.
export function pageText(html: string): string {
  const h = html.replace(/<!--[\s\S]*?-->/g, " ");
  const title = decode(h.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").trim();
  const meta = (name: string) => decode(h.match(new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*content=["']([^"']*)["']`, "i"))?.[1]
    ?? h.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:name|property)=["']${name}["']`, "i"))?.[1] ?? "").trim();
  const desc = meta("description") || meta("og:description");
  const body = h.replace(/<(script|style|noscript|svg|template|iframe|head)[\s\S]*?<\/\1>/gi, " ");
  const heads = [...body.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)].map((m) => decode(m[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 12);
  const text = decode(body.replace(/<br\s*\/?>|<\/(p|div|li|section|article|h\d)>/gi, "\n").replace(/<[^>]+>/g, " ")).replace(/[ \t\f\v\r]+/g, " ").replace(/\n\s*/g, "\n").replace(/\n{2,}/g, "\n").trim();
  const out = [title && `Title: ${title}`, desc && `Description: ${desc}`, heads.length ? `Headings: ${heads.join(" | ")}` : "", `Text: ${text}`].filter(Boolean).join("\n");
  return scrub(out).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").slice(0, 3_500);
}

const TEAM_LINK_RE = /<a\b[^>]+href=["']([^"'#?]+)["'][^>]*>/gi;
const TEAM_PATH_RE = /^\/?(about|about-us|team|our-team|company|leadership|founders?)(\/|$)/i;

function findTeamUrl(html: string, base: URL): URL | null {
  for (const m of html.matchAll(TEAM_LINK_RE)) {
    const href = m[1]?.trim();
    if (!href) continue;
    try {
      const candidate = new URL(href, base);
      if (candidate.hostname !== base.hostname || candidate.pathname === base.pathname) continue;
      if (TEAM_PATH_RE.test(candidate.pathname.replace(/^\//, ""))) {
        return siteUrl(candidate.href);
      }
    } catch { /* ignore invalid href */ }
  }
  return null;
}

async function fetchHtml(start: URL): Promise<{ body: string; finalUrl: URL } | { error: string }> {
  let u = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let r: Awaited<ReturnType<typeof getOnce>>;
    try { r = await getOnce(u); } catch { return { error: "website could not be read" }; }
    if (r.status >= 300 && r.status < 400 && r.location) {
      let next: URL | null = null;
      try { next = siteUrl(new URL(r.location, u).href); } catch { next = null; }
      if (!next) return { error: "website moved somewhere Kestrel does not read" };
      u = next; continue;
    }
    if (r.status >= 400 || !r.body) return { error: r.status >= 400 ? `website answered ${r.status}` : "website is not a web page" };
    return { body: r.body, finalUrl: u };
  }
  return { error: "website moved too many times" };
}

export async function readSite(raw: string): Promise<{ text: string; host: string } | { error: string }> {
  const u = siteUrl(raw);
  if (!u) return { error: "no usable website" };
  const main = await fetchHtml(u);
  if ("error" in main) return main;
  const text = pageText(main.body);
  if (text.replace(/^(Title|Description|Headings|Text):/gm, "").trim().length < 80) return { error: "website has too little text" };

  // Fetch at most one about/team subpage on the same host when linked, so Research can find named team members.
  const teamUrl = findTeamUrl(main.body, main.finalUrl);
  let combined = text;
  if (teamUrl) {
    const sub = await fetchHtml(teamUrl).catch(() => null);
    if (sub && !("error" in sub)) {
      const subText = pageText(sub.body).slice(0, 2_000);
      if (subText.replace(/^(Title|Description|Headings|Text):/gm, "").trim().length >= 80) {
        combined = `${text}\n--- ${teamUrl.pathname} ---\n${subText}`.slice(0, 5_500);
      }
    }
  }
  return { text: combined, host: main.finalUrl.hostname.replace(/^www\./, "") };
}
