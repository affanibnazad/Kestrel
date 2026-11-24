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
  console.log("GENERATING SIDE-BY-SIDE SCREENSHOT COMPARISONS (REFERENCE VS /app/dev/components)");
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
  const context = await browser.newContext({ viewport: { width: 1280, height: 950 } });

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

  const refPath = "file://" + path.resolve("docs/ui-reference/connections.html");
  const themes = ["light", "dark", "gradient"];

  for (const theme of themes) {
    console.log(`\n--- Capturing Theme: ${theme.toUpperCase()} ---`);

    // 1. Capture Reference
    const refPage = await browser.newPage({ viewport: { width: 1280, height: 950 } });
    await refPage.goto(refPath, { waitUntil: "networkidle" });
    await refPage.evaluate((t) => {
      document.documentElement.setAttribute("data-theme", t);
      document.querySelectorAll("[data-set]").forEach((btn) => {
        btn.setAttribute("aria-pressed", btn.getAttribute("data-set") === t ? "true" : "false");
      });
    }, theme);
    await refPage.waitForTimeout(500);
    const refBuf = await refPage.screenshot({ fullPage: true });
    await refPage.close();
    console.log(`✓ Reference captured (${theme})`);

    // 2. Capture App Dev Components
    const appPage = await context.newPage();
    await appPage.addInitScript(() => {
      try {
        localStorage.setItem("kestrel-consent", JSON.stringify({ v: 1, analytics: false, marketing: false, at: "2026-11-23T12:00:00Z" }));
        localStorage.setItem("kestrel_cookie_consent", JSON.stringify({ v: 1, analytics: false, marketing: false, at: "2026-11-23T12:00:00Z" }));
      } catch {}
    });

    const appUrl = `${BASE_URL}/app/dev/components?theme=${theme}`;
    await appPage.goto(appUrl, { waitUntil: "networkidle" });
    await appPage.addStyleTag({ content: "nextjs-portal, #cookie-banner { display: none !important; }" });
    await appPage.evaluate((t) => {
      document.documentElement.setAttribute("data-theme", t);
      try {
        localStorage.setItem("kestrel-consent", JSON.stringify({ v: 1, analytics: false, marketing: false, at: "2026-11-23T12:00:00Z" }));
      } catch {}
    }, theme);
    await appPage.waitForTimeout(1000);
    const appBuf = await appPage.screenshot({ fullPage: true });
    await appPage.close();
    console.log(`✓ App captured (${theme})`);

    // 3. Compose Side-by-Side Image
    const stitchPage = await browser.newPage({ viewport: { width: 2560, height: 950 } });
    const refBase64 = refBuf.toString("base64");
    const appBase64 = appBuf.toString("base64");

    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #0f1117; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; flex-direction: column; width: 2560px; }
    .header-row { display: flex; width: 2560px; background: #181b24; color: #ffffff; padding: 14px 32px; font-size: 16px; font-weight: 600; letter-spacing: 0.02em; border-bottom: 2px solid #2d3345; }
    .header-col { flex: 1; text-align: center; }
    .header-col.left { border-right: 1px solid #2d3345; }
    .preview-row { display: flex; width: 2560px; }
    .preview-col { width: 1280px; }
    .preview-col.left { border-right: 1px solid #2d3345; }
    .preview-col img { width: 1280px; display: block; }
  </style>
</head>
<body>
  <div class="header-row">
    <div class="header-col left">REFERENCE: docs/ui-reference/connections.html [${theme.toUpperCase()}]</div>
    <div class="header-col">YOUR PAGE: /app/dev/components [${theme.toUpperCase()}]</div>
  </div>
  <div class="preview-row">
    <div class="preview-col left"><img src="data:image/png;base64,${refBase64}" /></div>
    <div class="preview-col"><img src="data:image/png;base64,${appBase64}" /></div>
  </div>
</body>
</html>
    `;

    await stitchPage.setContent(htmlContent);
    await stitchPage.waitForTimeout(300);
    const outPath = path.join(diffsDir, `comparison-${theme}.png`);
    await stitchPage.screenshot({ path: outPath, fullPage: true });
    await stitchPage.close();
    console.log(`📸 Saved side-by-side comparison: ${outPath}`);
  }

  await browser.close();
  console.log("\n================================================================================");
  console.log("✓ ALL 3 COMPARISONS COMPLETED SUCCESSFULLY!");
  console.log("================================================================================");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
