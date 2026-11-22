import "server-only";
import { promises as dns } from "node:dns";
import { isIP } from "node:net";
import https from "node:https";
import { lookup as lookupCb, type LookupAddress } from "node:dns";

// Server-side network guard: Kestrel connects only to real internet servers that people name (mail and IMAP hosts),
// never to private, loopback, link-local, CGNAT, multicast or reserved addresses.
export function isPublicIPv4(ip: string) {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = p;
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)));
}

export function isPublicIPv6(ip: string) {
  const a = ip.toLowerCase().split("%")[0];
  const mapped = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/) ?? a.match(/^64:ff9b::(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPublicIPv4(mapped[1]);
  if (a === "::" || a === "::1" || a.startsWith("::ffff:") || a.startsWith("64:ff9b:")) return false;
  const parts = a.split(":"), first = parseInt(parts[0] || "0", 16), second = parseInt(parts[1] || "0", 16);
  if (Number.isNaN(first) || Number.isNaN(second)) return false;
  // 2001::/23 special-purpose (Teredo 2001::/32 and others) and 2002::/16 (6to4) can wrap private IPv4 addresses: refused.
  if ((first === 0x2001 && second < 0x0200) || first === 0x2002) return false;
  // fc00::/7 private, fe80::/10 link-local, ff00::/8 multicast, 2001:db8::/32 documentation, 100::/64 discard; public space is 2000::/3.
  if ((first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00 || a.startsWith("2001:db8:") || a.startsWith("100::")) return false;
  return (first & 0xe000) === 0x2000;
}
export const isPublicIP = (ip: string) => (isIP(ip) === 4 ? isPublicIPv4(ip) : isIP(ip) === 6 ? isPublicIPv6(ip) : false);

// Resolves a server name once and checks EVERY address it has (IPv4 and IPv6). Callers connect to the returned address, with
// `servername` set to the name, so TLS still checks the real certificate and a second lookup cannot point somewhere else.
export async function vetHost(host: string): Promise<{ address: string; servername: string }> {
  const h = String(host || "").toLowerCase().trim();
  if (!/^[a-z0-9.-]+$/.test(h) || !h.includes(".") || isIP(h)) throw new Error("Server name not valid");
  const all = await Promise.race([dns.lookup(h, { all: true, verbatim: true }), new Promise<never>((_, no) => setTimeout(() => no(new Error("timeout")), 5000))])
    .catch(() => [] as { address: string; family: number }[]);
  if (!all.length) throw new Error(`Server name not found: ${h}`);
  if (!all.every((x) => isPublicIP(x.address))) throw new Error(`${h} is not a public internet server`);
  return { address: (all.find((x) => x.family === 4) ?? all[0]).address, servername: h };
}

// POST to a URL a team typed (webhooks). https only, no user/password in the URL, port 443 or 8443, no redirects,
// and the name must point only to public addresses: the check runs inside the connection's own DNS lookup, so the
// address that is checked is the address that is used. At most 64 KB of the answer is read.
export function safePost(url: string, body: string, headers: Record<string, string>, timeoutMs = 10_000): Promise<{ status: number; text: string }> {
  let u: URL;
  try { u = new URL(url); } catch { return Promise.reject(new Error("Not a valid address")); }
  if (u.protocol !== "https:" || u.username || u.password) return Promise.reject(new Error("The address must start with https:// and have no password in it"));
  if (u.port && !["443", "8443"].includes(u.port)) return Promise.reject(new Error("Only port 443 or 8443"));
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && !isPublicIP(host)) return Promise.reject(new Error("Not a public internet address"));
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: host, port: u.port || 443, path: `${u.pathname}${u.search}`, method: "POST", timeout: timeoutMs,
      headers: { ...headers, "content-length": String(Buffer.byteLength(body)) },
      lookup: (name: string, opts: { all?: boolean }, cb: (err: Error | null, address: string | LookupAddress[], family?: number) => void) => {
        lookupCb(name, { all: true, verbatim: true }, (err, list) => {
          const addrs = (list ?? []) as LookupAddress[];
          if (err || !addrs.length) return cb(err ?? new Error(`Server name not found: ${name}`), "", 4);
          if (!addrs.every((a) => isPublicIP(a.address))) return cb(new Error(`${name} is not a public internet server`), "", 4);
          const a = addrs.find((x) => x.family === 4) ?? addrs[0];
          return opts?.all ? cb(null, [a]) : cb(null, a.address, a.family);
        });
      },
    }, (res) => {
      const chunks: Buffer[] = []; let n = 0;
      res.on("data", (c: Buffer) => { n += c.length; if (n <= 65_536) chunks.push(c); });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8").slice(0, 2000) }));
    });
    req.on("timeout", () => req.destroy(new Error(`No answer in ${Math.round(timeoutMs / 1000)} seconds`)));
    req.on("error", reject);
    req.end(body);
  });
}
