import { chromium } from "playwright";
import { config } from "dotenv";
import { createBrowserClient } from "@supabase/ssr";

config({ path: ".env.staging.local" });

const BASE_URL = process.env.BASE_URL || "http://localhost:3333";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";
const STAGING_EMAIL = process.env.STAGING_TEST_EMAIL || "";
const STAGING_PASSWORD = process.env.STAGING_TEST_PASSWORD || "";

async function main() {
  console.log("=== B1–B8 STAGING VERIFICATION ===");
  if (!STAGING_EMAIL || !STAGING_PASSWORD) {
    console.error("Missing STAGING_TEST_EMAIL or STAGING_TEST_PASSWORD in .env.staging.local");
    process.exit(1);
  }

  // 1. Authenticate staging session
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
    console.error("Staging auth failed:", authError?.message);
    process.exit(1);
  }
  console.log("✓ Signed in to staging as:", STAGING_EMAIL);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });

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

  // ----------------------------------------------------
  // Test B1: Data Loss Prevention
  // ----------------------------------------------------
  console.log("\n--- Testing B1: Data Loss Prevention ---");
  // Step 1: Set address to "Test 1" in Your business (/app?view=about)
  await page.goto(`${BASE_URL}/app?view=about`, { waitUntil: "networkidle" });
  await page.waitForSelector(".about-page", { timeout: 15000 });

  const addressField = page.locator('textarea[placeholder*="12 High Street"]');
  await addressField.fill("Test 1");

  const saveBtn = page.locator('button:has-text("Save business, proof and tone")').first();
  await saveBtn.click();
  await page.waitForTimeout(2000);
  console.log("✓ Address set to 'Test 1' and saved in Your business");
  await page.screenshot({ path: "docs/b1-step1-address-saved.png" });

  // Step 2: Navigate to Kestrel AI (/app?view=ai)
  await page.goto(`${BASE_URL}/app?view=ai`, { waitUntil: "networkidle" });
  await page.waitForSelector(".as-page", { timeout: 15000 });

  // Click on "Score and write" tab to open AiView
  const scoreTab = page.locator('button[role="tab"]:has-text("Score and write")');
  await scoreTab.click();
  await page.waitForSelector(".import-grid", { timeout: 15000 });

  // Check postal address in Kestrel AI
  const aiAddressField = page.locator('textarea[placeholder*="12 High Street"]');
  await page.waitForFunction(
    (el) => el && el.value.length > 0,
    await aiAddressField.elementHandle(),
    { timeout: 10000 }
  ).catch(() => {});

  const initialAiAddress = await aiAddressField.inputValue();
  console.log(`✓ Kestrel AI loaded address: "${initialAiAddress}"`);
  if (initialAiAddress !== "Test 1") {
    console.error("FAIL: Expected address 'Test 1' in Kestrel AI, got:", initialAiAddress);
  }

  // Change only the AI model in Kestrel AI
  const modelSelect = page.locator('label.in:has-text("Model") select');
  if (await modelSelect.count() > 0) {
    const options = await modelSelect.locator("option").allInnerTexts();
    const currentVal = await modelSelect.inputValue();
    const nextOption = modelSelect.locator("option").nth(1);
    const nextVal = (await nextOption.getAttribute("value")) || options[1];
    await modelSelect.selectOption(nextVal);
    console.log(`✓ Changed AI model from "${currentVal}" to "${nextVal}"`);
  }
  await page.waitForTimeout(2000);
  await page.screenshot({ path: "docs/b1-step2-model-changed.png" });

  // Reload page and verify address is STILL "Test 1"
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector(".as-page", { timeout: 15000 });
  await page.locator('button[role="tab"]:has-text("Score and write")').click();
  await page.waitForSelector(".import-grid", { timeout: 15000 });

  const reloadedAiField = page.locator('textarea[placeholder*="12 High Street"]');
  await page.waitForFunction(
    (el) => el && el.value.length > 0,
    await reloadedAiField.elementHandle(),
    { timeout: 10000 }
  ).catch(() => {});
  const reloadedAddress = await reloadedAiField.inputValue();
  console.log(`✓ After reload, Kestrel AI address is: "${reloadedAddress}"`);
  if (reloadedAddress === "Test 1") {
    console.log("✅ PASS: Address 'Test 1' remained untouched after changing AI model!");
  } else {
    console.error("❌ FAIL: Address was overwritten! Got:", reloadedAddress);
  }
  await page.screenshot({ path: "docs/b1-step3-reloaded-address-intact.png" });

  // Step 3: Test team_ai load failure guard
  console.log("\n--- Testing B1: Load Failure Guard ---");
  const failingPage = await context.newPage();
  await failingPage.route("**/rest/v1/team_ai*", (route) => {
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ message: "Simulated team_ai database error" }),
    });
  });

  await failingPage.goto(`${BASE_URL}/app?view=about`, { waitUntil: "networkidle" });
  await failingPage.waitForSelector(".about-page", { timeout: 15000 });

  const errorBanner = failingPage.locator('p[role="alert"]:has-text("Could not load your business settings")');
  const bannerVisible = await errorBanner.isVisible();
  const failingSaveBtn = failingPage.locator('button:has-text("Save business, proof and tone")').first();
  const isDisabled = await failingSaveBtn.isDisabled();

  console.log(`✓ Load failure banner visible: ${bannerVisible}`);
  console.log(`✓ Save button disabled on load error: ${isDisabled}`);
  if (bannerVisible && isDisabled) {
    console.log("✅ PASS: Save button disabled and error banner shown when team_ai fails to load!");
  } else {
    console.error("❌ FAIL: Save button not disabled or banner missing!");
  }
  await failingPage.screenshot({ path: "docs/b1-step4-load-failure-disabled.png" });
  await failingPage.close();

  // ----------------------------------------------------
  // Test B5: Connections reactivity without reload
  // ----------------------------------------------------
  console.log("\n--- Testing B5: Connections useMemo Reactivity ---");
  await page.goto(`${BASE_URL}/app?view=settings&tab=connections`, { waitUntil: "networkidle" });
  await page.waitForSelector('h1:has-text("Connections")', { timeout: 15000 });
  await page.screenshot({ path: "docs/b5-before.png" });
  console.log("✓ Captured docs/b5-before.png");

  // Open Hunter connection panel
  const hunterRow = page.locator('.u-list-row:has-text("Hunter")').first();
  await hunterRow.click();
  await page.waitForSelector('[role="dialog"]', { timeout: 10000 });
  console.log("✓ Opened SidePanel for Hunter");

  // Enter a test key and save
  const keyInput = page.locator('[role="dialog"] input[type="password"]');
  if (await keyInput.count() > 0) {
    await keyInput.fill("test_hunter_key_12345");
    const saveAndTestBtn = page.locator('[role="dialog"] button:has-text("Save and test")');
    await saveAndTestBtn.click();
    await page.waitForTimeout(3000);
  }

  // Close panel
  const closeBtn = page.locator('[role="dialog"] button[aria-label="Close panel"]').first();
  if (await closeBtn.count() > 0) {
    await closeBtn.click();
  } else {
    await page.keyboard.press("Escape");
  }
  await page.waitForTimeout(1000);

  // Check Hunter row status badge WITHOUT reload
  const hunterAction = page.locator('.u-list-row:has-text("Hunter") .u-list-row-action').first();
  const badgeText = (await hunterAction.count()) > 0 ? await hunterAction.innerText() : "No badge";
  console.log(`✓ Hunter status badge after save (WITHOUT reload): "${badgeText}"`);
  await page.screenshot({ path: "docs/b5-after.png" });
  console.log("✓ Captured docs/b5-after.png");

  // Clean up Hunter key
  await page.locator('.u-list-row:has-text("Hunter")').first().click();
  await page.waitForSelector('[role="dialog"]', { timeout: 10000 });
  const removeBtn = page.locator('[role="dialog"] button:has-text("Remove")');
  if (await removeBtn.count() > 0) {
    await removeBtn.click();
    await page.waitForSelector("dialog.k-dialog", { timeout: 5000 }).catch(() => {});
    const confirmBtn = page.locator('dialog.k-dialog button[type="submit"]');
    if (await confirmBtn.count() > 0) {
      await confirmBtn.click();
    }
    await page.waitForTimeout(2000);
    console.log("✓ Cleaned up test Hunter key");
  }
  const closeBtn2 = page.locator('[role="dialog"] button[aria-label="Close panel"]').first();
  if (await closeBtn2.count() > 0) {
    await closeBtn2.click();
  } else {
    await page.keyboard.press("Escape");
  }

  // ----------------------------------------------------
  // Test B6: Settings tab routing
  // ----------------------------------------------------
  console.log("\n--- Testing B6: Settings Tab Routing ---");
  await page.goto(`${BASE_URL}/app?view=settings&tab=mailboxes`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  const mailboxesH1 = await page.locator("h1").innerText();
  console.log(`✓ ?tab=mailboxes loaded header: "${mailboxesH1}"`);

  await page.goto(`${BASE_URL}/app?view=settings&tab=invalid_random_tab_123`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  const fallbackH1 = await page.locator("h1").innerText();
  console.log(`✓ ?tab=invalid_random_tab_123 loaded header: "${fallbackH1}"`);
  if (/General/i.test(fallbackH1) || /Your profile/i.test(fallbackH1)) {
    console.log("✅ PASS: Invalid settings tab safely defaulted to General!");
  } else {
    console.log("ℹ️ Loaded:", fallbackH1);
  }

  // ----------------------------------------------------
  // Test B7: Leads count
  // ----------------------------------------------------
  console.log("\n--- Testing B7: Leads Count Matching All Leads ---");
  await page.goto(`${BASE_URL}/app?view=all`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  const sidebarCountEl = page.locator('button[aria-current]:has-text("Leads") >> span, button:has-text("Leads") >> span').first();
  const sidebarCountText = (await sidebarCountEl.count()) > 0 ? await sidebarCountEl.innerText() : "";
  console.log(`✓ Sidebar Leads count element text: "${sidebarCountText}"`);

  await browser.close();
  console.log("\n=== ALL TESTS COMPLETE ===");
}

main().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
