// Kestrel Spam Guard, part C: inbox placement tests (like Smartlead SmartDelivery and Instantly placement tests).
// Pure, shared by the App and the server: test inbox providers, result names, and the report numbers.

export type SeedProvider = { id: "gmail" | "yahoo" | "icloud" | "zoho" | "other"; name: string; imap: [string, number]; help: string };
export const SEED_PROVIDERS: SeedProvider[] = [
  { id: "gmail", name: "Gmail", imap: ["imap.gmail.com", 993], help: "Turn on 2-Step Verification, then Google Account → Security → App passwords → create one for Kestrel." },
  { id: "yahoo", name: "Yahoo", imap: ["imap.mail.yahoo.com", 993], help: "Yahoo Account security → Generate app password." },
  { id: "icloud", name: "iCloud", imap: ["imap.mail.me.com", 993], help: "appleid.apple.com → Sign-In and Security → App-Specific Passwords." },
  { id: "zoho", name: "Zoho", imap: ["imap.zoho.com", 993], help: "Zoho Mail → Settings → Security → App passwords. IMAP must be on." },
  { id: "other", name: "Other", imap: ["", 993], help: "Ask your email provider for the IMAP server and an app password." },
];
export const seedProvider = (id: string | null | undefined) => SEED_PROVIDERS.find((p) => p.id === id) ?? SEED_PROVIDERS[SEED_PROVIDERS.length - 1];

export type Placement = "queued" | "sent" | "inbox" | "promotions" | "spam" | "missing" | "failed";
export const PLACEMENT: Record<Placement, [string, string]> = {
  queued: ["Waiting", "maybe"], sent: ["Checking", "maybe"], inbox: ["Inbox", "good"], promotions: ["Promotions", "maybe"],
  spam: ["Spam", "no"], missing: ["Not arrived", "no"], failed: ["Not sent", "dnc"],
};
export type TestStatus = "sending" | "checking" | "done" | "cancelled";
export const TEST_STATUS: Record<TestStatus, string> = { sending: "Sending", checking: "Checking inboxes", done: "Done", cancelled: "Stopped" };

export type Seed = { id: string; email: string; provider: string; imap_host: string; imap_port: number; username: string; status: "new" | "ok" | "error"; last_error: string | null; tested_at: string | null };
export type PlacementTest = { id: string; created_at: string; status: TestStatus; scheduled: boolean; subject: string; body: string; finished_at: string | null;
  total: number; inbox: number; promotions: number; spam: number; missing: number; paused: number };
export type PlacementResult = { id: string; test_id: string; mailbox_id: string | null; seed_id: string | null; from_email: string; seed_email: string; seed_provider: string;
  state: Placement; folder: string | null; detail: string | null };

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

// Numbers for one test: the share that reached the main inbox, promotions, spam, or did not arrive; per provider and per account.
export function summarize(results: PlacementResult[]) {
  const done = results.filter((r) => r.state !== "queued" && r.state !== "sent");
  const count = (list: PlacementResult[], s: Placement | Placement[]) => list.filter((r) => (Array.isArray(s) ? s : [s]).includes(r.state)).length;
  const block = (list: PlacementResult[]) => {
    const d = list.filter((r) => r.state !== "queued" && r.state !== "sent");
    return { total: list.length, done: d.length, inbox: pct(count(d, "inbox"), d.length), promotions: pct(count(d, "promotions"), d.length),
      spam: pct(count(d, "spam"), d.length), missing: pct(count(d, ["missing", "failed"]), d.length) };
  };
  const group = (key: (r: PlacementResult) => string) => [...new Set(results.map(key))].map((k) => ({ key: k, ...block(results.filter((r) => key(r) === k)) }));
  return { ...block(results), finished: done.length === results.length && results.length > 0, providers: group((r) => r.seed_provider), accounts: group((r) => r.from_email) };
}
export type Summary = ReturnType<typeof summarize>;

// One plain sentence on what to do next.
export function advice(s: Pick<Summary, "inbox" | "promotions" | "spam" | "missing" | "done">) {
  if (!s.done) return "Results come in over the next few minutes.";
  if (s.spam >= 30) return "Too much spam: pause these accounts, check Domain health and blacklists, lower their daily limit for a while, and send a shorter plain email without links. Then test again.";
  if (s.missing >= 30) return "Many emails did not arrive: they may be blocked. Check the accounts' sign-in, SPF/DKIM/DMARC and blacklists.";
  if (s.promotions >= 30) return "Many emails went to Promotions: remove links and images, write like a person, and keep it short.";
  if (s.inbox >= 80) return "Good: most emails reached the inbox. Keep volumes low and test again every week.";
  return "Mixed: fix the accounts that landed in spam first (open each one below), then test again.";
}

// Which IMAP folder name means spam, when the server does not mark it.
export const JUNK_NAME = /(^|[/.])(spam|junk|junk e-?mail|junk mail|bulk|bulk mail|courrier ind[eé]sirable|spam-?verdacht)$/i;
