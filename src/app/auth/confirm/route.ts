import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/supabase/server";

// Links in Supabase emails (invite and sign-in) land here with a one-time token.
// It is checked on the server, so the link works on any device or browser, not only the one that asked for it.
const TYPES: EmailOtpType[] = ["invite", "email", "magiclink", "signup", "recovery", "email_change"];
// Kestrel Connect / kestrel-mcp login asks for its sign-in link to come back to the program on the person's computer.
// The email template adds &to={{ .RedirectTo }}; only this exact address is passed on (with the one-time token, not
// verified here, so the program signs itself in). Any other "to" is ignored: no open redirect.
const APP_CALLBACK = "http://127.0.0.1:53917/callback";

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const next = url.searchParams.get("next") ?? "/app";
  // Same rule as /auth/callback: same-site paths only, no "//x", "/\x", backslash or control characters.
  const safeNext = /^\/(?![/\\])/.test(next) && !/[\\\u0000-\u001f\u007f]/.test(next) ? next : "/app";
  if (tokenHash && type && TYPES.includes(type) && url.searchParams.get("to") === APP_CALLBACK && (type === "email" || type === "magiclink")) {
    const back = new URL(APP_CALLBACK);
    back.searchParams.set("token_hash", tokenHash); back.searchParams.set("type", type);
    return NextResponse.redirect(back);
  }
  if (tokenHash && type && TYPES.includes(type)) {
    const supabase = await supabaseServer();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(new URL(safeNext, url.origin));
  }
  return NextResponse.redirect(new URL("/login?error=link", url.origin));
}
