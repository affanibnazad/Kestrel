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

async function main() {
  console.log("================================================================================");
  console.log("HOTFIX U1D COMPREHENSIVE CLICK & RESPONSIVE VERIFICATION SUITE");
  console.log("Target:", BASE_URL, "| User:", STAGING_EMAIL);
  console.log("================================================================================\n");

  const cookieJar = {};
  const sb = createBrowserClient(SUPABASE_URL, SUPABASE_KEY, {
    cookies: {
      getAll() { return Object.entries(cookieJar).map(([name, value]) => ({ name, value })); },
      setAll(c) { c.forEach(({ name, value }) => { cookieJar[name] = value; }); },
    },
  });

  const { data: authData, error: authError } = await sb.auth.signInWithPassword({
    email: STAGING_EMAIL,
    password: STAGING_PASSWORD,
  });

  if (authError || !authData.session) {
    console.error("❌ Staging auth failed:", authError?.message || "No session");
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 2560, height: 1440 } });
  await context.addCookies(Object.entries(cookieJar).map(([name, value]) => ({
    name, value, domain: "localhost", path: "/", httpOnly: false, secure: false, sameSite: "Lax"
  })));

  const page = await context.newPage();

  // Set consent cookies
  await page.addInitScript(() => {
    try {
      localStorage.setItem("kestrel-consent", JSON.stringify({ v: 1, analytics: false, marketing: false, at: "2026-11-23T12:00:00Z" }));
      localStorage.setItem("kestrel_cookie_consent", JSON.stringify({ v: 1, analytics: false, marketing: false, at: "2026-11-23T12:00:00Z" }));
    } catch {}
  });

  // Step 1: Open Leads view at 2560px
  console.log("--> Navigating to /app?view=new (Leads, 224 real leads) at 2560x1440...");
  await page.goto(`${BASE_URL}/app?view=new`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);

  // Diagnostic: check elementFromPoint at sidebar and table
  const elementCheck = await page.evaluate(() => {
    function describe(el) {
      if (!el) return "null";
      const tag = el.tagName.toLowerCase();
      const cls = el.className && typeof el.className === "string" ? `.${el.className.trim().split(/\s+/).join(".")}` : "";
      return `<${tag} class="${cls}"> text="${(el.textContent || "").slice(0, 40).trim()}"`;
    }
    return {
      sidebarTop: describe(document.elementFromPoint(80, 100)),
      sidebarMid: describe(document.elementFromPoint(80, 220)),
      sidebarSettings: describe(document.elementFromPoint(80, 1320)),
      sidebarUser: describe(document.elementFromPoint(80, 1370)),
      tableHeader: describe(document.elementFromPoint(500, 150)),
      tableRow1: describe(document.elementFromPoint(500, 250)),
      fitColumn: describe(document.elementFromPoint(2230, 340)),
      point1280_125: describe(document.elementFromPoint(1280, 125)),
    };
  });

  console.log("\n[DIAGNOSTIC] elementFromPoint check at key coordinates:");
  for (const [k, v] of Object.entries(elementCheck)) {
    console.log(`  ${k.padEnd(18)}: ${v}`);
  }

  // Verify that no fixed overlay covers the page
  const hasOverlay = await page.evaluate(() => {
    const el = document.elementFromPoint(80, 100);
    const style = el ? window.getComputedStyle(el) : null;
    return style && style.position === "fixed" && style.zIndex === "80";
  });

  if (hasOverlay) {
    console.error("❌ FAILED: A fixed z-index 80 overlay is still intercepting clicks!");
    process.exit(1);
  }
  console.log("✅ PASSED: No blocking fixed overlay on the page.\n");

  // Step 2: Click every sidebar item and check view changes
  console.log("--> Testing clicks on every sidebar navigation item...");

  const NAV_TESTS = [
    { label: "Home", text: "Home", expectedUrlPart: "view=home" },
    { label: "Leads", text: "Leads", expectedUrlPart: "view=all" },
    { label: "Campaigns", text: "Campaigns", expectedUrlPart: "view=campaigns" },
    { label: "Sequences", text: "Sequences", expectedUrlPart: "view=sequences" },
    { label: "Replies", text: "Replies", expectedUrlPart: "view=inbox" },
    { label: "Find leads", text: "Find leads", expectedUrlPart: "view=progress" },
    { label: "Kestrel AI", text: "Kestrel AI", expectedUrlPart: "view=ai" },
    { label: "Tasks", text: "Tasks", expectedUrlPart: "view=tasks" },
    { label: "Analytics", text: "Analytics", expectedUrlPart: "view=analytics" },
    { label: "Settings", text: "Settings", expectedUrlPart: "view=settings" },
  ];

  for (const item of NAV_TESTS) {
    const linkSelector = `.u-side a:has-text("${item.text}"), .u-side .u-side-link:has-text("${item.text}")`;
    const exists = await page.locator(linkSelector).first().isVisible();
    if (!exists) {
      console.error(`❌ FAILED: Sidebar link "${item.label}" is not visible or not found!`);
      process.exit(1);
    }

    const prevUrl = page.url();
    await page.locator(linkSelector).first().click();
    await page.waitForTimeout(500);
    const newUrl = page.url();

    const ok = newUrl.includes(item.expectedUrlPart);
    if (!ok) {
      console.error(`❌ FAILED: Click on sidebar "${item.label}" did not change view! URL: ${newUrl}`);
      process.exit(1);
    }
    console.log(`  ✅ Clicked "${item.label}" -> URL updated to ${newUrl.split("/app")[1]}`);
  }

  // Step 3: Test clicking a lead row to open LeadPanel
  console.log("\n--> Navigating back to Leads (/app?view=new) to test lead row click...");
  await page.goto(`${BASE_URL}/app?view=new`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);

  const firstLead = page.locator(".klead-card").first();
  const leadVisible = await firstLead.isVisible();
  if (!leadVisible) {
    console.error("❌ FAILED: No .klead-card found on Leads view!");
    process.exit(1);
  }

  const leadName = (await firstLead.locator(".klead-biz-title").textContent())?.trim();
  console.log(`  Clicking first lead row: "${leadName}"...`);
  await firstLead.click();
  await page.waitForTimeout(600);

  // Check if side panel opened
  const panelVisible = await page.locator(".drawer-wrap, aside.drawer").first().isVisible();
  if (!panelVisible) {
    console.error("❌ FAILED: Clicking lead row did not open LeadPanel!");
    process.exit(1);
  }
  console.log(`  ✅ LeadPanel (.drawer-wrap) opened successfully for "${leadName}"!`);

  // Close panel
  const closeBtn = page.locator("button.dr-x").first();
  if (await closeBtn.isVisible()) {
    await closeBtn.click();
    await page.waitForTimeout(400);
  }

  // Step 4: Open Settings -> Connections
  console.log("\n--> Testing direct navigation and tab opening: Settings -> Connections...");
  await page.goto(`${BASE_URL}/app?view=settings&tab=connections`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);

  const connActive = await page.evaluate(() => {
    const url = window.location.href;
    const tabMatches = url.includes("tab=connections");
    const hasContent = document.querySelector(".u-content, .connections-page, .u-group, .u-list-group") !== null;
    return tabMatches && hasContent;
  });

  if (!connActive) {
    console.error("❌ FAILED: Settings -> Connections did not load properly!");
    process.exit(1);
  }
  console.log("  ✅ Settings -> Connections loaded and verified!");

  // Step 5: Capture Screenshots at 1440 and 2560 for Leads (200+ leads) and Settings in all 3 themes
  console.log("\n--> Capturing verification screenshots at 1440 and 2560 for Leads and Settings (3 themes)...");

  const proofDir = path.join(process.cwd(), "docs/u1d-proof");
  const respDir = path.join(process.cwd(), "tests/responsive-proof");
  fs.mkdirSync(proofDir, { recursive: true });
  fs.mkdirSync(respDir, { recursive: true });

  const VIEWPORTS = [
    { width: 1440, height: 900 },
    { width: 2560, height: 1440 }
  ];
  const THEMES = ["light", "dark", "gradient"];

  for (const vp of VIEWPORTS) {
    await page.setViewportSize(vp);
    console.log(`\n  Viewport: ${vp.width}x${vp.height}`);

    for (const theme of THEMES) {
      // 1. Leads view
      await page.goto(`${BASE_URL}/app?view=new`, { waitUntil: "networkidle" });
      await page.evaluate((t) => {
        document.documentElement.setAttribute("data-theme", t);
        try { localStorage.setItem("kestrel-look", JSON.stringify({ theme: t, accent: "classic", reduce: false })); } catch {}
      }, theme);
      await page.waitForTimeout(800);

      const leadsProofPath = path.join(proofDir, `leads-${vp.width}-${theme}.png`);
      const leadsRespPath = path.join(respDir, `leads-${vp.width}-${theme}.png`);
      await page.screenshot({ path: leadsProofPath, fullPage: false });
      fs.copyFileSync(leadsProofPath, leadsRespPath);
      console.log(`    📸 Saved: leads-${vp.width}-${theme}.png`);

      // 2. Settings -> Connections view
      await page.goto(`${BASE_URL}/app?view=settings&tab=connections`, { waitUntil: "networkidle" });
      await page.evaluate((t) => {
        document.documentElement.setAttribute("data-theme", t);
        try { localStorage.setItem("kestrel-look", JSON.stringify({ theme: t, accent: "classic", reduce: false })); } catch {}
      }, theme);
      await page.waitForTimeout(800);

      const settingsProofPath = path.join(proofDir, `settings-${vp.width}-${theme}.png`);
      const settingsRespPath = path.join(respDir, `settings-${vp.width}-${theme}.png`);
      await page.screenshot({ path: settingsProofPath, fullPage: false });
      fs.copyFileSync(settingsProofPath, settingsRespPath);
      console.log(`    📸 Saved: settings-${vp.width}-${theme}.png`);
    }
  }

  await browser.close();
  console.log("\n================================================================================");
  console.log("✅ ALL TESTS PASSED: 10/10 NAV CLICKS, LEAD ROW CLICK, SETTINGS & 12 SCREENSHOTS");
  console.log("================================================================================");
}

main().catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
