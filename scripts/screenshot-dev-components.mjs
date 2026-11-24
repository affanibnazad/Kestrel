import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { createBrowserClient } from "@supabase/ssr";

const envPath = path.join(process.cwd(), ".env.staging.local");
if (fs.existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const BASE_URL = process.env.APP_URL || "http://localhost:3333";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://xjqtgvhnbyepfinqonzm.supabase.co";
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";
const STAGING_EMAIL = process.env.STAGING_TEST_EMAIL || "";
const STAGING_PASSWORD = process.env.STAGING_TEST_PASSWORD || "";

const diffsDir = path.join(process.cwd(), "tests/visual-diffs");
if (!fs.existsSync(diffsDir)) {
  fs.mkdirSync(diffsDir, { recursive: true });
}

async function main() {
  console.log("================================================================================");
  console.log("SCREENSHOTTING /app/dev/components IN LIGHT & DARK MODE");
  console.log("================================================================================");

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
    console.error("❌ Staging authentication failed:", authError?.message || "No session");
    process.exit(1);
  }

  console.log(`✓ Authenticated as: ${STAGING_EMAIL}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });

  const playwrightCookies = Object.entries(cookieJar).map(([name, value]) => ({
    name,
    value,
    domain: "localhost",
    path: "/",
    httpOnly: false,
    secure: false,
    sameSite: "Lax",
  }));
  await context.addCookies(playwrightCookies);

  const page = await context.newPage();

  // Accept cookies
  await page.addInitScript(() => {
    try {
      localStorage.setItem("kestrel-consent", JSON.stringify({ v: 1, analytics: false, marketing: false, at: "2026-11-23T12:00:00Z" }));
      localStorage.setItem("kestrel_cookie_consent", JSON.stringify({ v: 1, analytics: false, marketing: false, at: "2026-11-23T12:00:00Z" }));
    } catch {}
  });

  const targetUrl = `${BASE_URL}/app/dev/components`;
  console.log(`Navigating to ${targetUrl}...`);
  await page.goto(targetUrl, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);

  // 1. Light mode screenshot
  await page.evaluate(() => {
    document.documentElement.setAttribute("data-theme", "light");
  });
  await page.waitForTimeout(500);
  const lightPath = path.join(diffsDir, "dev-components-light.png");
  await page.screenshot({ path: lightPath, fullPage: true });
  console.log(`📸 Saved light mode screenshot: ${lightPath}`);

  // 2. Dark mode screenshot
  await page.evaluate(() => {
    document.documentElement.setAttribute("data-theme", "dark");
  });
  await page.waitForTimeout(500);
  const darkPath = path.join(diffsDir, "dev-components-dark.png");
  await page.screenshot({ path: darkPath, fullPage: true });
  console.log(`📸 Saved dark mode screenshot: ${darkPath}`);

  await browser.close();
  console.log("\n✓ All screenshots captured successfully!");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
