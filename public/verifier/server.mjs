// Kestrel email verifier, part 2: runs on Affan's own VPS (outbound port 25 open, reverse DNS set), behind Caddy (https).
// It asks each address's mail server "would you accept mail for this address?" and hangs up. It NEVER sends an email
// (no DATA command). It also asks about a made-up address on the same domain, to spot servers that accept everything
// (catch-all). One connection per mail server at a time, with a pause between, so the server's IP stays clean.
// Only Kestrel may call it: every request is signed with the shared secret (HMAC-SHA256 of "time.body", 5-minute window).
// Plain Node (18+), no packages. Design: docs/superpowers/specs/2026-11-14-email-verifier-design.md
import http from "node:http";
import net from "node:net";
import dns from "node:dns/promises";
import crypto from "node:crypto";

const PORT = Number(process.env.PORT || 8080);
const SECRET = process.env.VERIFIER_SECRET || "";
const HELO = process.env.HELO_HOST || "localhost";
const FROM = process.env.PROBE_FROM || `verify@${HELO}`;
// Tests only: TEST_MX sends every domain to one host, SMTP_PORT changes port 25 (never set these on the real server).
const TEST_MX = process.env.TEST_MX || "", SMTP_PORT = Number(process.env.SMTP_PORT || 25);
const MAX_EMAILS = 25, EMAIL_TIMEOUT = 12_000, GAP_MS = 1_000, CATCH_ALL_TTL = 24 * 3600_000, REQUEST_BUDGET = 40_000;
if (SECRET.length < 32) { console.error("VERIFIER_SECRET is missing or too short"); process.exit(1); }

const EMAIL = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const catchAll = new Map();   // domain -> { value, at }
const busy = new Map();       // mail server -> promise of the last job (one at a time per server)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Only public internet addresses: never loopback, private, link-local, CGNAT, multicast or reserved ranges, so a domain
// whose "mail server" points inside a network cannot make this server knock on internal machines.
function publicIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)));
  }
  if (net.isIPv6(ip)) {
    const x = ip.toLowerCase();
    if (x.startsWith("::ffff:")) return publicIp(x.slice(7));
    return !(x === "::" || x === "::1" || /^f[cd]/.test(x) || /^fe[89ab]/.test(x) || x.startsWith("ff") || x.startsWith("2001:db8") || x.startsWith("64:ff9b"));
  }
  return false;
}
// The mail server's address, checked once and then used directly (no second DNS answer can change it).
async function vetted(host) {
  if (TEST_MX && host === TEST_MX) return host;
  const all = await dns.lookup(host, { all: true }).catch(() => []);
  if (!all.length || !all.every((a) => publicIp(a.address))) return null;
  return (all.find((a) => a.family === 4) || all[0]).address;
}
function oneAtATime(host, job) {
  const prev = busy.get(host) || Promise.resolve();
  const next = prev.then(job, job).finally(() => sleep(GAP_MS));
  busy.set(host, next.catch(() => {}));
  return next;
}

async function mailServers(domain) {
  if (TEST_MX) return domain.endsWith(".nomail.test") ? { hosts: [], none: "The domain has no mail server" } : { hosts: [TEST_MX] };
  try {
    const mx = await dns.resolveMx(domain);
    const hosts = mx.filter((m) => m.exchange && m.exchange !== ".").sort((a, b) => a.priority - b.priority).map((m) => m.exchange);
    if (mx.length && !hosts.length) return { hosts: [], none: "The domain says it receives no email (null MX)" };
    if (hosts.length) return { hosts };
  } catch { /* fall back to the A record below */ }
  try { await dns.resolve4(domain); return { hosts: [domain], noMx: true }; } catch { return { hosts: [], none: "The domain has no mail server" }; }
}

// One SMTP conversation: greeting, EHLO, MAIL FROM, RCPT TO (the address), RCPT TO (a made-up address), QUIT.
function probe(ip, email, fake) {
  return new Promise((resolve) => {
    const out = { connected: false, code: 0, text: "", fakeCode: 0 };
    let buf = "", step = 0, done = false;
    const sock = net.connect({ host: ip, port: SMTP_PORT });
    const finish = (why) => { if (done) return; done = true; if (why) out.text ||= why; try { sock.end("QUIT\r\n"); } catch { /* closed */ } setTimeout(() => sock.destroy(), 1500).unref(); resolve({ ...out }); };
    const timer = setTimeout(() => finish("No answer in time"), EMAIL_TIMEOUT);
    sock.on("connect", () => { out.connected = true; });
    sock.on("error", () => { clearTimeout(timer); finish("Could not reach the mail server"); });
    sock.on("close", () => { clearTimeout(timer); finish(""); });
    sock.setEncoding("utf8");
    sock.on("data", (chunk) => {
      if (done) return;   // the answer is in; later lines (e.g. the goodbye after QUIT) must not change it
      buf += chunk;
      // A reply is complete when its last line is "NNN text" (not "NNN-text").
      const lines = buf.split(/\r?\n/).filter(Boolean);
      const last = lines[lines.length - 1] || "";
      if (!/^\d{3} /.test(last) || !buf.endsWith("\n")) return;
      const code = Number(last.slice(0, 3)), text = lines.join(" ").slice(0, 300);
      buf = "";
      if (step === 0) { if (code !== 220) { out.text = text; clearTimeout(timer); return finish(); } step = 1; return sock.write(`EHLO ${HELO}\r\n`); }
      if (step === 1) { if (code !== 250) { out.text = text; clearTimeout(timer); return finish(); } step = 2; return sock.write(`MAIL FROM:<${FROM}>\r\n`); }
      if (step === 2) { if (code !== 250) { out.code = code; out.text = text; clearTimeout(timer); return finish(); } step = 3; return sock.write(`RCPT TO:<${email}>\r\n`); }
      if (step === 3) { out.code = code; out.text = text; if (!fake || code >= 500) { clearTimeout(timer); return finish(); } step = 4; return sock.write(`RCPT TO:<${fake}>\r\n`); }
      if (step === 4) { out.fakeCode = code; clearTimeout(timer); return finish(); }
    });
  });
}

const USER_UNKNOWN = /5\.1\.[0-1]|user unknown|unknown user|no such user|does not exist|doesn'?t exist|mailbox (is )?(unavailable|not found)|recipient (address )?rejected|invalid (recipient|mailbox)|not found/i;

async function checkOne(raw) {
  const email = String(raw || "").trim().toLowerCase();
  if (!EMAIL.test(email) || email.length > 254) return { email, status: "invalid", reason: "Not a valid email address" };
  const domain = email.split("@")[1];
  const mx = await mailServers(domain);
  if (!mx.hosts.length) return { email, status: "invalid", reason: mx.none };
  const known = catchAll.get(domain);
  if (known && known.value && Date.now() - known.at < CATCH_ALL_TTL) {
    return { email, status: "risky", reason: "The server accepts every address (catch-all)", catchAll: true };
  }
  const fake = `kv-${crypto.randomBytes(6).toString("hex")}@${domain}`;
  let last = null;
  for (const host of mx.hosts.slice(0, 2)) {
    const ip = await vetted(host);
    if (!ip) { last = { connected: false, text: "The mail server is not on the public internet" }; continue; }
    const r = await oneAtATime(ip, () => probe(ip, email, fake));
    last = r;
    if (!r.connected) continue;   // try the next mail server
    if (r.code === 250 || r.code === 251) {
      const all = r.fakeCode === 250 || r.fakeCode === 251;
      catchAll.set(domain, { value: all, at: Date.now() });
      return all ? { email, status: "risky", reason: "The server accepts every address (catch-all)", catchAll: true, code: r.code }
        : { email, status: "valid", reason: "The mail server confirmed this mailbox", code: r.code };
    }
    if (r.code >= 500 && r.code < 600 && (r.code === 550 || r.code === 551 || r.code === 553 || USER_UNKNOWN.test(r.text))) {
      return { email, status: "invalid", reason: "The mail server says this mailbox does not exist", code: r.code };
    }
    return { email, status: "risky", reason: r.code ? `The server would not say (${r.code})` : "The server would not say", code: r.code };
  }
  return { email, status: "risky", reason: last && !last.connected && last.text === "The mail server is not on the public internet" ? last.text : "Could not reach the mail server" };
}

function signedOk(req, body) {
  const t = Number(req.headers["x-kestrel-time"] || 0), sig = String(req.headers["x-kestrel-signature"] || "");
  if (!t || Math.abs(Date.now() / 1000 - t) > 300 || !/^[a-f0-9]{64}$/.test(sig)) return false;
  const want = crypto.createHmac("sha256", SECRET).update(`${t}.${body}`).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig));
}

const server = http.createServer((req, res) => {
  const send = (code, obj) => { res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(obj)); };
  if (req.method === "GET" && req.url === "/health") return send(200, { ok: true, helo: HELO });
  if (req.method !== "POST" || req.url !== "/check") return send(404, { error: "Not found" });
  let body = "";
  req.setEncoding("utf8");
  req.on("data", (c) => { body += c; if (body.length > 20_000) req.destroy(); });
  req.on("end", async () => {
    if (!signedOk(req, body)) return send(401, { error: "Not allowed" });
    let emails;
    try { emails = JSON.parse(body).emails; } catch { return send(400, { error: "Bad request" }); }
    if (!Array.isArray(emails) || !emails.length || emails.length > MAX_EMAILS) return send(400, { error: `Send 1 to ${MAX_EMAILS} emails` });
    // 40 s per request (Kestrel's own limit is 60 s): what is not finished comes back as "later" and is checked again next time.
    const later = (e) => new Promise((r) => setTimeout(() => r({ email: String(e), status: "later", reason: "Not checked in time, try again" }), REQUEST_BUDGET));
    const results = await Promise.all(emails.map((e) => Promise.race([checkOne(e), later(e)])
      .catch(() => ({ email: String(e), status: "risky", reason: "The check failed" }))));
    send(200, { results });
  });
});
server.listen(PORT, "127.0.0.1", () => console.log(`Kestrel verifier on 127.0.0.1:${PORT} as ${HELO}`));
