import "server-only";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_KEY, SUPABASE_URL } from "./supabase/config";

// "Sign in with Google" for email accounts (database 048). Google's own OAuth 2.0 for web servers with PKCE:
// start → Google's consent page → callback with a one-time code → exchange it (with Kestrel's client secret, on the server)
// for a refresh token → kept in Vault as the account's secret ("oauth2:google:<token>"). Before each SMTP/IMAP login the
// connector turns it into a one-hour access token (XOAUTH2). Scope https://mail.google.com/ is the only Gmail scope that
// allows both sending (SMTP) and reading replies (IMAP).
export const GOOGLE_PREFIX = "oauth2:google:";
export const GOOGLE_COOKIE = "kst_gmail_oauth";   // the signed sign-in state, read only by the callback
export const GMAIL_HOSTS = new Set(["smtp.gmail.com", "imap.gmail.com"]);
const SCOPE = "openid email https://mail.google.com/";
const AUTH = "https://accounts.google.com/o/oauth2/v2/auth", TOKEN = "https://oauth2.googleapis.com/token";

const server = () => process.env.MAIL_SERVER_SECRET || "";
export async function googleClient(): Promise<{ client_id: string; client_secret: string } | null> {
  if (server().length < 32) return null;
  const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await sb.rpc("google_mail_client", { server_secret: server() });
  const c = data as { client_id?: string; client_secret?: string } | null;
  return error || !c?.client_id || !c.client_secret ? null : { client_id: c.client_id, client_secret: c.client_secret };
}

// ---------- the sign-in round trip. The state, PKCE verifier and who started it travel in a short-lived signed cookie.
const b64 = (b: Buffer) => b.toString("base64url");
const sign = (text: string) => b64(createHmac("sha256", server()).update(text).digest());
export type Pending = { state: string; verifier: string; user: string; team: string; back: string; exp: number };
export function newPending(user: string, team: string, back: string): { pending: Pending; cookie: string; challenge: string } {
  const pending: Pending = { state: b64(randomBytes(24)), verifier: b64(randomBytes(48)), user, team, back, exp: Date.now() + 10 * 60_000 };
  const body = b64(Buffer.from(JSON.stringify(pending)));
  return { pending, cookie: `${body}.${sign(body)}`, challenge: b64(createHash("sha256").update(pending.verifier).digest()) };
}
export function readPending(cookie: string | undefined): Pending | null {
  if (!cookie || server().length < 32) return null;
  const [body, mac] = cookie.split(".");
  if (!body || !mac) return null;
  const want = Buffer.from(sign(body)), got = Buffer.from(mac);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try { const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Pending; return p.exp > Date.now() ? p : null; } catch { return null; }
}
export function authUrl(clientId: string, redirect: string, state: string, challenge: string, hint?: string) {
  const u = new URL(AUTH);
  u.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirect, response_type: "code", scope: SCOPE, access_type: "offline",
    prompt: "consent", include_granted_scopes: "true", state, code_challenge: challenge, code_challenge_method: "S256", ...(hint ? { login_hint: hint } : {}) }).toString();
  return u.toString();
}

// The one-time code → refresh token and the signed-in Google address (from the ID token Google just sent over TLS).
export async function exchangeCode(c: { client_id: string; client_secret: string }, code: string, verifier: string, redirect: string) {
  const res = await fetch(TOKEN, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, signal: AbortSignal.timeout(15000),
    body: new URLSearchParams({ code, client_id: c.client_id, client_secret: c.client_secret, redirect_uri: redirect, grant_type: "authorization_code", code_verifier: verifier }) });
  const j = (await res.json().catch(() => ({}))) as { refresh_token?: string; access_token?: string; id_token?: string; scope?: string; error?: string };
  if (!res.ok || !j.access_token) throw new Error(j.error === "invalid_client" ? "Kestrel's Google client ID or secret is wrong (Owner → Google sign-in)." : "Google did not accept the sign-in. Try again.");
  if (!String(j.scope || "").split(" ").includes("https://mail.google.com/")) throw new Error("Tick the box that lets Kestrel read, compose and send your email, then try again.");
  let email = "", verified = false;
  try { const p = JSON.parse(Buffer.from(String(j.id_token).split(".")[1], "base64url").toString("utf8")) as { email?: string; email_verified?: boolean }; email = String(p.email || "").toLowerCase(); verified = p.email_verified === true; } catch { /* checked below */ }
  if (!email || !verified) throw new Error("Google did not give a confirmed email address.");
  if (!j.refresh_token) throw new Error("Google did not give Kestrel lasting access. Open myaccount.google.com/permissions, remove Kestrel, and sign in again.");
  return { email, refresh: j.refresh_token, access: j.access_token };
}

// ---------- access tokens for SMTP / IMAP (cached a little under an hour per account, in this server instance)
const cache = new Map<string, { token: string; until: number }>();
export async function accessToken(refresh: string): Promise<string> {
  const key = createHash("sha256").update(refresh).digest("hex");
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.token;
  const c = await googleClient();
  if (!c) throw new Error("Sign in with Google is not set up on Kestrel (Owner → Google sign-in).");
  const res = await fetch(TOKEN, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, signal: AbortSignal.timeout(15000),
    body: new URLSearchParams({ client_id: c.client_id, client_secret: c.client_secret, refresh_token: refresh, grant_type: "refresh_token" }) });
  const j = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !j.access_token) {
    throw new Error(j.error === "invalid_grant" ? "The Google sign-in for this email account has expired or was removed. Click Sign in with Google again in Email accounts."
      : "Google did not renew access for this email account just now. It is tried again later.");
  }
  cache.set(key, { token: j.access_token, until: Date.now() + Math.max(60, (j.expires_in ?? 3600) - 300) * 1000 });
  return j.access_token;
}
