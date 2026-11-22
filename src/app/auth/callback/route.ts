import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

// The email link and Google both come back here with a one-time code. It is swapped for a sign-in,
// then the person goes to the App. Only addresses on this site are allowed as the next page.
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/app";
  // Same-site paths only: not "//x" or "/\x", and no backslash or control character anywhere (browsers read a backslash
  // as a slash and drop tabs and line breaks, so "/<tab>/x" would also leave the site).
  const safeNext = /^\/(?![/\\])/.test(next) && !/[\\\u0000-\u001f\u007f]/.test(next) ? next : "/app";
  if (code) {
    const supabase = await supabaseServer();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(safeNext, url.origin));
  }
  // The Google button adds via=google, so a cancelled or failed Google sign-in gets its own message.
  return NextResponse.redirect(new URL(`/login?error=${url.searchParams.get("via") === "google" ? "google" : "link"}`, url.origin));
}
