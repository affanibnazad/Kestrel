import { NextResponse } from "next/server";
import { currentUser, supabaseServer } from "@/lib/supabase/server";
import { GOOGLE_COOKIE as COOKIE, authUrl, googleClient, newPending } from "@/lib/google-mail";

// Sign in with Google for an email account (database 048), step 1: send the owner or manager to Google's consent page.
// The state and PKCE verifier go in a short-lived, signed, http-only cookie that only the callback reads.
const back = (origin: string, code: string) => NextResponse.redirect(new URL(`/app?view=mailboxes&google=${code}`, origin), 303);

export async function GET(request: Request) {
  const url = new URL(request.url);
  const user = await currentUser();
  if (!user) return NextResponse.redirect(new URL("/login", url.origin), 303);
  const sb = await supabaseServer();
  const { data: acct } = await sb.rpc("my_account");
  const a = acct as { team_id?: string; role?: string } | null;
  if (!a?.team_id || !["owner", "manager"].includes(a.role ?? "")) return back(url.origin, "role");
  const client = await googleClient();
  if (!client) return back(url.origin, "setup");
  const { pending, cookie, challenge } = newPending(user.id, a.team_id, "mailboxes");
  const res = NextResponse.redirect(authUrl(client.client_id, `${url.origin}/api/mail/oauth/google/callback`, pending.state, challenge), 303);
  res.cookies.set(COOKIE, cookie, { httpOnly: true, secure: url.protocol === "https:", sameSite: "lax", path: "/api/mail/oauth/google", maxAge: 600 });
  return res;
}
