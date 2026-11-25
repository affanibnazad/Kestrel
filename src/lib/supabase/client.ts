import { createBrowserClient } from "@supabase/ssr";
import { SUPABASE_KEY, SUPABASE_URL } from "./config";

// Reads that hang (19 Nov 2026: Supabase's Data API sometimes stalled 25 s or more while most calls took 0.25 s, and a
// page stayed on "Loading…" for good). Each database request now gives up after 15 s; reads are tried again up to two
// more times. Changes (insert, update, delete and every other function) are never repeated, so nothing is done twice.
const TIMEOUT_MS = 15_000;
const READ_FUNCTIONS = /\/rest\/v1\/rpc\/(my_account|my_tracking|my_creator|list_team_keys|team_people|mailbox_today|mail_daily|admin_overview|verifier_admin_status)(\?|$)/;

function isRead(url: string, method: string) {
  if (!url.includes("/rest/v1/")) return false;
  if (method === "GET" || method === "HEAD") return true;
  return method === "POST" && READ_FUNCTIONS.test(url);
}

export async function patientFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const method = (init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET")).toUpperCase();
  if (!url.includes("/rest/v1/")) return fetch(input, init);   // sign-in and storage keep their own behaviour
  const tries = isRead(url, method) ? 3 : 1;
  for (let attempt = 1; ; attempt++) {
    const ctl = new AbortController();
    const outer = init?.signal;
    if (outer?.aborted) ctl.abort(); else outer?.addEventListener("abort", () => ctl.abort(), { once: true });
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(input, { ...init, signal: ctl.signal });
      // 502 / 503 / 504: the Data API did not answer in time. Try a read again.
      if (attempt < tries && [502, 503, 504].includes(res.status)) { await new Promise((r) => setTimeout(r, 400 * attempt)); continue; }
      return res;
    } catch (e) {
      if (outer?.aborted || attempt >= tries) throw e;
      await new Promise((r) => setTimeout(r, 400 * attempt));
    } finally {
      clearTimeout(timer);
    }
  }
}

// Supabase in the browser (log in, log out, and the App's reads and changes).
export function supabaseBrowser() {
  return createBrowserClient(SUPABASE_URL, SUPABASE_KEY, { global: { fetch: patientFetch } });
}
