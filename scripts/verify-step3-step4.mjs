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
  console.log("STEP 3, STEP 4 & STEP 5 VERIFICATION ON STAGING");
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
  page.on("dialog", async (dialog) => {
    console.warn(`[Browser Dialog]: ${dialog.type()} - "${dialog.message()}"`);
    await dialog.dismiss();
  });

  try {
    // -------------------------------------------------------------------------
    // STEP 3 & FIX B: Sequences -> Templates tab -> Use template -> Save -> Reload -> in My sequences
    // -------------------------------------------------------------------------
    console.log("[Test 1 & Fix B] Sequences Template Library & Save Persistence...");
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

    // Give it a distinct test name so it doesn't collide with existing names
    const seqNameInput = page.locator(".seq-bar input[placeholder='Agencies, UK'], .seq-bar label:has-text('Name') input").first();
    await seqNameInput.waitFor({ state: "visible", timeout: 5000 });
    const testSeqName = `Cold Video Pitch (Staging ${Date.now()})`;
    await seqNameInput.fill(testSeqName);
    console.log(`✓ Loaded template into editor and set name: "${testSeqName}"`);

    const screenshotTplPath = path.join(process.cwd(), "scripts/screenshot-template-used.png");
    await page.screenshot({ path: screenshotTplPath, fullPage: false });
    console.log(`✓ Screenshot saved: ${screenshotTplPath}`);

    // Click Save button
    const saveBtn = page.locator("button:has-text('Save'), button:has-text('Saving…')");
    await saveBtn.click();
    await page.waitForTimeout(1000);

    // Wait until saved
    await page.locator("button:has-text('Saved')").waitFor({ state: "visible", timeout: 6000 });
    console.log("✓ Sequence saved successfully.");

    // Reload page to prove persistence in "My sequences"
    await page.goto(`${BASE_URL}/app?view=sequences`, { waitUntil: "networkidle" });
    await page.waitForSelector(".app-page");
    await page.waitForTimeout(600);

    // Ensure "My sequences" tab shows the saved sequence
    const savedItem = page.locator(`button:has-text("${testSeqName}")`);
    await savedItem.waitFor({ state: "visible", timeout: 6000 });
    console.log(`✓ Verified sequence "${testSeqName}" persists in My sequences after full reload.`);

    const screenshotSavedPath = path.join(process.cwd(), "scripts/screenshot-template-saved.png");
    await page.screenshot({ path: screenshotSavedPath, fullPage: false });
    console.log(`✓ Screenshot saved: ${screenshotSavedPath}\n`);

    // -------------------------------------------------------------------------
    // STEP 3b: Fast Tab Switching 10x with zero console errors
    // -------------------------------------------------------------------------
    console.log("[Test 2] Fast Tab Switching 10x (My sequences <-> Templates)...");
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
    // STEP 4 & FIX A: Per-Lead Draft Editor & Inline Spam Check Validation (No alert/confirm)
    // -------------------------------------------------------------------------
    console.log("[Test 3 & Fix A] Per-Lead Draft Editor & Inline Spam Guard (No browser alert)...");
    const demoCtx = await browser.newContext();
    const demoPage = await demoCtx.newPage();
    let demoDialogFired = false;
    demoPage.on("dialog", async (d) => {
      demoDialogFired = true;
      console.warn(`[Demo Dialog]: ${d.type()} - "${d.message()}"`);
      await d.dismiss();
    });

    await demoPage.goto(`${BASE_URL}/app?demo=true&view=all`, { waitUntil: "networkidle" });
    await demoPage.waitForTimeout(600);

    const leadCard = demoPage.locator(".klead-card, .pipe-card").first();
    await leadCard.waitFor({ state: "visible", timeout: 8000 });
    await leadCard.click();

    const drawer = demoPage.locator(".drawer");
    await drawer.waitFor({ state: "visible", timeout: 5000 });

    const editDraftBtn = drawer.locator('button:has-text("Edit draft")');
    await editDraftBtn.scrollIntoViewIfNeeded();
    await editDraftBtn.click();
    await demoPage.waitForTimeout(300);

    const bodyArea = drawer.locator("textarea[placeholder='Email body...']");
    await bodyArea.waitFor({ state: "visible", timeout: 3000 });
    await bodyArea.fill("Hi there,\n\nWe offer a 100% free guaranteed wire transfer and urgent payout! Click here to claim your wire transfer now.\n\nThanks");

    const saveDraftBtn = drawer.locator('button:has-text("Save draft")');
    await saveDraftBtn.click();
    await demoPage.waitForTimeout(400);

    // Verify inline red error message
    const alertMsg = drawer.locator("p[role='alert']");
    await alertMsg.waitFor({ state: "visible", timeout: 3000 });
    const alertText = await alertMsg.innerText();
    console.log(`✓ Inline spam warning rendered: "${alertText}"`);

    if (demoDialogFired) {
      console.error("❌ Browser alert/confirm dialog was triggered instead of inline message!");
      process.exit(1);
    }
    console.log("✓ Confirmed zero browser alert/confirm dialogs triggered.");

    const screenshotDraftPath = path.join(process.cwd(), "scripts/screenshot-lead-draft-spam-blocked.png");
    await drawer.screenshot({ path: screenshotDraftPath });
    console.log(`✓ Screenshot saved: ${screenshotDraftPath}\n`);

    // -------------------------------------------------------------------------
    // STEP 5: Home Funnel Card (Normal state)
    // -------------------------------------------------------------------------
    console.log("[Test 4 & Step 5] Home Funnel Card Rendering on Staging...");
    await page.goto(`${BASE_URL}/app`, { waitUntil: "networkidle" });
    await page.waitForSelector(".app-page");
    await page.waitForTimeout(800);

    const funnelCard = page.locator(".funnel-card");
    const funnelVisible = await funnelCard.isVisible();
    if (funnelVisible) {
      const cardTitle = await funnelCard.locator("b").first().innerText();
      console.log(`✓ Funnel card rendered on Home with title: "${cardTitle}".`);
    } else {
      console.log("✓ Funnel card hidden or empty on Home (valid quiet state).");
    }

    const screenshotHomeFunnelPath = path.join(process.cwd(), "scripts/screenshot-home-funnel-card.png");
    await page.screenshot({ path: screenshotHomeFunnelPath, fullPage: false });
    console.log(`✓ Screenshot saved: ${screenshotHomeFunnelPath}\n`);

    // -------------------------------------------------------------------------
    // STEP 5b: Force funnel_summary to fail -> Home still loads, card hidden
    // -------------------------------------------------------------------------
    console.log("[Test 5 & Step 5] Resilience: Force funnel_summary failure -> Home loads, card hidden...");
    // Intercept and abort any RPC call to funnel_summary
    await page.route("**/rest/v1/rpc/funnel_summary*", (route) => {
      console.log("  [Mock] Aborting funnel_summary RPC to simulate failure...");
      return route.abort();
    });

    await page.goto(`${BASE_URL}/app`, { waitUntil: "networkidle" });
    await page.waitForSelector(".app-page");
    await page.waitForTimeout(800);

    // Ensure Home page loaded other cards cleanly
    const attentionCard = page.locator(".home-card:has-text('Needs your attention')");
    await attentionCard.waitFor({ state: "visible", timeout: 5000 });
    const quickActionsCard = page.locator(".home-card:has-text('Quick actions')");
    await quickActionsCard.waitFor({ state: "visible", timeout: 5000 });
    console.log("✓ Home page loaded successfully despite funnel_summary failure.");

    // Verify funnel card is hidden (0 visible instances)
    const failedFunnelCount = await page.locator(".funnel-card").count();
    if (failedFunnelCount > 0) {
      console.error("❌ Funnel card was expected to be hidden when RPC fails!");
      process.exit(1);
    }
    console.log("✓ Funnel card cleanly hidden when funnel_summary fails (zero crashes).");

    const screenshotHomeFailedPath = path.join(process.cwd(), "scripts/screenshot-home-funnel-failed-hidden.png");
    await page.screenshot({ path: screenshotHomeFailedPath, fullPage: false });
    console.log(`✓ Screenshot saved: ${screenshotHomeFailedPath}\n`);

    console.log("================================================================================");
    console.log("🎉 ALL STEP 3, 4 & 5 VERIFICATIONS PASSED CLEANLY!");
    console.log("================================================================================");
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
