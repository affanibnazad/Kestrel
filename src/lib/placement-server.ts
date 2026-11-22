import "server-only";
import { promises as dns } from "node:dns";
import type { ImapFlow } from "imapflow";
import { imapClient } from "./mail-connect";
import { JUNK_NAME } from "./placement";

// Reads a test inbox and says where each placement-test email landed: Inbox, Promotions (Gmail tabs), Spam, or not found yet.
// Read-only: nothing is moved, marked or deleted.
export type SeedLogin = { email: string; provider: string; imap_host: string; imap_port: number; username: string; password: string };
export type SeedItem = { id: string; token: string; from: string; sent_at: string };
export type Found = { id: string; state: "inbox" | "promotions" | "spam" | "notfound" | "error"; folder?: string; detail?: string };

export const plainError = (e: unknown) => {
  const m = String((e as { response?: string; message?: string })?.response || (e as Error)?.message || e || "").replace(/\s+/g, " ").slice(0, 250);
  if (/auth|credentials|invalid login|LOGIN failed|AUTHENTICATIONFAILED/i.test(m)) return `Sign-in refused: check the address and app password. (${m})`;
  if (/ENOTFOUND|EAI_AGAIN|not found/i.test(m)) return `Server name not found: check the IMAP server. (${m})`;
  if (/ETIMEDOUT|timeout|ECONNREFUSED/i.test(m)) return `No answer from the server: check the IMAP server and port. (${m})`;
  return m;
};

export async function openSeed(seed: SeedLogin) {
  const client = await imapClient(seed, 25000);
  await client.connect();
  return client;
}

export async function junkFolder(client: ImapFlow) {
  const list = await client.list();
  return (list.find((f) => f.specialUse === "\\Junk") ?? list.find((f) => JUNK_NAME.test(f.path)))?.path ?? null;
}

export async function locate(seed: SeedLogin, items: SeedItem[]): Promise<Found[]> {
  if (!items.length) return [];
  let client: ImapFlow | null = null;
  const found = new Map<string, Found>();
  try {
    client = await openSeed(seed);
    const junk = await junkFolder(client);
    const gmail = client.capabilities.has("X-GM-EXT-1");
    const since = new Date(Math.min(...items.map((i) => Date.parse(i.sent_at))) - 86400000);
    const froms = [...new Set(items.map((i) => i.from.toLowerCase()))];
    for (const [folder, state] of [["INBOX", "inbox"], [junk, "spam"]] as [string | null, "inbox" | "spam"][]) {
      if (!folder) continue;
      const lock = await client.getMailboxLock(folder, { readOnly: true });
      try {
        const uids: number[] = [];
        for (const from of froms) {
          const r = await client.search({ from, since }, { uid: true });
          if (Array.isArray(r)) uids.push(...r);
        }
        if (!uids.length) continue;
        const msgs = await client.fetchAll([...new Set(uids)].sort((a, b) => a - b).slice(-200).join(","), { uid: true, envelope: true }, { uid: true });
        for (const m of msgs) {
          const mid = String(m.envelope?.messageId || "");
          for (const it of items) {
            if (found.has(it.id) || !mid.includes(it.token)) continue;
            let s: Found["state"] = state;
            // Gmail shows tabs only through its own search: is this inbox email in the Promotions tab?
            if (state === "inbox" && gmail) {
              const promo = await client.search({ uid: String(m.uid), gmraw: "category:promotions" }, { uid: true }).catch(() => false);
              if (Array.isArray(promo) && promo.length) s = "promotions";
            }
            found.set(it.id, { id: it.id, state: s, folder });
          }
        }
      } finally { lock.release(); }
    }
  } catch (e) {
    const detail = plainError(e);
    return items.map((i) => found.get(i.id) ?? { id: i.id, state: "error", detail });
  } finally { if (client) { try { await client.logout(); } catch { /* already closed */ } } }
  return items.map((i) => found.get(i.id) ?? { id: i.id, state: "notfound" });
}

// Ownership: a test inbox must be the address's real inbox. The IMAP sign-in name must be the address itself, and the IMAP server
// must belong to the address's email provider (found from the domain's MX records) or to the domain itself. So a stranger's address
// can only be "connected" with that stranger's own password, never with a server or account someone else controls.
const FAMILIES: { mx: RegExp; imap: RegExp }[] = [
  { mx: /(^|\.)(google\.com|googlemail\.com)$/, imap: /^imap\.gmail\.com$/ },
  { mx: /(^|\.)(yahoodns\.net|yahoo\.com)$/, imap: /^imap\.mail\.yahoo\.com$/ },
  { mx: /(^|\.)(icloud\.com|me\.com)$/, imap: /^imap\.mail\.me\.com$/ },
  { mx: /(^|\.)(zoho\.(com|eu|in|com\.au|jp)|zohomail\.(com|eu|in))$/, imap: /^imap(pro)?\.zoho\.(com|eu|in|com\.au|jp)$/ },
  { mx: /(^|\.)hostinger\.com$/, imap: /^imap\.hostinger\.com$/ },
  { mx: /(^|\.)titan\.email$/, imap: /^imap\.titan\.email$/ },
  { mx: /(^|\.)secureserver\.net$/, imap: /^imap\.secureserver\.net$/ },
  { mx: /(^|\.)messagingengine\.com$/, imap: /^imap\.fastmail\.com$/ },
  { mx: /(^|\.)gmx\.(net|com|de)$/, imap: /^imap\.gmx\.(net|com)$/ },
];
// Outlook / Hotmail / Microsoft 365 addresses are not offered as test inboxes (Affan, 13 Nov 2026): Microsoft is ending
// password (IMAP) sign-in, so these could not be read reliably. Sending from Microsoft 365 email accounts is unchanged.
const MICROSOFT_MX = /(^|\.)(outlook\.com|hotmail\.com|office365\.us)$/;
// Is `host` the name itself or a server under it? Exact label match, never a shared suffix.
const under = (host: string, name: string) => host === name || host.endsWith(`.${name}`);
export async function inboxBelongs(seed: Pick<SeedLogin, "email" | "imap_host" | "username">): Promise<string | null> {
  const email = seed.email.toLowerCase(), host = seed.imap_host.toLowerCase();
  if (seed.username.trim().toLowerCase() !== email) return "The sign-in name must be the inbox's own email address.";
  const domain = email.split("@")[1] ?? "";
  const mx = (await Promise.race([dns.resolveMx(domain), new Promise<never>((_, no) => setTimeout(() => no(new Error("timeout")), 5000))]).catch(() => [])).map((m) => m.exchange.toLowerCase());
  if (!mx.length) return `${domain} has no mail server (MX), so it cannot receive test emails.`;
  if (mx.some((m) => MICROSOFT_MX.test(m.replace(/\.$/, "")))) return "Outlook, Hotmail and Microsoft 365 inboxes cannot be used as test inboxes. Use Gmail, Yahoo, iCloud or Zoho.";
  const family = FAMILIES.find((f) => mx.some((m) => f.mx.test(m)));
  if (family) return family.imap.test(host) ? null : `${email} is handled by a different provider than ${host}. Choose the right provider for this address.`;
  // Otherwise the server must be under the address's own domain, or exactly one of its MX servers. No guessing at shared endings.
  const ok = under(host, domain) || mx.some((m) => host === m.replace(/\.$/, ""));
  return ok ? null : `${host} is not the mail server of ${domain}. Use the IMAP server of this address's own email provider.`;
}
