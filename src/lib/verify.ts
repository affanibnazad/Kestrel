// Email verifier, part 1: checks that need no mail server (pure, shared by the server route and tests).
// Part 2 (Affan's own SMTP verifier, quarry-cloud/public/verifier) and Hunter then confirm whether the mailbox exists.
// Design: docs/superpowers/specs/2026-11-14-email-verifier-design.md

export type EmailStatus = "valid" | "invalid" | "risky";
export type CheckBy = "format" | "dns" | "server" | "hunter";
export type EmailCheck = { status: EmailStatus; reason: string; by: CheckBy; role?: boolean; free?: boolean; suggest?: string; catchAll?: boolean };

export const STATUS_NAME: Record<EmailStatus, string> = { valid: "Valid", invalid: "Invalid", risky: "Risky" };
export const STATUS_TONE: Record<EmailStatus, string> = { valid: "good", invalid: "no", risky: "maybe" };

const EMAIL = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

// Common misspellings of the big providers (the domain part only).
const TYPOS: Record<string, string> = {
  "gmial.com": "gmail.com", "gmai.com": "gmail.com", "gamil.com": "gmail.com", "gnail.com": "gmail.com", "gmail.co": "gmail.com", "gmail.con": "gmail.com",
  "gmail.cm": "gmail.com", "gmaill.com": "gmail.com", "gmal.com": "gmail.com", "gmail.om": "gmail.com", "gmali.com": "gmail.com", "gmail.cmo": "gmail.com",
  "hotmial.com": "hotmail.com", "hotmal.com": "hotmail.com", "hotmai.com": "hotmail.com", "hotmail.co": "hotmail.com", "hotmail.con": "hotmail.com", "hotamil.com": "hotmail.com",
  "yahooo.com": "yahoo.com", "yaho.com": "yahoo.com", "yahoo.co": "yahoo.com", "yahoo.con": "yahoo.com", "yhoo.com": "yahoo.com",
  "outlok.com": "outlook.com", "outllok.com": "outlook.com", "outlook.co": "outlook.com", "outlook.con": "outlook.com", "otlook.com": "outlook.com",
  "iclod.com": "icloud.com", "icloud.co": "icloud.com", "icoud.com": "icloud.com", "iclould.com": "icloud.com",
};
// Throwaway inboxes: never a real business contact.
const DISPOSABLE = new Set(["mailinator.com", "guerrillamail.com", "guerrillamail.net", "sharklasers.com", "10minutemail.com", "10minutemail.net", "tempmail.com", "temp-mail.org",
  "tempmailo.com", "yopmail.com", "yopmail.net", "trashmail.com", "getnada.com", "nada.email", "dispostable.com", "maildrop.cc", "mintemail.com", "throwawaymail.com", "fakeinbox.com",
  "mohmal.com", "emailondeck.com", "spamgourmet.com", "mailnesia.com", "mailcatch.com", "tempinbox.com", "burnermail.io", "moakt.com", "tmail.ws", "tempr.email", "discard.email",
  "mytemp.email", "inboxkitten.com", "emailfake.com", "fakemail.net", "mailpoof.com", "33mail.com", "spambox.us", "wegwerfmail.de", "trash-mail.com", "luxusmail.org"]);
// Shared inboxes (not a person): fine to email, but replies are rarer.
const ROLE = new Set(["info", "hello", "hi", "contact", "contactus", "support", "help", "sales", "admin", "office", "team", "enquiries", "enquiry", "inquiries", "inquiry", "mail",
  "billing", "accounts", "hr", "jobs", "careers", "marketing", "press", "media", "studio", "booking", "bookings", "reception", "service", "customerservice", "webmaster", "noreply",
  "no-reply", "donotreply", "orders", "events", "general", "management", "projects", "partnerships"]);
const FREE = new Set(["gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk", "ymail.com", "hotmail.com", "hotmail.co.uk", "outlook.com", "live.com", "msn.com", "icloud.com",
  "me.com", "mac.com", "aol.com", "proton.me", "protonmail.com", "gmx.com", "gmx.net", "gmx.de", "yandex.com", "mail.com", "zoho.com"]);
// Addresses that are never someone's inbox.
const NEVER = /^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|abuse)$/;

export const normalEmail = (email: unknown) => String(email ?? "").trim().toLowerCase().replace(/^mailto:/, "");

// Part 1. Returns a final answer ("invalid") or the flags and null status when the address still needs a mailbox check.
export function precheck(raw: unknown): { status: "invalid" | null; reason: string; role: boolean; free: boolean; suggest?: string; domain: string } {
  const email = normalEmail(raw);
  const [local = "", domain = ""] = email.split("@");
  const base = { role: ROLE.has(local), free: FREE.has(domain), domain };
  if (!email || email.length > 254 || local.length > 64 || !EMAIL.test(email) || local.startsWith(".") || local.endsWith(".") || local.includes("..")) {
    return { ...base, status: "invalid", reason: "Not a valid email address" };
  }
  if (TYPOS[domain]) return { ...base, status: "invalid", reason: `Typo in the domain: probably ${local}@${TYPOS[domain]}`, suggest: `${local}@${TYPOS[domain]}` };
  if (DISPOSABLE.has(domain)) return { ...base, status: "invalid", reason: "A throwaway (disposable) inbox" };
  if (NEVER.test(local)) return { ...base, status: "invalid", reason: "An address nobody reads (no-reply or system)" };
  return { ...base, status: null, reason: "" };
}

// Hunter's email-verifier answer → a Kestrel label (https://hunter.io/api-documentation/v2#email-verifier).
export function fromHunter(answer: unknown): { status: EmailStatus; reason: string } | null {
  const d = (answer as { data?: { status?: string; result?: string } })?.data;
  const st = String(d?.status || "");
  if (st === "valid") return { status: "valid", reason: "Hunter: the mailbox exists" };
  if (st === "invalid") return { status: "invalid", reason: "Hunter: no such mailbox" };
  if (st === "disposable") return { status: "invalid", reason: "Hunter: a throwaway inbox" };
  if (st === "accept_all") return { status: "risky", reason: "Hunter: the server accepts every address (catch-all)" };
  if (st === "webmail") return { status: "risky", reason: "Hunter: a webmail address it cannot confirm" };
  if (st === "unknown") return { status: "risky", reason: "Hunter: the server would not say" };
  return null;
}
