import "server-only";
import nodemailer from "nodemailer";
import { ImapFlow } from "imapflow";
import { vetHost } from "./net";
import { GMAIL_HOSTS, GOOGLE_PREFIX, accessToken } from "./google-mail";

// Every connection Kestrel makes to an email server (sending by SMTP, reading by IMAP) goes through here, so all of them:
// - only reach public internet servers: the name is looked up once, every address must be public, and Kestrel connects to that
//   checked address with `servername` set, so TLS still checks the real certificate (no private or internal addresses);
// - never send a password unencrypted: SMTP needs TLS on every port except 465 (already TLS); IMAP on 143 must use STARTTLS;
// - accounts connected with "Sign in with Google" (database 048) log in with a fresh Google access token (XOAUTH2), and only
//   ever to Gmail's own servers: a Google token is never sent anywhere else.
type SmtpLogin = { smtp_host: string; smtp_port: number; username: string; password: string };
type ImapLogin = { imap_host: string | null; imap_port: number | null; username: string; password: string };
const TIMEOUTS = { connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 20000 };

// The login to use: a password, or (Google sign-in) an access token, checked against the server it is for.
async function loginFor(host: string, user: string, secret: string) {
  if (!secret.startsWith(GOOGLE_PREFIX)) return { kind: "password" as const, user, pass: secret };
  if (!GMAIL_HOSTS.has(host.toLowerCase())) throw new Error("This email account uses Sign in with Google, so it can only connect to Gmail's servers.");
  return { kind: "google" as const, user, token: await accessToken(secret.slice(GOOGLE_PREFIX.length)) };
}

export async function smtpTransport(b: SmtpLogin) {
  const login = await loginFor(b.smtp_host, b.username, b.password);
  const v = await vetHost(b.smtp_host);
  return nodemailer.createTransport({ host: v.address, servername: v.servername, port: b.smtp_port, secure: b.smtp_port === 465, requireTLS: b.smtp_port !== 465,
    auth: login.kind === "google" ? { type: "OAuth2", user: login.user, accessToken: login.token } : { user: login.user, pass: login.pass }, ...TIMEOUTS });
}

export async function imapClient(b: ImapLogin, socketTimeout = 20000) {
  if (!b.imap_host) throw new Error("This email account has no IMAP (reading) settings.");
  const login = await loginFor(b.imap_host, b.username, b.password);
  const v = await vetHost(b.imap_host);
  const port = b.imap_port || 993;
  const connectTimeout = Math.min(12000, socketTimeout);
  const client = new ImapFlow({
    host: v.address,
    servername: v.servername,
    port,
    secure: port === 993,
    doSTARTTLS: port === 993 ? undefined : true,
    auth: login.kind === "google" ? { user: login.user, accessToken: login.token } : { user: login.user, pass: login.pass },
    logger: false,
    connectionTimeout: connectTimeout,
    greetingTimeout: connectTimeout,
    socketTimeout,
  });
  // ImapFlow emits 'error' on async socket timeouts/resets; without a listener Node throws an uncaught exception.
  client.on("error", () => {});
  return client;
}
