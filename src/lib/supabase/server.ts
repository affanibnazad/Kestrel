import "server-only";
import { cookies, headers } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_KEY, SUPABASE_URL, supabaseReady } from "./config";

// The sign-in of a Kestrel MCP package (Claude Code / Codex on the person's computer, 14-kestrel-mcp-plan.md): its own
// Supabase session, sent as "Authorization: Bearer <access token>". Supabase checks the token, and row-level security
// applies exactly as for the same person in the App. Browsers never send this header by themselves (no CSRF).
async function bearer(): Promise<string | null> {
  const h = await headers();
  const m = /^Bearer\s+([A-Za-z0-9._-]{20,4096})$/.exec(h.get("authorization") ?? "");
  return m ? m[1] : null;
}

// Supabase on the server, using the sign-in cookies of this visitor (or a Kestrel MCP package's session).
export async function supabaseServer() {
  const token = await bearer();
  if (token) {
    return createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
  }
  const store = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_KEY, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        // In a page the cookies can't be changed; the proxy keeps them fresh instead.
        try { list.forEach(({ name, value, options }) => store.set(name, value, options)); } catch {}
      },
    },
  });
}

// The signed-in person, checked with Supabase (not just read from the cookie or header). Null when signed out.
export async function currentUser() {
  if (!supabaseReady) return null;
  const token = await bearer();
  const supabase = await supabaseServer();
  const { data } = token ? await supabase.auth.getUser(token) : await supabase.auth.getUser();
  return data.user ?? null;
}
