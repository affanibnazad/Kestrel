// Kestrel Mail: mailbox presets and shared types. The App page and the server both use these.

export type Mailbox = {
  id: string; email: string; from_name: string; provider: string; smtp_host: string; smtp_port: number; imap_host: string | null; imap_port: number | null;
  username: string; daily_limit: number; signature: string; status: "new" | "ok" | "error" | "paused"; last_error: string | null;
  smtp_ok: boolean | null; imap_ok: boolean | null; tested_at: string | null; created_at: string;
};
export const MAILBOX_COLUMNS = "id,email,from_name,provider,smtp_host,smtp_port,imap_host,imap_port,username,daily_limit,signature,status,last_error,smtp_ok,imap_ok,tested_at,created_at";

// Settings each provider publishes for SMTP and IMAP. "help" says where to make an app password (shown in a ? tip).
export const PROVIDERS: { id: string; name: string; smtp: [string, number]; imap: [string, number]; help: string }[] = [
  { id: "google", name: "Google Workspace / Gmail", smtp: ["smtp.gmail.com", 465], imap: ["imap.gmail.com", 993],
    help: "Turn on 2-Step Verification for this Google account, then make an app password at myaccount.google.com/apppasswords. Paste that 16-letter password here, not your normal password." },
  { id: "microsoft", name: "Microsoft 365 / Outlook", smtp: ["smtp.office365.com", 587], imap: ["outlook.office365.com", 993],
    help: "Your Microsoft 365 admin must allow 'Authenticated SMTP' for this mailbox (admin center → user → Mail → Manage email apps). With 2-step sign-in on, make an app password at account.microsoft.com/security." },
  { id: "zoho", name: "Zoho Mail", smtp: ["smtp.zoho.com", 465], imap: ["imap.zoho.com", 993],
    help: "In Zoho Mail: Settings → Mail Accounts → IMAP access on. Make an app password in accounts.zoho.com → Security → App Passwords. EU accounts use smtp.zoho.eu and imap.zoho.eu." },
  { id: "hostinger", name: "Hostinger", smtp: ["smtp.hostinger.com", 465], imap: ["imap.hostinger.com", 993],
    help: "Use the mailbox password from Hostinger → Emails → your domain → Email accounts." },
  { id: "other", name: "Other (any provider)", smtp: ["", 465], imap: ["", 993],
    help: "Ask your email provider (for example Mithmill) for the SMTP and IMAP server names and ports. Port 465 or 587 for sending, 993 for reading." },
];

// Class rule: 25 emails a day per inbox, follow-ups included. Above that the App warns.
export const SAFE_DAILY = 25;

// ---------- Email accounts page (Mail Pro): today's numbers per mailbox, DNS checks, and a simple health score.
export type MailboxToday = { id: string; warm: boolean; limit_today: number; sent_24h: number; bounce_rate_7d: number };
export type DnsCheck = { name: string; ok: boolean | null; detail: string; fix?: string };
// 0–100, Kestrel's own estimate (not a provider's score): a broken login is 0; bounces and red DNS
// records take points off. null while there is nothing to judge yet.
export function healthScore(x: { status: Mailbox["status"]; today?: MailboxToday; dns?: DnsCheck[]; listed?: boolean }): number | null {
  if (x.status === "error") return 0;
  if (!x.today && !x.dns && !x.listed) return null;
  let s = 100;
  if (x.listed) s -= 60;   // the domain is on a public blacklist (Spam Guard B)
  if (x.today) s -= Math.min(40, Math.round(x.today.bounce_rate_7d * 8));
  for (const c of x.dns ?? []) if (c.ok === false) s -= 10;
  return Math.max(0, Math.min(100, s));
}

