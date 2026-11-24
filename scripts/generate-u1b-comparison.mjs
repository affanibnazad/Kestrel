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
  console.log("TASK U1b: SIDE-BY-SIDE COMPARISON (connections.html VS /app?view=settings&tab=connections)");
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

  console.log(`✓ Authenticated as: ${STAGING_EMAIL}\n`);

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

  await page.addInitScript(() => {
    try {
      localStorage.setItem("kestrel-consent", JSON.stringify({ v: 1, analytics: false, marketing: false, at: "2026-11-23T12:00:00Z" }));
      localStorage.setItem("kestrel_cookie_consent", JSON.stringify({ v: 1, analytics: false, marketing: false, at: "2026-11-23T12:00:00Z" }));
    } catch {}
  });

  const refUrl = `file://${path.resolve("docs/ui-reference/connections.html")}`;
  const realUrl = `${BASE_URL}/app?view=settings&tab=connections`;

  const themes = ["light", "dark", "gradient"];

  const HIDE_DEV_INDICATOR_CSS = `
    nextjs-portal,
    [data-nextjs-toast],
    #__next-build-watcher,
    div[data-nextjs-dialog-overlay] {
      display: none !important;
      visibility: hidden !important;
    }
  `;

  for (const theme of themes) {
    console.log(`--- Capturing Theme: ${theme.toUpperCase()} ---`);

    // 1. Capture Reference
    await page.goto(refUrl);
    await page.evaluate((t) => {
      document.documentElement.setAttribute("data-theme", t);
    }, theme);
    await page.waitForTimeout(500);
    const refBuf = await page.screenshot({ fullPage: true });
    console.log(`✓ Reference captured (${theme})`);

    // 2. Capture Real App
    const realUrlWithTheme = `${realUrl}&theme=${theme}`;
    await page.goto(realUrlWithTheme, { waitUntil: "networkidle" });
    await page.evaluate((t) => {
      document.documentElement.setAttribute("data-theme", t);
      try {
        localStorage.setItem("kestrel-look", JSON.stringify({ theme: t, accent: "peri", reduceMotion: false }));
      } catch {}
      const banner = document.querySelector(".cookie-banner, .consent-banner, [aria-label*=\"cookie\" i]");
      if (banner) banner.remove();
    }, theme);
    await page.addStyleTag({ content: HIDE_DEV_INDICATOR_CSS });
    await page.waitForTimeout(800);
    const realBuf = await page.screenshot({ fullPage: true });
    console.log(`✓ Real App captured (${theme})`);

    // 3. Create Side-by-Side comparison HTML
    const compHtml = `
      <!doctype html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Side-by-side comparison - ${theme}</title>
        <style>
          body { margin: 0; background: #0b0e14; font-family: -apple-system, sans-serif; display: flex; flex-direction: column; }
          .header { display: flex; background: #161b22; color: #fff; font-size: 13px; font-weight: 600; padding: 12px 20px; border-bottom: 1px solid #30363d; letter-spacing: 0.5px; }
          .header-col { flex: 1; text-align: center; }
          .container { display: flex; flex-direction: row; width: 100%; }
          .col { flex: 1; min-width: 0; border-right: 2px solid #30363d; background: #000; }
          .col:last-child { border-right: none; }
          img { display: block; width: 100%; height: auto; }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="header-col">REFERENCE: docs/ui-reference/connections.html [${theme.toUpperCase()}]</div>
          <div class="header-col">REAL APP: /app?view=settings&tab=connections [${theme.toUpperCase()}]</div>
        </div>
        <div class="container">
          <div class="col"><img src="data:image/png;base64,${refBuf.toString("base64")}"></div>
          <div class="col"><img src="data:image/png;base64,${realBuf.toString("base64")}"></div>
        </div>
      </body>
      </html>
    `;

    const compPage = await context.newPage();
    await compPage.setContent(compHtml);
    await compPage.waitForTimeout(500);
    const compPath = path.join(diffsDir, `u1b-comparison-${theme}.png`);
    await compPage.screenshot({ path: compPath, fullPage: true });
    await compPage.close();

    console.log(`📸 Saved side-by-side comparison: ${compPath}\n`);
  }

  await browser.close();
  console.log("================================================================================");
  console.log("✓ ALL U1b COMPARISONS COMPLETED!");
  console.log("================================================================================");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
