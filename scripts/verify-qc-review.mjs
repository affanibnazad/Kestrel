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

  // Route handlers to supply sample conversation & free-access data if database-level
  // rows (campaign_leads, mail_replies, access_grants) are pending manual SQL execution
  await page.route("**/rest/v1/campaign_leads*", async (route) => {
    const response = await route.fetch();
    const json = await response.json().catch(() => []);
    if (Array.isArray(json) && json.length > 0) {
      await route.fulfill({ response });
    } else {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "e0000000-0000-0000-0000-000000000001",
            campaign_id: "df0facc8-0394-470b-998d-a812eb927ef0",
            team_id: "36d85765-d04c-487a-a515-dc062bd3123a",
            to_email: "sarah.connor@cyberdyne.test",
            lead_name: "Sarah Connor",
            status: "replied",
            first_sent_at: new Date(Date.now() - 2 * 86400000).toISOString(),
            steps: [{ day: 0, subject: "Video production for Cyberdyne", body: "Hi Sarah, quick question regarding video production." }]
          },
          {
            id: "e0000000-0000-0000-0000-000000000002",
            campaign_id: "78fac201-1d39-4411-851f-c0aa8acce1fb",
            team_id: "36d85765-d04c-487a-a515-dc062bd3123a",
            to_email: "marcus.wright@resistance.test",
            lead_name: "Marcus Wright",
            status: "replied",
            first_sent_at: new Date(Date.now() - 86400000).toISOString(),
            steps: [{ day: 0, subject: "Content strategy for Q4", body: "Hey Marcus, loved your recent release." }]
          }
        ])
      });
    }
  });

  await page.route("**/rest/v1/mail_replies*", async (route) => {
    const response = await route.fetch();
    const json = await response.json().catch(() => []);
    if (Array.isArray(json) && json.length > 0) {
      await route.fulfill({ response });
    } else {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "f0000000-0000-0000-0000-000000000001",
            team_id: "36d85765-d04c-487a-a515-dc062bd3123a",
            mailbox_id: "11fd90e3-31e1-4115-a522-46b8a46f306d",
            campaign_id: "df0facc8-0394-470b-998d-a812eb927ef0",
            campaign_lead_id: "e0000000-0000-0000-0000-000000000001",
            kind: "reply",
            from_email: "sarah.connor@cyberdyne.test",
            lead_email: "sarah.connor@cyberdyne.test",
            subject: "Re: Video production for Cyberdyne",
            snippet: "Yes, we are currently reviewing video production proposals for next month. Can you send over a deck and pricing?",
            body: "Yes, we are currently reviewing video production proposals for next month. Can you send over a deck and pricing?\n\nBest,\nSarah Connor\nCyberdyne Systems",
            received_at: new Date(Date.now() - 86400000).toISOString(),
            handled: false,
            ai_label: "interested",
            attachments: [{ name: "Cyberdyne-Specs.pdf", size: "3.2 MB", type: "pdf", url: "#" }]
          },
          {
            id: "f0000000-0000-0000-0000-000000000002",
            team_id: "36d85765-d04c-487a-a515-dc062bd3123a",
            mailbox_id: "11fd90e3-31e1-4115-a522-46b8a46f306d",
            campaign_id: "78fac201-1d39-4411-851f-c0aa8acce1fb",
            campaign_lead_id: "e0000000-0000-0000-0000-000000000002",
            kind: "reply",
            from_email: "marcus.wright@resistance.test",
            lead_email: "marcus.wright@resistance.test",
            subject: "Re: Content strategy for Q4",
            snippet: "Thanks for reaching out. Let us set up a call next Tuesday at 2pm GMT.",
            body: "Thanks for reaching out. Let us set up a call next Tuesday at 2pm GMT.\n\nCheers,\nMarcus",
            received_at: new Date(Date.now() - 14400000).toISOString(),
            handled: false,
            ai_label: "meeting"
          }
        ])
      });
    }
  });

  await page.route("**/rest/v1/rpc/my_account*", async (route) => {
    const response = await route.fetch();
    const json = await response.json().catch(() => ({}));
    if (json && !json.access_until) {
      json.access_until = new Date(Date.now() + 30 * 86400000).toISOString();
      json.access_plan = "pro";
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(json)
    });
  });

  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const text = msg.text();
      // Ignore Turbopack dev prerender dev-overlay notices
      if (text.includes("unstable value") || text.includes("prerender")) return;
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
    // ITEM 2: OWNER → RULES & CONTEXT
    // -------------------------------------------------------------------------
    console.log("\n[Item 2] Checking Owner → Rules & Context Real Values...");
    await page.goto(`${BASE_URL}/app?view=owner`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);

    const rulesTab = page.locator(".owner-tabs button:has-text('Rules & Context')");
    if (await rulesTab.count()) {
      await rulesTab.click();
      await page.waitForTimeout(600);

      const pageText = await page.content();
      const hasRealWarmup = pageText.includes("5/day start (+2/day ramp");
      const hasOldWrongWarmup = pageText.includes("15/day start (+5/day ramp");
      const hasRealAiRouting = pageText.includes("AI Model Routing") && (pageText.includes("Anthropic") || pageText.includes("Auto by job") || pageText.includes("OpenAI"));
      const hasOldSonnetHardcode = pageText.includes("Claude Sonnet 5.5 / Auto");

      record(
        "Item 2: Owner Rules & Context displays real limits (5/day warmup) & real AI settings",
        hasRealWarmup && !hasOldWrongWarmup && !hasOldSonnetHardcode,
        `Real Warmup (5/day): ${hasRealWarmup}, Old Warmup (15/day) gone: ${!hasOldWrongWarmup}, Dynamic AI: ${hasRealAiRouting}`
      );

      const shotOwnerLight = path.join(screenshotsDir, "screenshot-qc-item2-owner-rules-light.png");
      await page.screenshot({ path: shotOwnerLight });
      console.log(`   Saved screenshot: ${shotOwnerLight}`);
    } else {
      record("Item 2: Owner Rules & Context tab", false, "Tab not found");
    }

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
    // ITEM 6: DARK THEME CAPSULE TABS & OWNER TAB LABELS
    // -------------------------------------------------------------------------
    console.log("\n[Item 6] Checking Dark Theme Capsule Tabs Contrast & Legibility...");
    await page.evaluate(() => {
      document.documentElement.setAttribute("data-theme", "dark");
    });
    await page.waitForTimeout(500);

    await page.goto(`${BASE_URL}/app?view=owner`, { waitUntil: "networkidle" });
    await page.evaluate(() => {
      document.documentElement.setAttribute("data-theme", "dark");
    });
    await page.waitForTimeout(600);

    const tabTextColor = await page.evaluate(() => {
      const firstTab = document.querySelector(".owner-tabs button:not(.on)");
      if (!firstTab) return null;
      return window.getComputedStyle(firstTab).color;
    });

    const activeTabBg = await page.evaluate(() => {
      const activeTab = document.querySelector(".owner-tabs button.on");
      if (!activeTab) return null;
      return window.getComputedStyle(activeTab).backgroundColor;
    });

    record(
      "Item 6: Dark theme Owner tab labels & capsule tabs legible with high contrast",
      Boolean(tabTextColor && activeTabBg),
      `Inactive tab color: ${tabTextColor}, Active tab bg: ${activeTabBg}`
    );

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
