import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { scanMailboxes, withImapClient } from "@/lib/mail-scan";

function makeBox(id, email) {
  return {
    id,
    email,
    imap_host: "imap.gmail.com",
    imap_port: 993,
    username: email,
    password: "secret",
    scan_uid: 10,
    scan_validity: "1",
    since: null,
  };
}

function makeFakeSb(calls) {
  return {
    rpc: async (fn, args) => {
      calls.push({ fn, args });
      return { data: { ok: true }, error: null };
    },
  };
}

describe("IMAP scan isolation and timeout handling", () => {
  it("socket timeout: async EventEmitter 'error' does not crash, closes socket, and logs mail_scan_failure", async () => {
    const calls = [];
    let closed = false;

    class HangingClient extends EventEmitter {
      async connect() {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      async mailboxOpen() {
        return { uidValidity: 1, uidNext: 11 };
      }
      async search() {
        return [];
      }
      async fetchAll() {
        return [];
      }
      async logout() {}
      close() {
        closed = true;
      }
    }

    const res = await scanMailboxes([makeBox("box-timeout", "slow@gmail.com")], {
      sb: makeFakeSb(calls),
      secret: "x".repeat(32),
      timeoutMs: 40,
      createClient: async () => {
        const c = new HangingClient();
        // Simulate late ImapFlow 'Socket timeout' event after timeout fires
        setTimeout(() => {
          c.emit("error", new Error("Socket timeout"));
        }, 60);
        return c;
      },
      readMessages: async () => [],
    });

    // Wait past the 60ms async error emission to prove no uncaughtException is thrown
    await new Promise((r) => setTimeout(r, 90));

    assert.equal(closed, true);
    assert.deepEqual(res, { scanned: 0, failed: 1 });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].fn, "mail_scan_failure");
    assert.equal(calls[0].args.box_id, "box-timeout");
    assert.match(String(calls[0].args.err), /timed out/i);
  });

  it("auth fail: records mail_scan_failure and does not call mail_scan_ok", async () => {
    const calls = [];

    const res = await scanMailboxes([makeBox("box-auth", "bad@gmail.com")], {
      sb: makeFakeSb(calls),
      secret: "x".repeat(32),
      timeoutMs: 200,
      createClient: async () => ({
        on: () => {},
        connect: async () => {
          throw new Error("Invalid credentials (Failure)");
        },
        mailboxOpen: async () => ({ uidValidity: 1, uidNext: 11 }),
        search: async () => [],
        fetchAll: async () => [],
        logout: async () => {},
        close: () => {},
      }),
      readMessages: async () => [],
    });

    assert.deepEqual(res, { scanned: 0, failed: 1 });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].fn, "mail_scan_failure");
    assert.equal(calls[0].args.box_id, "box-auth");
    assert.match(String(calls[0].args.err), /Invalid credentials/);
  });

  it("one slow mailbox among several: healthy mailboxes succeed and slow one is isolated + retried next tick", async () => {
    const calls = [];
    const boxes = [
      makeBox("fast-1", "a@gmail.com"),
      makeBox("slow-gmail", "slow@gmail.com"),
      makeBox("fast-2", "b@gmail.com"),
    ];

    const res = await scanMailboxes(boxes, {
      sb: makeFakeSb(calls),
      secret: "x".repeat(32),
      timeoutMs: 50,
      createClient: async (b) => {
        const c = new EventEmitter();
        c.connect = async () => {
          if (b.id === "slow-gmail") {
            await new Promise((r) => setTimeout(r, 250));
          }
        };
        c.mailboxOpen = async () => ({ uidValidity: 1, uidNext: 12 });
        c.search = async () => [11];
        c.fetchAll = async () => [];
        c.logout = async () => {};
        c.close = () => {};
        return c;
      },
      readMessages: async () => [],
    });

    assert.deepEqual(res, { scanned: 2, failed: 1 });

    const okBoxes = calls.filter((c) => c.fn === "mail_scan_ok").map((c) => c.args.box_id);
    const failBoxes = calls.filter((c) => c.fn === "mail_scan_failure").map((c) => c.args.box_id);
    assert.deepEqual(okBoxes.sort(), ["fast-1", "fast-2"]);
    assert.deepEqual(failBoxes, ["slow-gmail"]);
  });

  it("withImapClient: propagates synchronous errors cleanly and still closes client", async () => {
    let closed = false;
    await assert.rejects(
      () =>
        withImapClient(
          async () => ({
            on: () => {},
            connect: async () => {
              throw new Error("ECONNRESET");
            },
            mailboxOpen: async () => ({}),
            search: async () => [],
            fetchAll: async () => [],
            logout: async () => {},
            close: () => {
              closed = true;
            },
          }),
          async (c) => {
            await c.connect();
          },
          200,
          "timed out"
        ),
      /ECONNRESET/
    );
    assert.equal(closed, true);
  });
});
