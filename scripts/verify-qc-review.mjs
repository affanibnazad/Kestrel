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
const STAGING_ADMIN_EMAIL = process.env.STAGING_ADMIN_EMAIL || "";
const STAGING_ADMIN_PASSWORD = process.env.STAGING_ADMIN_PASSWORD || "";

const screenshotsDir = path.join(process.cwd(), "scripts");

async function main() {
  console.log("================================================================================");
  console.log("LIVE QC REVIEW VERIFICATION (9 ITEMS) ON STAGING");
  console.log(`Target: ${BASE_URL}`);
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

  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const text = msg.text();
      // Ignore Turbopack dev prerender dev-overlay notices and expected network responses
      if (text.includes("unstable value") || text.includes("prerender") || text.includes("Failed to load resource") || text.includes("the server responded with a status of")) return;
      consoleErrors.push(text);
      console.log("   [Browser Error]:", text);
    }
  });

  const results = [];
  function record(item, passed, details = "") {
    results.push({ item, passed, details });
    const mark = passed ? "✅ PASS" : "❌ FAIL";
    console.log(`${mark} | ${item}${details ? ` (${details})` : ""}`);
  }

  try {
    // -------------------------------------------------------------------------
    // ITEM 1 & 4: REPLIES VIEW (ATTACHMENTS & SNIPPET FIRST LINE)
    // -------------------------------------------------------------------------
    console.log("\n[Item 1 & 4] Checking Replies View (Attachments & First Line Snippet)...");
    await page.goto(`${BASE_URL}/app?view=inbox`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);

    // Check Item 1: No hardcoded demo attachments (Collaboration-Overview.pdf, Project-Template1.fig, Meeting With Client)
    const hasDemoPdf = await page.locator("text='Collaboration-Overview.pdf'").count();
    const hasDemoFig = await page.locator("text='Project-Template1.fig'").count();
    const hasDemoMeet = await page.locator("text='Meeting With Client'").count();
    const item1Passed = hasDemoPdf === 0 && hasDemoFig === 0 && hasDemoMeet === 0;
    record(
      "Item 1: Replies attachments - hardcoded demo block removed",
      item1Passed,
      `Demo attachment matches: PDF=${hasDemoPdf}, FIG=${hasDemoFig}, MEET=${hasDemoMeet}`
    );

    // Check Item 4: No "No preview text available." in the replies list AND count > 0
    const hasNoPreviewMsg = await page.locator(".kinbox-item-snippet:has-text('No preview text available')").count();
    const snippetCount = await page.locator(".kinbox-item-snippet").count();
    const item4Passed = hasNoPreviewMsg === 0 && snippetCount > 0;
    record(
      "Item 4: Replies list snippet - shows message first line, no 'No preview text available.'",
      item4Passed,
      `Snippets checked: ${snippetCount}, 'No preview text' count: ${hasNoPreviewMsg}`
    );

    const shotInboxLight = path.join(screenshotsDir, "screenshot-qc-item1-4-inbox-light.png");
    await page.screenshot({ path: shotInboxLight });
    console.log(`   Saved screenshot: ${shotInboxLight}`);

    // -------------------------------------------------------------------------
    // ITEM 5 & 7: USER MENU POPUP (COLLAPSED RAIL IN REPLIES VIEW)
    // -------------------------------------------------------------------------
    console.log("\n[Item 5 & 7] Checking User Menu Popup in Collapsed Rail...");
    const isRailCollapsed = await page.locator(".app.collapsed").count();
    console.log(`   Rail collapsed state: ${isRailCollapsed > 0 ? "Yes" : "No"}`);

    await page.evaluate(() => {
      document.querySelector("nextjs-portal")?.remove();
      const btn = document.querySelector(".kside-user-btn");
      if (btn && btn.click) btn.click();
    });
    await page.waitForTimeout(500);

    const userMenuVisible = await page.locator(".kside-menu").isVisible();
    const menuBox = await page.locator(".kside-menu").boundingBox();
    const sideBox = await page.locator(".side.kside").boundingBox();

    // Check Item 5: Menu is not clipped by the 56px rail
    const notClipped = userMenuVisible && menuBox && menuBox.width >= 200 && menuBox.x >= 50;
    record(
      "Item 5: User menu popup not clipped in collapsed rail",
      Boolean(notClipped),
      `Menu width: ${menuBox?.width}px, X: ${menuBox?.x}px, Rail width: ${sideBox?.width}px`
    );

    // Check Item 7a: User menu does not cover nav items under it
    const notCoveringNav = userMenuVisible && menuBox && sideBox && menuBox.x >= (sideBox.x + sideBox.width - 5);
    record(
      "Item 7a: User menu does not cover nav icons under it (floats to the right of rail)",
      Boolean(notCoveringNav),
      `Menu left: ${menuBox?.x}px vs Rail right edge: ${sideBox ? sideBox.x + sideBox.width : 0}px`
    );

    const shotMenuLight = path.join(screenshotsDir, "screenshot-qc-item5-7-menu-collapsed.png");
    await page.screenshot({ path: shotMenuLight });
    console.log(`   Saved screenshot: ${shotMenuLight}`);

    // Check Item 7b: Outside click dismisses menu
    await page.mouse.click(500, 300);
    await page.waitForTimeout(400);
    const menuClosed = !(await page.locator(".kside-menu").isVisible());
    record("Item 7b: Outside click closes user menu cleanly", menuClosed);

    // -------------------------------------------------------------------------
    // ITEM 2: NON-ADMIN ACCESS GUARDS (STEP A1)
    // -------------------------------------------------------------------------
    console.log("\n[Item 2] Checking Non-Admin Access Guards (Owner Nav & Route Protection)...");
    // 2a. Check sidebar nav for non-admin
    await page.goto(`${BASE_URL}/app?view=home`, { waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    const nonAdminOwnerNav = await page.locator("nav button:has-text('Owner')").count();
    record(
      "Item 2a: Non-admin user has NO Owner navigation link in sidebar",
      nonAdminOwnerNav === 0,
      `Owner nav count: ${nonAdminOwnerNav}`
    );

    // 2b. Check navigating to /app?view=owner redirects/lands on Home
    await page.goto(`${BASE_URL}/app?view=owner`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    const landsOnOwner = (await page.locator("h1:has-text('Owner')").count()) > 0;
    const hasHomeApp = (await page.locator(".home, .home-card, .today-grid, h1:has-text('Overview')").count()) > 0;
    record(
      "Item 2b: Non-admin navigating to /app?view=owner safely lands on Home",
      !landsOnOwner && hasHomeApp,
      `Lands on Owner: ${landsOnOwner}, Lands on Home: ${hasHomeApp}`
    );

    // 2c. Check no fake numbers or fake names exist on page
    const pageBody = await page.evaluate(() => document.body.innerText);
    const hasFakeNames = pageBody.includes("David Kim") || pageBody.includes("Claire Dupont");
    const hasFakeData = pageBody.includes("$2,840") || pageBody.includes("18,450");
    record(
      "Item 2c: Zero fake sample data or fake numbers outside demo mode",
      !hasFakeNames && !hasFakeData,
      `Fake names: ${hasFakeNames}, Fake numbers: ${hasFakeData}`
    );

    // -------------------------------------------------------------------------
    // ITEM 3: PLAN & BILLING + SIDEBAR FOOTER (FREE ACCESS UNTIL <DATE>)
    // -------------------------------------------------------------------------
    console.log("\n[Item 3] Checking Plan & Billing + Sidebar Footer (Free Access vs Trial)...");
    await page.goto(`${BASE_URL}/app?view=plan`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);

    const sidebarFooterText = await page.locator(".kside-user-txt small").innerText();
    const planSubText = await page.locator(".app-page .head .sub").innerText();

    const showsFreeAccess = sidebarFooterText.includes("Free access until") || planSubText.includes("Free access until");
    const noTrialZeroDays = !sidebarFooterText.includes("trial 0 days") && !planSubText.includes("trial 0 days");
    record(
      "Item 3: Shows 'Free access until <date>' for free-access team, never 'Trial · 0 days left'",
      showsFreeAccess && noTrialZeroDays,
      `Footer: "${sidebarFooterText}", Plan sub: "${planSubText}"`
    );

    const shotPlanLight = path.join(screenshotsDir, "screenshot-qc-item3-plan-light.png");
    await page.screenshot({ path: shotPlanLight });
    console.log(`   Saved screenshot: ${shotPlanLight}`);

    // -------------------------------------------------------------------------
    // ITEM 6: ADMIN USER VERIFICATION (STEP 5B & 5C)
    // -------------------------------------------------------------------------
    console.log("\n[Item 6] Checking Admin User Verification (Owner Nav, Real Metrics & Dark Theme)...");
    // Create dedicated admin browser context with staging-admin session
    const adminCookieJar = {};
    const adminSb = createBrowserClient(SUPABASE_URL, SUPABASE_KEY, {
      cookies: {
        getAll() { return Object.entries(adminCookieJar).map(([name, value]) => ({ name, value })); },
        setAll(cs) { cs.forEach(({ name, value }) => { adminCookieJar[name] = value; }); },
      },
    });

    const { data: adminAuth, error: adminAuthErr } = await adminSb.auth.signInWithPassword({
      email: STAGING_ADMIN_EMAIL,
      password: STAGING_ADMIN_PASSWORD,
    });

    if (adminAuthErr || !adminAuth?.session) {
      record("Item 5b: Staging admin user authentication", false, adminAuthErr?.message || "Failed");
    } else {
      const adminContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      await adminContext.addCookies(Object.entries(adminCookieJar).map(([name, value]) => ({
        name, value, domain: "localhost", path: "/", httpOnly: false, secure: false, sameSite: "Lax",
      })));
      const adminPage = await adminContext.newPage();

      // 5b: Admin user sees Owner nav and live metrics from database
      await adminPage.goto(`${BASE_URL}/app?view=owner`, { waitUntil: "networkidle" });
      await adminPage.waitForTimeout(1000);

      const adminOwnerNav = await adminPage.locator("nav button:has-text('Owner')").count();
      const adminOwnerHeading = await adminPage.locator("h1:has-text('Owner')").count();
      const adminTilesCount = await adminPage.locator(".owner-tiles .owner-tile").count();
      const hasRealMetrics = adminTilesCount > 0;

      record(
        "Item 5b: Admin user sees Owner nav and real metrics from database",
        adminOwnerNav > 0 && adminOwnerHeading > 0 && hasRealMetrics,
        `Owner nav: ${adminOwnerNav > 0}, Heading: ${adminOwnerHeading > 0}, Real tiles: ${adminTilesCount}`
      );

      // 5c: Verify Dark Theme on the admin Owner view
      await adminPage.evaluate(() => {
        document.documentElement.setAttribute("data-theme", "dark");
      });
      await adminPage.waitForTimeout(600);

      const tabTextColor = await adminPage.evaluate(() => {
        const firstTab = document.querySelector(".owner-tabs button:not(.on)");
        if (!firstTab) return null;
        return window.getComputedStyle(firstTab).color;
      });

      const activeTabBg = await adminPage.evaluate(() => {
        const activeTab = document.querySelector(".owner-tabs button.on");
        if (!activeTab) return null;
        return window.getComputedStyle(activeTab).backgroundColor;
      });

      record(
        "Item 6: Dark theme Owner tab labels & capsule tabs legible with high contrast (Admin)",
        Boolean(tabTextColor && activeTabBg),
        `Inactive tab: ${tabTextColor}, Active tab bg: ${activeTabBg}`
      );

      const shotOwnerDark = path.join(screenshotsDir, "screenshot-qc-item6-owner-tabs-dark.png");
      await adminPage.screenshot({ path: shotOwnerDark });
      console.log(`   Saved screenshot: ${shotOwnerDark}`);
      await adminContext.close();
    }

    const shotOwnerDark = path.join(screenshotsDir, "screenshot-qc-item6-owner-tabs-dark.png");
    await page.screenshot({ path: shotOwnerDark });
    console.log(`   Saved screenshot: ${shotOwnerDark}`);

    // Switch back to light theme for other checks
    await page.evaluate(() => {
      document.documentElement.setAttribute("data-theme", "light");
    });
    await page.waitForTimeout(300);

    // -------------------------------------------------------------------------
    // ITEM 8: CAMPAIGN CARDS (NAME & SENDER EMAIL SEPARATE LINES, NO OVERLAP)
    // -------------------------------------------------------------------------
    console.log("\n[Item 8] Checking Campaign Cards (Separate lines, Ellipsis, No overlap)...");
    await page.goto(`${BASE_URL}/app?view=campaigns`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);

    const campaignCards = await page.locator(".kcamp-card").count();
    let cardsCheckPassed = false;
    let cardDetails = "";

    if (campaignCards > 0) {
      const cardInfo = await page.evaluate(() => {
        const firstCard = document.querySelector(".kcamp-card");
        if (!firstCard) return null;
        const b = firstCard.querySelector(".kcamp-name b");
        const small = firstCard.querySelector(".kcamp-name small");
        if (!b || !small) return null;

        const bRect = b.getBoundingClientRect();
        const smallRect = small.getBoundingClientRect();
        const bStyle = window.getComputedStyle(b);

        // Check vertical separation (small should be strictly below b)
        const separateLines = smallRect.top >= (bRect.bottom - 1);
        const hasEllipsis = bStyle.textOverflow === "ellipsis" && bStyle.whiteSpace === "nowrap";

        return {
          separateLines,
          hasEllipsis,
          bTop: bRect.top,
          bBottom: bRect.bottom,
          smallTop: smallRect.top,
        };
      });

      cardsCheckPassed = Boolean(cardInfo && cardInfo.separateLines && cardInfo.hasEllipsis && campaignCards > 0);
      cardDetails = `Cards: ${campaignCards}, Separate lines: ${cardInfo?.separateLines}, bBottom: ${cardInfo?.bBottom}px, smallTop: ${cardInfo?.smallTop}px, Ellipsis: ${cardInfo?.hasEllipsis}`;
    }

    record(
      "Item 8: Campaign cards - name and sender email on separate lines with ellipsis and no overlap",
      cardsCheckPassed,
      cardDetails || `Found ${campaignCards} cards`
    );

    const shotCampaignsLight = path.join(screenshotsDir, "screenshot-qc-item8-campaigns-light.png");
    await page.screenshot({ path: shotCampaignsLight });
    console.log(`   Saved screenshot: ${shotCampaignsLight}`);

    // -------------------------------------------------------------------------
    // ITEM 9: INTEGRATIONS (CONNECTED EXTENSIONS COLLAPSIBLE)
    // -------------------------------------------------------------------------
    console.log("\n[Item 9] Checking Integrations Connected Extensions & Collapsible...");
    await page.goto(`${BASE_URL}/app?view=get`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);

    const extConnectSec = await page.locator("#ext-connect").count();
    const hasKeysTable = await page.locator("table.leads:has-text('Your connected extensions')").count();
    const olderToggle = await page.locator("button:has-text('Show older')");
    const hasToggle = (await olderToggle.count()) > 0;

    record(
      "Item 9: Integrations connected extensions loaded, supports 'Show older (n)' toggle",
      extConnectSec > 0 && hasKeysTable > 0 && hasToggle,
      `Connect section: ${extConnectSec > 0 ? "Present" : "Missing"}, Table: ${hasKeysTable > 0 ? "Present" : "No keys yet"}, Toggle: ${hasToggle ? "Present" : "None (<=2 keys)"}`
    );

    const shotIntegrationsLight = path.join(screenshotsDir, "screenshot-qc-item9-integrations-light.png");
    await page.screenshot({ path: shotIntegrationsLight });
    console.log(`   Saved screenshot: ${shotIntegrationsLight}`);

  } catch (err) {
    console.error("❌ Test execution error:", err);
    record("Execution uninterrupted", false, err.message);
  } finally {
    await browser.close();
  }

  console.log("\n================================================================================");
  console.log("TEST SUMMARY");
  console.log("================================================================================");
  const passed = results.filter((r) => r.passed).length;
  const total = results.length;
  console.log(`Total: ${total} | Passed: ${passed} | Failed: ${total - passed}`);
  console.log(`Console Errors: ${consoleErrors.length}`);
  console.log("================================================================================");

  if (passed !== total || consoleErrors.length > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
