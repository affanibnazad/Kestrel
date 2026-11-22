import { createClient } from "@supabase/supabase-js";
import { SUPABASE_KEY, SUPABASE_URL } from "@/lib/supabase/config";

// Lemon Squeezy calls this after each subscription change (paid, renewed, cancelled, expired) and each invoice paid or refunded.
// The database checks the signature with the secret kept in Supabase Vault, then updates the team (ls_webhook).
export async function POST(request: Request) {
  const payload = await request.text();
  const signature = request.headers.get("x-signature") ?? "";
  if (!payload || payload.length > 200_000) return new Response("bad request", { status: 400 });
  const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await sb.rpc("ls_webhook", { payload, signature });
  if (error) return new Response(/Bad signature/.test(error.message) ? "bad signature" : "not saved", { status: /Bad signature/.test(error.message) ? 401 : 500 });
  // Creator commission for paid invoices and refunds (database 040). Before 040 the function is missing: skip it.
  const cut = await sb.rpc("ls_commission", { payload, signature });
  if (cut.error && !/ls_commission|schema cache|does not exist/i.test(cut.error.message)) return new Response("commission not saved", { status: 500 });
  return new Response(`${String(data ?? "ok")}; ${cut.error ? "no commission step" : String(cut.data ?? "ok")}`, { status: 200 });
}
