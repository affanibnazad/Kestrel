#!/usr/bin/env node

/**
 * Kestrel Phase 1.5: Production Readiness, Build Verification & Asset Hardening
 *
 * Verifies:
 * 1. Static Asset Integrity (public brand, logos, verifier scripts, icon.svg)
 * 2. HTTP Security Headers Matrix (Pages and API routes: CSP, nosniff, DENY, strict-origin, permissions, COOP)
 * 3. CSP Compatibility with Application Architecture (connect-src, script-src, style-src, frame blocking)
 * 4. Private Downloads & Path Traversal Prevention (whitelisted files, path traversal blocked, forged tokens rejected)
 * 5. Protected Route Authentication Redirect Matrix & Role Authorization (/app, /owner, /checkout, signout)
 * 6. Environment Variable & Secret Leak Isolation (.env.example coverage, zero server secret leakage to client)
 * 7. SEO & Metadata Routes (/robots.txt, /sitemap.xml, public page status codes)
 */

import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const BASE_URL = process.env.BASE_URL || "http://localhost:3333";
const ROOT_DIR = process.cwd();

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition, testName, details = "") {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✓ PASS: ${testName}`);
  } else {
    failedTests++;
    console.error(`  ✗ FAIL: ${testName} ${details ? `(${details})` : ""}`);
  }
}

async function fetchRoute(routePath, options = {}) {
  const url = new URL(routePath, BASE_URL);
  const client = url.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    const req = client.request(url, {
      method: options.method || "GET",
      headers: options.headers || {},
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString("utf8"),
          rawBuffer: Buffer.concat(chunks),
        });
      });
    });

    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

// ==============================================================================
// 1. Static Asset Availability & Integrity
// ==============================================================================
async function testStaticAssets() {
  console.log("\n--- Suite 1: Static Asset Integrity & Availability ---");

  const assets = [
    "/brand/kestrel-blue.svg",
    "/brand/kestrel-google-logo-120.png",
    "/brand/kestrel-ink.svg",
    "/logos/brave.svg",
    "/logos/chatgpt.png",
    "/logos/chrome.svg",
    "/logos/claude-code.svg",
    "/logos/claude-desktop.svg",
    "/logos/claude.png",
    "/logos/codex.svg",
    "/logos/companies-house.png",
    "/logos/gemini.png",
    "/logos/hubspot.svg",
    "/logos/hunter.png",
    "/logos/listen-notes.png",
    "/logos/openrouter.svg",
    "/verifier/install.sh",
    "/verifier/server.mjs",
    "/icon.svg",
  ];

  for (const asset of assets) {
    const res = await fetchRoute(asset);
    assert(res.status === 200, `Asset ${asset} returns HTTP 200`, `got ${res.status}`);
    assert(res.rawBuffer.length > 0, `Asset ${asset} is non-empty`, `size: ${res.rawBuffer.length} bytes`);
  }
}

// ==============================================================================
// 2. HTTP Security Headers Across Route & API Matrix
// ==============================================================================
async function testSecurityHeadersMatrix() {
  console.log("\n--- Suite 2: HTTP Security Headers Across Route & API Matrix ---");

  const testMatrix = [
    { path: "/", method: "GET", expectedStatus: 307, name: "Root Redirect" },
    { path: "/features", method: "GET", expectedStatus: 200, name: "Marketing Page (/features)" },
    { path: "/api/contact", method: "GET", expectedStatus: 405, name: "API Route (/api/contact)" },
    { path: "/api/verify", method: "GET", expectedStatus: 405, name: "API Route (/api/verify)" },
    { path: "/api/ai", method: "GET", expectedStatus: 405, name: "API Route (/api/ai)" },
    { path: "/api/owner/offers", method: "POST", expectedStatus: 401, name: "API Route (/api/owner/offers)" },
    { path: "/connect/update", method: "GET", expectedStatus: 200, name: "API Route (/connect/update)" },
  ];

  for (const endpoint of testMatrix) {
    const res = await fetchRoute(endpoint.path, { method: endpoint.method });
    assert(res.status === endpoint.expectedStatus, `${endpoint.name} returns HTTP ${endpoint.expectedStatus}`, `got ${res.status}`);

    const csp = res.headers["content-security-policy"] || "";
    assert(csp.includes("default-src 'self'"), `${endpoint.name}: CSP contains default-src 'self'`);
    assert(csp.includes("frame-ancestors 'none'"), `${endpoint.name}: CSP blocks frame-ancestors`);
    assert(csp.includes("object-src 'none'"), `${endpoint.name}: CSP blocks object-src`);

    const xcto = res.headers["x-content-type-options"];
    assert(xcto === "nosniff", `${endpoint.name}: X-Content-Type-Options is nosniff`);

    const xfo = res.headers["x-frame-options"];
    assert(xfo === "DENY", `${endpoint.name}: X-Frame-Options is DENY`);

    const rp = res.headers["referrer-policy"];
    assert(rp === "strict-origin-when-cross-origin", `${endpoint.name}: Referrer-Policy is strict-origin`);

    const coop = res.headers["cross-origin-opener-policy"];
    assert(coop === "same-origin-allow-popups", `${endpoint.name}: COOP is same-origin-allow-popups`);
  }
}

// ==============================================================================
// 3. CSP Compatibility with Application Architecture
// ==============================================================================
async function testCspCompatibility() {
  console.log("\n--- Suite 3: CSP Compatibility Audit ---");

  const res = await fetchRoute("/features");
  const csp = res.headers["content-security-policy"] || "";

  // 1. Script execution for Next.js hydration
  assert(csp.includes("script-src 'self' 'unsafe-inline'"), "CSP allows Next.js inline hydration scripts");

  // 2. Styling for Tailwind & SF Pro styling
  assert(csp.includes("style-src 'self' 'unsafe-inline'"), "CSP allows self and inline styling for UI components");

  // 3. Supabase REST and WebSocket connectivity
  assert(csp.includes("connect-src 'self'"), "CSP allows connect-src 'self'");
  const hasSupabaseConnect = csp.includes("https://") && csp.includes("wss://");
  assert(hasSupabaseConnect, "CSP dynamically permits Supabase HTTPS and WSS endpoints");

  // 4. Image domains: self, data, blob, and https for lead avatars
  assert(csp.includes("img-src 'self' data: blob: https:"), "CSP allows secure avatar and image loading");

  // 5. Restrictive form action and base URI
  assert(csp.includes("base-uri 'self'"), "CSP enforces base-uri 'self'");
  assert(csp.includes("form-action 'self'"), "CSP restricts form-action to 'self'");
  assert(csp.includes("upgrade-insecure-requests"), "CSP includes upgrade-insecure-requests");
}

// ==============================================================================
// 4. Private Downloads & Path Traversal Prevention
// ==============================================================================
async function testPrivateDownloadsAndSecurity() {
  console.log("\n--- Suite 4: Private Downloads & Path Traversal Prevention ---");

  // 1. Connect update metadata
  const updateRes = await fetchRoute("/connect/update");
  assert(updateRes.status === 200, "GET /connect/update returns HTTP 200", `got ${updateRes.status}`);

  let updateJson = null;
  try {
    updateJson = JSON.parse(updateRes.body);
  } catch {
    // ignore
  }
  assert(Boolean(updateJson?.version), "Update metadata contains version", `got ${updateJson?.version}`);
  assert(Boolean(updateJson?.sha256), "Update metadata contains sha256 hash");
  assert(Boolean(updateJson?.sig), "Update metadata contains signature");

  // 2. Connect update file download and sha256 match
  const fileRes = await fetchRoute("/connect/update?file=1");
  assert(fileRes.status === 200, "GET /connect/update?file=1 returns HTTP 200", `got ${fileRes.status}`);
  const computedHash = crypto.createHash("sha256").update(fileRes.rawBuffer).digest("hex");
  assert(computedHash === updateJson?.sha256, "Downloaded connector SHA-256 matches signed metadata", `expected ${updateJson?.sha256}, got ${computedHash}`);

  // 3. Unauthenticated private downloads must NOT return 200 with zip content
  const protectedDownloads = ["extension", "kit", "mcp"];
  for (const item of protectedDownloads) {
    const dlRes = await fetchRoute(`/app/download/${item}`);
    const isProtected = dlRes.status === 307 || dlRes.status === 302 || dlRes.status === 401 || dlRes.status === 403;
    const location = dlRes.headers["location"] || "";
    assert(
      isProtected && (location.includes("/login") || dlRes.status >= 400),
      `Unauthenticated download /app/download/${item} is blocked (redirects to /login or rejects)`,
      `status: ${dlRes.status}, location: ${location}`
    );
  }

  // 4. Path traversal attempts against download route must be rejected
  const traversalAttempts = [
    "/app/download/..%2Fpackage.json",
    "/app/download/..%2F..%2Fetc%2Fpasswd",
    "/app/download/secret.txt",
    "/app/download/.env.local",
    "/app/download/arbitrary_binary",
  ];

  for (const attempt of traversalAttempts) {
    const res = await fetchRoute(attempt);
    const blocked = res.status === 307 || res.status === 302 || res.status === 404 || res.status === 400 || res.status === 403;
    assert(blocked, `Path traversal attempt ${attempt} is rejected (status ${res.status})`);
  }

  // 5. Forged Bearer token request against protected download must be rejected
  const forgedRes = await fetchRoute("/app/download/extension", {
    headers: { Authorization: "Bearer forged_invalid_token_12345678901234567890" }
  });
  const forgedBlocked = forgedRes.status === 307 || forgedRes.status === 302 || forgedRes.status === 401;
  assert(forgedBlocked, "Forged Bearer token download attempt is rejected and redirected to /login");
}

// ==============================================================================
// 5. Protected Route Authentication Redirect Matrix & Role Authorization
// ==============================================================================
async function testAuthRedirectsAndRoles() {
  console.log("\n--- Suite 5: Protected Route Authentication Redirect Matrix & Role Authorization ---");

  const protectedAppRoutes = [
    { path: "/app", nextExpected: "%2Fapp" },
    { path: "/app?view=owner", nextExpected: "%2Fapp%3Fview%3Downer" },
    { path: "/app?view=campaigns", nextExpected: "%2Fapp%3Fview%3Dcampaigns" },
    { path: "/app?view=inbox", nextExpected: "%2Fapp%3Fview%3Dinbox" },
    { path: "/app?view=sequences", nextExpected: "%2Fapp%3Fview%3Dsequences" },
  ];

  for (const r of protectedAppRoutes) {
    const res = await fetchRoute(r.path);
    assert(res.status === 307, `Unauthenticated ${r.path} returns HTTP 307 redirect`, `got ${res.status}`);
    const location = res.headers["location"] || "";
    assert(location.startsWith("/login?next="), `${r.path} redirects to /login?next=...`);
    assert(location.includes(r.nextExpected), `${r.path} preserves return destination in next parameter`);
  }

  // Signout route test (POST only)
  const signoutRes = await fetchRoute("/auth/signout", { method: "POST" });
  assert(signoutRes.status === 303, "POST /auth/signout returns HTTP 303 redirect", `got ${signoutRes.status}`);
  const signoutLoc = signoutRes.headers["location"] || "";
  assert(signoutLoc.endsWith("/login"), "POST /auth/signout redirects cleanly to /login");

  // Open-redirect protection on /login?next=
  const openRedirectRes = await fetchRoute("/login?next=https://malicious-external-site.example");
  assert(openRedirectRes.status === 200, "Login page with external next parameter loads local login form (does not redirect externally)");

  // Role-gated checkout endpoint
  const checkoutRes = await fetchRoute("/api/billing/checkout");
  assert(checkoutRes.status === 303, "Unauthenticated /api/billing/checkout redirects (denies non-owner)", `got ${checkoutRes.status}`);
  assert((checkoutRes.headers["location"] || "").includes("/app?view=plan"), "Unauthenticated checkout redirects back to plan view");

  // Sensitive owner API endpoints reject unauthenticated access
  const ownerOffersRes = await fetchRoute("/api/owner/offers", { method: "POST" });
  assert(ownerOffersRes.status === 401, "POST /api/owner/offers returns HTTP 401 Unauthorized without auth", `got ${ownerOffersRes.status}`);

  const ownerVerifierRes = await fetchRoute("/api/owner/verifier-test", { method: "POST" });
  assert(ownerVerifierRes.status === 401, "POST /api/owner/verifier-test returns HTTP 401 Unauthorized without auth", `got ${ownerVerifierRes.status}`);
}

// ==============================================================================
// 6. Environment Configuration & Secret Leak Isolation
// ==============================================================================
async function testEnvironmentAndSecrets() {
  console.log("\n--- Suite 6: Environment Configuration & Secret Leak Isolation ---");

  // Check .env.example exists and has necessary templates
  const examplePath = path.join(ROOT_DIR, ".env.example");
  assert(fs.existsSync(examplePath), ".env.example exists in root directory");

  const exampleContent = fs.readFileSync(examplePath, "utf8");
  const requiredVars = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "MAIL_SERVER_SECRET",
    "RESEND_API_KEY",
    "CONTACT_INBOX",
  ];

  for (const v of requiredVars) {
    assert(exampleContent.includes(`${v}=`), `.env.example documents ${v}`);
  }

  // Ensure no real secrets are in .env.example
  assert(!exampleContent.includes("eyJhbGciOiJ"), ".env.example does not contain real JWT tokens");
  assert(!exampleContent.includes("re_1234567890"), ".env.example does not contain real Resend keys");
  assert(!exampleContent.includes("sk-ant-api"), ".env.example does not contain real Anthropic keys");

  // Audit that no server secrets are prefixed with NEXT_PUBLIC_ in any source file
  const srcFiles = getAllFiles(path.join(ROOT_DIR, "src"));
  let leakedPrefix = false;
  let clientImportSecret = false;

  const serverSecretNames = [
    "MAIL_SERVER_SECRET",
    "RESEND_API_KEY",
    "ANTHROPIC_API_KEY",
    "VERIFIER_SECRET",
    "SENTRY_AUTH_TOKEN",
  ];

  for (const file of srcFiles) {
    if (!file.endsWith(".ts") && !file.endsWith(".tsx") && !file.endsWith(".js") && !file.endsWith(".mjs")) continue;
    const content = fs.readFileSync(file, "utf8");

    for (const secret of serverSecretNames) {
      if (content.includes(`NEXT_PUBLIC_${secret}`)) {
        leakedPrefix = true;
        console.error(`Leaked prefix NEXT_PUBLIC_${secret} in ${file}`);
      }
    }

    // Check if client view components import or reference server secrets directly
    const isClientFile = file.includes("/src/app/app/") || file.includes("/src/components/");
    if (isClientFile) {
      for (const secret of serverSecretNames) {
        if (content.includes(`process.env.${secret}`)) {
          clientImportSecret = true;
          console.error(`Client file ${file} directly accesses process.env.${secret}`);
        }
      }
    }
  }

  assert(!leakedPrefix, "Zero server secrets are prefixed with NEXT_PUBLIC_");
  assert(!clientImportSecret, "Zero client UI files access server secrets");
}

function getAllFiles(dirPath, arrayOfFiles = []) {
  const files = fs.readdirSync(dirPath);
  for (const file of files) {
    const fullPath = path.join(dirPath, file);
    if (fs.statSync(fullPath).isDirectory()) {
      getAllFiles(fullPath, arrayOfFiles);
    } else {
      arrayOfFiles.push(fullPath);
    }
  }
  return arrayOfFiles;
}

// ==============================================================================
// 7. SEO & Metadata Routes
// ==============================================================================
async function testSeoAndMarketingRoutes() {
  console.log("\n--- Suite 7: SEO, Metadata & Public Marketing Routes ---");

  // robots.txt
  const robotsRes = await fetchRoute("/robots.txt");
  assert(robotsRes.status === 200, "GET /robots.txt returns HTTP 200", `got ${robotsRes.status}`);
  assert(/User-Agent:\s*\*/i.test(robotsRes.body), "robots.txt includes User-agent: *");
  assert(/Disallow:\s*\/app/i.test(robotsRes.body), "robots.txt disallows /app");
  assert(/Disallow:\s*\/login/i.test(robotsRes.body), "robots.txt disallows /login");
  assert(/Sitemap:/i.test(robotsRes.body), "robots.txt references sitemap.xml");

  // sitemap.xml
  const sitemapRes = await fetchRoute("/sitemap.xml");
  assert(sitemapRes.status === 200, "GET /sitemap.xml returns HTTP 200", `got ${sitemapRes.status}`);
  assert(sitemapRes.body.includes("<urlset") || sitemapRes.body.includes("<url>"), "sitemap.xml contains valid XML markup");
  assert(sitemapRes.body.includes("https://kestrelleads.com/pricing"), "sitemap.xml lists /pricing");
  assert(sitemapRes.body.includes("https://kestrelleads.com/security"), "sitemap.xml lists /security");

  // Root redirect test
  const rootRes = await fetchRoute("/");
  assert(rootRes.status === 307 && rootRes.headers["location"] === "/app", "Public root / correctly redirects to /app");

  // Public marketing and legal pages
  const publicPages = [
    "/features",
    "/how-it-works",
    "/use-cases",
    "/pricing",
    "/security",
    "/help",
    "/about",
    "/contact",
    "/creators",
    "/privacy",
    "/terms",
    "/cookies",
    "/acceptable-use",
    "/dpa",
    "/subprocessors",
    "/login",
    "/signup",
  ];

  for (const page of publicPages) {
    const res = await fetchRoute(page);
    assert(res.status === 200, `Public page ${page} returns HTTP 200`, `got ${res.status}`);
  }
}

// ==============================================================================
// Main Runner
// ==============================================================================
async function run() {
  console.log("==================================================================");
  console.log("KESTREL PHASE 1.5: PRODUCTION READINESS & ASSET HARDENING AUDIT");
  console.log("Base URL:", BASE_URL);
  console.log("==================================================================");

  try {
    await testStaticAssets();
    await testSecurityHeadersMatrix();
    await testCspCompatibility();
    await testPrivateDownloadsAndSecurity();
    await testAuthRedirectsAndRoles();
    await testEnvironmentAndSecrets();
    await testSeoAndMarketingRoutes();

    console.log("\n==================================================================");
    console.log(`TOTAL TESTS: ${totalTests}`);
    console.log(`PASSED:      ${passedTests}`);
    console.log(`FAILED:      ${failedTests}`);
    console.log("==================================================================");

    if (failedTests > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error("Test execution error:", err);
    process.exit(1);
  }
}

run();
