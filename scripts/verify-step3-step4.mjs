import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { createBrowserClient } from "@supabase/ssr";

// Load staging environment
const envPath = path.join(process.cwd(), ".env.staging.local");
if (fs.existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const BASE_URL = process.env.APP_URL || "http://localhost:3333";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://xjqtgvhnbyepfinqonzm.supabase.co";
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";
const STAGING_EMAIL = process.env.STAGING_TEST_EMAIL || "";
const STAGING_PASSWORD = process.env.STAGING_TEST_PASSWORD || "";

async function main() {
  console.log("================================================================================");
  console.log("STEP 3 & STEP 4 VERIFICATION ON STAGING");
  console.log(`Target: ${BASE_URL}`);
  console.log(`Supabase URL: ${SUPABASE_URL}`);
  console.log("================================================================================\n");

  if (!STAGING_EMAIL || !STAGING_PASSWORD || !SUPABASE_KEY) {
    console.error("❌ Staging credentials missing from .env.staging.local");
    process.exit(1);
  }

  // 1. Authenticate real staging user
  console.log(`[Auth] Authenticating real staging user: ${STAGING_EMAIL}...`);
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
    console.error("❌ Auth failed:", authError?.message || "No session");
    process.exit(1);
  }
  console.log("✓ Real staging session acquired successfully.\n");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();

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
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push(msg.text());
    }
  });
  page.on("pageerror", (err) => {
    consoleErrors.push(err.message);
  });

  try {
    // -------------------------------------------------------------------------
    // STEP 3: Sequences -> Templates tab -> Use template -> New sequence
    // -------------------------------------------------------------------------
    console.log("[Test 1] Sequences Template Library & Cloning...");
    await page.goto(`${BASE_URL}/app?view=sequences`, { waitUntil: "networkidle" });
    await page.waitForSelector(".app-page");

    // Click Templates tab
    const tplTabBtn = page.locator('button[role="tab"]:has-text("Templates")');
    await tplTabBtn.click();
    await page.waitForTimeout(400);

    // Verify template card exists
    const firstTplCard = page.locator(".seq-tpl-card, article:has-text('Use this template')").first();
    await firstTplCard.waitFor({ state: "visible", timeout: 5000 });
    console.log("✓ Template library loaded and rendered template cards.");

    // Click "Use this template"
    const useBtn = firstTplCard.locator('button:has-text("Use this template")');
    await useBtn.click();
    await page.waitForTimeout(500);

    // Verify sequence editor is open with copy name
    await page.waitForSelector(".seq-top, input[aria-label='Sequence name'], input[value*='copy']", { timeout: 5000 });
    const headerTitle = await page.locator(".head h1").innerText();
    console.log(`✓ Loaded template into editor. Header: "${headerTitle}"`);

    const screenshotTplPath = path.join(process.cwd(), "scripts/screenshot-template-used.png");
    await page.screenshot({ path: screenshotTplPath, fullPage: false });
    console.log(`✓ Screenshot saved: ${screenshotTplPath}\n`);

    // -------------------------------------------------------------------------
    // STEP 3b: Fast Tab Switching 10x with zero console errors
    // -------------------------------------------------------------------------
    console.log("[Test 2] Fast Tab Switching 10x (My sequences <-> Templates)...");
    await page.goto(`${BASE_URL}/app?view=sequences`, { waitUntil: "networkidle" });
    await page.waitForSelector(".app-page");

    const mySeqTab = page.locator('button[role="tab"]:has-text("My sequences")');
    const tplTab = page.locator('button[role="tab"]:has-text("Templates")');

    const errCountBefore = consoleErrors.length;
    for (let i = 0; i < 10; i++) {
      await mySeqTab.click();
      await tplTab.click();
    }
    await page.waitForTimeout(300);
    const newErrors = consoleErrors.slice(errCountBefore);
    if (newErrors.length > 0) {
      console.error("❌ Console errors detected during fast tab switching:", newErrors);
      process.exit(1);
    }
    console.log("✓ Switched tabs 10x rapidly with zero console errors.\n");

    // -------------------------------------------------------------------------
    // STEP 4: Per-Lead Draft Editor & Spam Check Validation
    // -------------------------------------------------------------------------
    console.log("[Test 3] Per-Lead Draft Editor & Spam Guard Blocking...");
    // Use an isolated demo page without cookies to open a lead with an existing draft
    const demoCtx = await browser.newContext();
    const demoPage = await demoCtx.newPage();
    await demoPage.goto(`${BASE_URL}/app?demo=true&view=all`, { waitUntil: "networkidle" });
    await demoPage.waitForTimeout(600);

    const leadCard = demoPage.locator(".klead-card, .pipe-card").first();
    await leadCard.waitFor({ state: "visible", timeout: 8000 });
    await leadCard.click();

    // Wait for drawer to open
    const drawer = demoPage.locator(".drawer");
    await drawer.waitFor({ state: "visible", timeout: 5000 });

    // Click "Edit draft"
    const editDraftBtn = drawer.locator('button:has-text("Edit draft")');
    await editDraftBtn.scrollIntoViewIfNeeded();
    await editDraftBtn.click();
    await demoPage.waitForTimeout(300);

    // Fill spam trigger text
    const bodyArea = drawer.locator("textarea[placeholder='Email body...']");
    await bodyArea.waitFor({ state: "visible", timeout: 3000 });
    await bodyArea.fill("Hi there,\n\nWe offer a 100% free guaranteed wire transfer and urgent payout! Click here to claim your wire transfer now.\n\nThanks");

    // Click Save draft
    const saveDraftBtn = drawer.locator('button:has-text("Save draft")');
    await saveDraftBtn.click();
    await demoPage.waitForTimeout(400);

    // Verify warning / blocking message
    const alertMsg = drawer.locator("p[role='alert']");
    await alertMsg.waitFor({ state: "visible", timeout: 3000 });
    const alertText = await alertMsg.innerText();
    console.log(`✓ Save draft blocked by spam guard: "${alertText}"`);

    const screenshotDraftPath = path.join(process.cwd(), "scripts/screenshot-lead-draft-spam-blocked.png");
    await drawer.screenshot({ path: screenshotDraftPath });
    console.log(`✓ Screenshot saved: ${screenshotDraftPath}\n`);

    console.log("================================================================================");
    console.log("🎉 ALL STEP 3 & STEP 4 VERIFICATIONS PASSED CLEANLY!");
    console.log("================================================================================");
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
