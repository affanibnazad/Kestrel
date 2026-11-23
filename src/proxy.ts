import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { SUPABASE_KEY, SUPABASE_URL, supabaseReady } from "@/lib/supabase/config";

// Runs before /, /app and /login: keeps the sign-in fresh, sends signed-out visitors from the App to Log in,
// and sends signed-in visitors from Log in straight to the App.
// A team's own tracking domain (for example track.yourdomain.com) also points at Kestrel, but only for the open-tracking
// image. Visiting its pages sends people to kestrelleads.com instead (no sign-in on someone else's domain).
const OWN_HOSTS = /^(kestrelleads\.com|www\.kestrelleads\.com|localhost|127\.0\.0\.1|[a-z0-9-]+\.vercel\.app)$/i;

export async function proxy(request: NextRequest) {
  const host = (request.headers.get("host") || "").split(":")[0];
  if (host && !OWN_HOSTS.test(host)) return NextResponse.redirect(new URL(request.nextUrl.pathname + request.nextUrl.search, "https://kestrelleads.com"), 308);
  if (!supabaseReady) return NextResponse.next();

  const path = request.nextUrl.pathname;

  // /ai-chat redirects to the standalone /kestrel-ai-chat page
  if (path === "/ai-chat") {
    const url = request.nextUrl.clone();
    url.pathname = "/kestrel-ai-chat";
    return NextResponse.redirect(url, 308);
  }

  // Handle auth callback/confirm redirection if codes are in search params
  const code = request.nextUrl.searchParams.get("code");
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  if (code || tokenHash) {
    const url = request.nextUrl.clone();
    url.pathname = code ? "/auth/callback" : "/auth/confirm";
    if (!url.searchParams.get("next")) url.searchParams.set("next", "/app");
    return NextResponse.redirect(url);
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const { data: { user } } = await supabase.auth.getUser();

  // If user is already authenticated and visits /login, redirect straight to /app
  if (path === "/login") {
    if (user) {
      const next = request.nextUrl.searchParams.get("next") ?? "";
      const safeNext = /^\/app(\?.*)?$/i.test(next) ? next : "/app";
      return NextResponse.redirect(new URL(safeNext, request.nextUrl.origin));
    }
    return response;
  }

  // Protected /app routes
  if (path === "/app" || path.startsWith("/app/")) {
    // Paid downloads strictly require an authenticated Supabase session. Demo mode is never allowed.
    if (path.startsWith("/app/download")) {
      if (!user) {
        const loginUrl = new URL("/login", request.nextUrl.origin);
        const returnUrl = request.nextUrl.pathname + request.nextUrl.search;
        loginUrl.searchParams.set("next", returnUrl);
        return NextResponse.redirect(loginUrl);
      }
      return response;
    }

    const isDemoAllowed = process.env.KESTREL_ALLOW_DEMO === "true";
    const isExplicitDemo = isDemoAllowed && (
      request.nextUrl.searchParams.get("demo") === "true" ||
      request.nextUrl.searchParams.get("demo") === "1" ||
      request.nextUrl.searchParams.get("preview") === "1"
    );
    // Allow if user is authenticated OR explicitly viewing isolated demo (when enabled)
    if (user || isExplicitDemo) {
      return response;
    }
    // Otherwise redirect unauthenticated visitor to login with safe next parameter
    const loginUrl = new URL("/login", request.nextUrl.origin);
    const returnUrl = request.nextUrl.pathname + request.nextUrl.search;
    loginUrl.searchParams.set("next", returnUrl);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = { matcher: ["/", "/app/:path*", "/login", "/features", "/how-it-works", "/pricing", "/use-cases", "/security", "/about", "/contact", "/creators", "/signup", "/kestrel-ai-chat", "/ai-chat"] };
