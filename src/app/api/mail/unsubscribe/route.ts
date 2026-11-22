import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_KEY, SUPABASE_URL } from "@/lib/supabase/config";

// One-click unsubscribe from a Kestrel campaign email (List-Unsubscribe header, RFC 8058).
// POST unsubscribes at once (mail apps send it when the reader clicks "Unsubscribe"); the person is added to the
// sending team's Do-not-contact list and no further emails go out. GET (a link opened in a browser, or a link scanner)
// changes nothing: it only shows the confirm page.
const tokenOf = (request: Request) => (new URL(request.url).searchParams.get("t") || "").trim();
const page = (title: string, text: string) => new Response(
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f7f7f7;font:16px/1.5 -apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111}
main{max-width:440px;margin:24px;padding:32px;background:#fff;border-radius:24px;box-shadow:0 10px 40px rgba(20,24,70,.08)}h1{font-size:22px;margin:0 0 8px}p{margin:0;color:#555}</style></head>
<body><main><h1>${title}</h1><p>${text}</p></main></body></html>`, { headers: { "content-type": "text/html; charset=utf-8" } });

export async function GET(request: Request) {
  const t = tokenOf(request);
  return NextResponse.redirect(new URL(`/unsubscribe?t=${encodeURIComponent(t)}`, request.url), 303);
}

export async function POST(request: Request) {
  const t = tokenOf(request);
  if (!/^[0-9a-f]{20,80}$/.test(t)) return page("Link not complete", "This unsubscribe link is not complete. Reply to the email with \"unsubscribe\" instead.");
  const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await sb.rpc("mail_unsubscribe", { token: t });
  if (error) return page("Something went wrong", "Please try again in a minute, or reply to the email with \"unsubscribe\".");
  return data ? page("You are unsubscribed", "You will not get any more emails from this sender through Kestrel.")
    : page("Link not found", "This unsubscribe link is not valid any more. Reply to the email with \"unsubscribe\" instead.");
}
