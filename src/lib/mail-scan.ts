import type { ImapFlow } from "imapflow";
import type { InboxItem } from "./campaign";

export type ImapLike = Pick<ImapFlow, "connect" | "mailboxOpen" | "search" | "fetchAll" | "logout" | "close"> & {
  on?: (event: string, listener: (err: unknown) => void) => unknown;
};

export type ScanLogin = {
  email: string;
  imap_host: string | null;
  imap_port: number | null;
  username: string;
  password: string;
};

export type ScanBox = ScanLogin & {
  id: string;
  scan_uid: number | null;
  scan_validity: string | null;
  since: string | null;
};

export type ScanRpc = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data?: unknown; error: unknown }>;
};

export const plainMailError = (e: unknown) =>
  String((e as { response?: string; message?: string })?.response || (e as Error)?.message || e || "")
    .replace(/\s+/g, " ")
    .slice(0, 300);

/**
 * Runs an IMAP operation with a hard timeout and safe socket cleanup.
 * Attaches an error listener so async ImapFlow socket timeouts never crash the process,
 * and closes the underlying socket immediately if the timeout fires.
 */
export async function withImapClient<T>(
  createClient: () => Promise<ImapLike>,
  fn: (client: ImapLike) => Promise<T>,
  timeoutMs: number,
  timeoutMessage: string
): Promise<T> {
  let client = null as ImapLike | null;
  let lastAsyncErr: unknown = null;
  let timer: NodeJS.Timeout | undefined;
  let timedOut = false;

  const work = (async () => {
    const created = await createClient();
    client = created;
    if (typeof created.on === "function") {
      created.on("error", (err) => {
        lastAsyncErr = err;
      });
    }
    return await fn(created);
  })();

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      try {
        client?.close();
      } catch {
        // already closed
      }
      reject(new Error(timeoutMessage));
    }, timeoutMs);
  });

  try {
    return await Promise.race([work, timeout]);
  } catch (err) {
    if (!timedOut && lastAsyncErr && !err) {
      throw lastAsyncErr;
    }
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
    if (client) {
      const c = client;
      try {
        await Promise.race([
          Promise.resolve(c.logout()).catch(() => {}),
          new Promise((r) => setTimeout(r, 1000)),
        ]);
      } catch {
        // ignore logout failure
      }
      try {
        c.close();
      } catch {
        // already closed
      }
    }
  }
}

/**
 * Scans one mailbox for new replies/bounces/opt-outs since its last UID.
 * Caps fresh initial batches at 40 messages so Gmail mailboxes advance steadily without timing out.
 */
export async function scanOneMailbox(
  b: ScanBox,
  opts: {
    createClient: (b: ScanBox, socketTimeoutMs: number) => Promise<ImapLike>;
    readMessages: (client: ImapLike, uids: number[], mailbox: string) => Promise<InboxItem[]>;
    timeoutMs?: number;
  }
) {
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const socketTimeoutMs = Math.max(5_000, timeoutMs - 3_000);
  return await withImapClient(
    () => opts.createClient(b, socketTimeoutMs),
    async (client) => {
      await client.connect();
      const box = await client.mailboxOpen("INBOX", { readOnly: true });
      const validity = String(box.uidValidity ?? "");
      const fresh = !b.scan_uid || b.scan_validity !== validity;
      const found = fresh
        ? await client.search({ since: new Date(b.since || Date.now() - 86400000) }, { uid: true })
        : await client.search({ uid: `${Number(b.scan_uid) + 1}:*` }, { uid: true });
      const uids = (Array.isArray(found) ? found : [])
        .filter((u) => fresh || u > Number(b.scan_uid))
        .sort((x, y) => x - y)
        .slice(-40);
      const items = await opts.readMessages(client, uids, b.email);
      const last = uids.length
        ? uids[uids.length - 1]
        : Math.max(Number(b.scan_uid || 0), Number(box.uidNext || 1) - 1);
      return { validity, last, items };
    },
    timeoutMs,
    `IMAP scan timed out (${Math.round(timeoutMs / 1000)}s)`
  );
}

/**
 * Scans all due mailboxes concurrently in isolation.
 * One slow or failing mailbox never crashes the tick or blocks other mailboxes;
 * failures are recorded in scan_failures (074) and retried on the next tick.
 */
export async function scanMailboxes(
  boxes: ScanBox[],
  opts: {
    sb: ScanRpc;
    secret: string;
    timeoutMs?: number;
    createClient: (b: ScanBox, socketTimeoutMs: number) => Promise<ImapLike>;
    readMessages: (client: ImapLike, uids: number[], mailbox: string) => Promise<InboxItem[]>;
  }
): Promise<{ scanned: number; failed: number }> {
  let scanned = 0;
  let failed = 0;

  await Promise.allSettled(
    boxes.map(async (b) => {
      const domain = b.email.split("@")[1] || "unknown";
      try {
        const r = await scanOneMailbox(b, {
          createClient: opts.createClient,
          readMessages: opts.readMessages,
          timeoutMs: opts.timeoutMs ?? 20_000,
        });
        const rep = await opts.sb.rpc("mail_inbox_report", {
          server_secret: opts.secret,
          box_id: b.id,
          validity: r.validity,
          last_uid: r.last,
          items: r.items,
        });
        if (!rep.error) {
          await opts.sb.rpc("mail_scan_ok", { server_secret: opts.secret, box_id: b.id });
        }
        scanned++;
      } catch (err) {
        failed++;
        const msg = plainMailError(err);
        console.error(`inbox read failed for mailbox ${b.id} (${domain}):`, msg);
        try {
          await opts.sb.rpc("mail_scan_failure", {
            server_secret: opts.secret,
            box_id: b.id,
            err: msg,
          });
        } catch (e) {
          console.error("mail_scan_failure rpc error:", plainMailError(e));
        }
      }
    })
  );

  return { scanned, failed };
}
