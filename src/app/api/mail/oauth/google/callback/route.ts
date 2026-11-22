import { NextResponse } from "next/server";
import type { ImapFlow } from "imapflow";
import { currentUser, supabaseServer } from "@/lib/supabase/server";
import { GOOGLE_COOKIE as COOKIE, GOOGLE_PREFIX, exchangeCode, googleClient, readPending } from "@/lib/google-mail";
import { imapClient, smtpTransport } from "@/lib/mail-connect";

// Sign in with Google for an email account (database 048), step 2: Google sends the person back here with a one-time code.
// Checks the signed state (same person, same team, under 10 minutes), exchanges the code with PKCE, saves the account with
// its refresh token in Vault, tests sending and reading like the Test button, and goes back to Email accounts.
// No address or token is ever put in a URL.
export const maxDuration = 60;
const back = (origin: string, code: string) => {
  const res = NextResponse.redirect(new URL(`/app?view=mailboxes&google=${code}`, origin), 303);
  res.cookies.set(COOKIE, "", { path: "/api/mail/oauth/google", maxAge: 0 });
  return res;
};

export async function GET(request: Request) {
  const url = new URL(request.url), origin = url.origin;
  const user = await currentUser();
  if (!user) return NextResponse.redirect(new URL("/login", origin), 303);
  const cookieHeader = request.headers.get("cookie") ?? "";
  const raw = cookieHeader.split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  let cookieValue: string | undefined;
  try { cookieValue = raw ? decodeURIComponent(raw) : undefined; } catch { cookieValue = undefined; }
  const pending = readPending(cookieValue);
  if (url.searchParams.get("error")) return back(origin, url.searchParams.get("error") === "access_denied" ? "cancelled" : "failed");
  const code = url.searchParams.get("code") ?? "", state = url.searchParams.get("state") ?? "";
  if (!pending || !code || state !== pending.state || pending.user !== user.id) return back(origin, "expired");

  const secret = process.env.MAIL_SERVER_SECRET || "";
  const client = await googleClient();
  if (!client || secret.length < 32) return back(origin, "setup");
  let got: Awaited<ReturnType<typeof exchangeCode>>;
  try { got = await exchangeCode(client, code, pending.verifier, `${origin}/api/mail/oauth/google/callback`); }
  catch (e) {
    const m = (e as Error).message;
    return back(origin, /Tick the box/.test(m) ? "scope" : /lasting access/.test(m) ? "refresh" : /client ID or secret/.test(m) ? "client" : "failed");
  }

  const sb = await supabaseServer();
  // Same team as when the sign-in started (the person could have switched teams in between).
  const { data: acct } = await sb.rpc("my_account");
  if ((acct as { team_id?: string } | null)?.team_id !== pending.team) return back(origin, "expired");
  const name = String((user.user_metadata as { full_name?: string } | undefined)?.full_name ?? "");
  const { data: boxId, error } = await sb.rpc("save_google_mailbox", { server_secret: secret, email: got.email, from_name: name, refresh_token: got.refresh });
  if (error || typeof boxId !== "string") return back(origin, /owner or a manager/.test(error?.message ?? "") ? "role" : "save");

  // Test it now, like the Test button: sign in to Gmail's SMTP (sending) and IMAP (reading replies).
  const login = { smtp_host: "smtp.gmail.com", smtp_port: 465, imap_host: "imap.gmail.com", imap_port: 993, username: got.email, password: GOOGLE_PREFIX + got.refresh };
  let smtp = false, imap: boolean | null = null;
  const problems: string[] = [];
  let t: Awaited<ReturnType<typeof smtpTransport>> | null = null;
  try { t = await smtpTransport(login); await t.verify(); smtp = true; } catch (e) { problems.push(`Sending (SMTP): ${String((e as Error).message).slice(0, 200)}`); }
  finally { t?.close(); }
  let c: ImapFlow | null = null;
  try { c = await imapClient(login); await c.connect(); await c.mailboxOpen("INBOX", { readOnly: true }); imap = true; }
  catch (e) { imap = false; problems.push(`Reading replies (IMAP): ${String((e as Error).message).slice(0, 200)}${/disabled|IMAP access/i.test(String((e as Error).message)) ? " Turn on IMAP in Gmail settings → Forwarding and POP/IMAP." : ""}`); }
  finally { if (c) { try { await c.logout(); } catch { /* closed */ } } }
  await sb.rpc("mailbox_tested", { box_id: boxId, server_secret: secret, smtp, imap, err: problems.join(" · ") });
  return back(origin, smtp && imap ? "ok" : "tested");
}
