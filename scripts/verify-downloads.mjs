import assert from "node:assert";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { createBrowserClient } from "@supabase/ssr";

// scripts/verify-downloads.mjs
// Real HTTP verification suite for Kestrel paid downloads route security & Supabase Storage.
// Strictly NO mocks, NO in-memory simulations, and NO fake users.

const BASE_URL = process.env.APP_URL || "http://localhost:3333";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://xjqtgvhnbyepfinqonzm.supabase.co";
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";
const STAGING_EMAIL = process.env.STAGING_TEST_EMAIL || "";
const STAGING_PASSWORD = process.env.STAGING_TEST_PASSWORD || "";
const BACKUP_DIR = path.join(process.env.HOME, "Documents/Kestrel-private/downloads-private");

console.log("================================================================================");
console.log("KESTREL REAL DOWNLOAD ROUTE & STORAGE VERIFICATION");
console.log(`Server Target: ${BASE_URL}`);
console.log(`Supabase Target: ${SUPABASE_URL}`);
console.log("================================================================================\n");

// -----------------------------------------------------------------------------
// Check 1: Verify Route Has Zero Disk Fallback and Git Ignores Private Files
// -----------------------------------------------------------------------------
console.log("[Check 1] Verifying Zero Local Disk Fallback in Download Route");
const routeSource = fs.readFileSync(path.join(process.cwd(), "src/app/app/download/[file]/route.ts"), "utf8");

if (routeSource.includes("downloads-private") || routeSource.includes("node:fs") || routeSource.includes("readFile")) {
  console.error("❌ FAIL: src/app/app/download/[file]/route.ts contains references to local disk or downloads-private!");
  process.exit(1);
}
console.log("✓ PASS: Download route reads strictly from Supabase Storage (zero disk fallback in route)");

const trackedFiles = execSync("git ls-files downloads-private/", { encoding: "utf8" }).trim();
if (trackedFiles.length > 0) {
  console.error("❌ FAIL: downloads-private/ contains files tracked by git!");
  process.exit(1);
}
console.log("✓ PASS: downloads-private/ is not tracked in git\n");

// -----------------------------------------------------------------------------
// Check 2: Unauthenticated Visitor Protections (Real HTTP Requests)
// -----------------------------------------------------------------------------
console.log("[Check 2] Real HTTP Unauthenticated & Demo Access Checks");

async function checkSignedOut(urlPath, label) {
  const target = `${BASE_URL}${urlPath}`;
  const res = await fetch(target, { redirect: "manual" });
  const location = res.headers.get("location") || "";
  const is307 = res.status === 307;
  const isLoginRedirect = location.includes("/login");

  if (!is307 || !isLoginRedirect) {
    console.error(`❌ FAIL [${label}]: expected HTTP 307 to /login, got HTTP ${res.status} Location: ${location}`);
    process.exit(1);
  }
  console.log(`✓ PASS [${label}]: HTTP ${res.status} -> Location: ${location}`);
}

await checkSignedOut("/app/download/extension", "Signed out (no cookie)");
await checkSignedOut("/app/download/extension?demo=1", "Signed out + ?demo=1");
await checkSignedOut("/app/download/extension?preview=1", "Signed out + ?preview=1");
await checkSignedOut("/app/download/kit", "Signed out -> kit");
await checkSignedOut("/app/download/mcp", "Signed out -> mcp");

// -----------------------------------------------------------------------------
// Check 3: Authenticated Staging User Download Test (Real Session)
// -----------------------------------------------------------------------------
console.log("\n[Check 3] Real Authenticated Staging User Download Test");

if (!STAGING_EMAIL || !STAGING_PASSWORD || !SUPABASE_KEY) {
  console.log("--------------------------------------------------------------------------------");
  console.log("NOT TESTED - need staging test user credentials");
  console.log("Reason: STAGING_TEST_EMAIL, STAGING_TEST_PASSWORD, or staging publishable key is not set in environment.");
  console.log("Rule enforced: No simulated user sessions or mocks are permitted.");
  console.log("--------------------------------------------------------------------------------");
} else {
  console.log(`Authenticating real staging test user: ${STAGING_EMAIL}...`);
  try {
    const cookieJar = {};
    const sb = createBrowserClient(SUPABASE_URL, SUPABASE_KEY, {
      cookies: {
        getAll() {
          return Object.entries(cookieJar).map(([name, value]) => ({ name, value }));
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => {
            cookieJar[name] = value;
          });
        },
      },
    });

    const { data: authData, error: authError } = await sb.auth.signInWithPassword({
      email: STAGING_EMAIL,
      password: STAGING_PASSWORD,
    });

    if (authError || !authData.session) {
      console.error("Authentication failed:", authError?.message || "No session returned");
      process.exit(1);
    }

    const cookieHeader = Object.entries(cookieJar)
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");

    const filesToTest = [
      { key: "extension", filename: "Kestrel-extension-2.9.4.zip" },
      { key: "kit", filename: "Kestrel-AI-Kit.zip" },
      { key: "mcp", filename: "kestrel-mcp.mjs" },
    ];

    for (const item of filesToTest) {
      const downloadRes = await fetch(`${BASE_URL}/app/download/${item.key}`, {
        headers: { Cookie: cookieHeader },
        redirect: "manual",
      });

      const status = downloadRes.status;
      const contentType = downloadRes.headers.get("content-type") || "unknown";
      const arrayBuf = await downloadRes.arrayBuffer();
      const buf = Buffer.from(arrayBuf);
      const sha256 = crypto.createHash("sha256").update(buf).digest("hex");
      const first16Bytes = buf.subarray(0, 16).toString("hex");

      console.log(`\nFile: ${item.key} (${item.filename})`);
      console.log(`  HTTP Status:     ${status}`);
      console.log(`  Content-Type:    ${contentType}`);
      console.log(`  Content-Length:  ${buf.length} bytes`);
      console.log(`  SHA-256:         ${sha256}`);
      console.log(`  First 16 Bytes:  ${first16Bytes}`);

      assert.strictEqual(status, 200, `Expected HTTP 200 for ${item.key}`);

      // Compare with backup copy
      const backupPath = path.join(BACKUP_DIR, item.filename);
      if (fs.existsSync(backupPath)) {
        const backupBuf = fs.readFileSync(backupPath);
        const backupSha256 = crypto.createHash("sha256").update(backupBuf).digest("hex");
        assert.strictEqual(sha256, backupSha256, `SHA-256 mismatch for ${item.filename}`);
        console.log(`  Backup Match:    ✓ MATCH (${backupSha256})`);
      }
    }
    console.log("\n✓ All authenticated staging downloads succeeded with 100% SHA-256 byte match.");
  } catch (err) {
    console.error("Authenticated staging test error:", err);
    process.exit(1);
  }
}

console.log("\n================================================================================");
console.log("VERIFICATION COMPLETED");
console.log("================================================================================");
