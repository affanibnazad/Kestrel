import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

// Security headers on every page and route. The browser only talks to this site and to Supabase (sign-in, data);
// everything else (Lemon Squeezy checkout, Google sign-in, AI companies, Hunter) is reached by the server or by a full
// page change, never loaded inside our pages. 'unsafe-inline' scripts are needed by Next.js's own inline page data
// (no per-request nonce with cached pages); the other rules still stop frames, plugins, foreign scripts and form hijacks.
const supabase = (() => { try { return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || "").origin; } catch { return ""; } })();
const sentry = (() => { try { return new URL(process.env.NEXT_PUBLIC_SENTRY_DSN || "").origin; } catch { return ""; } })();
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'" + (process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""),
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self'${supabase ? ` ${supabase} ${supabase.replace(/^https/, "wss")}` : ""}${sentry ? ` ${sentry}` : ""}`,
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "upgrade-insecure-requests",
].join("; ");
const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CSP },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // microphone=(self): Kestrel AI's mic button (Phase 3D) may ask for the microphone on Kestrel's own pages; nothing else can.
  { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=(), payment=(), usb=(), interest-cohort=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  // A separate build folder for local checks (KESTREL_DIST=.next-local), so two servers never share files.
  distDir: process.env.KESTREL_DIST || ".next",
  // The private downloads (extension and Claude Code kit) ship with the download route only.
  outputFileTracingIncludes: { "/app/download/[file]": ["./downloads-private/**"], "/connect/update": ["./downloads-private/kestrel-mcp.*"] },
  /* config options here */
  devIndicators: false,
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default process.env.NEXT_PUBLIC_SENTRY_DSN
  ? withSentryConfig(nextConfig, {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
      silent: !process.env.CI,
      telemetry: false,
    })
  : nextConfig;
