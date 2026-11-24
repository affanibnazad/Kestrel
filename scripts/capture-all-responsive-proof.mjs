import fs from "fs";
import path from "path";
import { chromium } from "playwright";
import { config } from "dotenv";
import { createBrowserClient } from "@supabase/ssr";

config({ path: ".env.staging.local" });

const BASE_URL = process.env.BASE_URL || "http://localhost:3333";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";
const STAGING_EMAIL = process.env.STAGING_TEST_EMAIL || "";
const STAGING_PASSWORD = process.env.STAGING_TEST_PASSWORD || "";

const responsiveDir = path.join(process.cwd(), "tests/responsive-proof");
if (!fs.existsSync(responsiveDir)) {
  fs.mkdirSync(responsiveDir, { recursive: true });
}

const MASK_CSS = `
  html, body, *, *::before, *::after {
    animation: none !important;
    animation-duration: 0s !important;
    animation-delay: 0s !important;
    transition: none !important;
    transition-duration: 0s !important;
    transition-delay: 0s !important;
    caret-color: transparent !important;
  }
  ::-webkit-scrollbar {
    display: none !important;
  }
  * {
    scrollbar-width: none !important;
  }
  .user-avatar,
  .biz-avatar,
  .kc-avatar,
  .kinbox-new-mail-avatar,
  .avatar,
  .avatar-round,
  img {
    visibility: hidden !important;
  }
  nextjs-portal,
  [data-nextjs-toast],
  #__next-build-watcher,
  div[data-nextjs-dialog-overlay] {
    display: none !important;
    visibility: hidden !important;
  }
`;

const THEMES = ["light", "dark", "gradient"];

const VIEWPORTS = {
  390: { width: 390, height: 844 },
  768: { width: 768, height: 1024 },
  1024: { width: 1024, height: 768 },
  1440: { width: 1440, height: 900 },
  1920: { width: 1920, height: 1080 },
  2560: { width: 2560, height: 1440 },
};

const SCREENS = [
  { name: "home", path: "/app?view=home", selector: ".home-grid", widths: [390, 768, 1024, 1440, 1920, 2560] },
  { name: "leads", path: "/app?view=leads", selector: ".klead-card, table.leads", widths: [390, 768, 1024, 1440, 1920, 2560] },
  { name: "campaigns", path: "/app?view=campaigns", selector: ".kcamp-grid, .kcamp-card", widths: [390, 768, 1440, 2560] },
  { name: "connections", path: "/app?view=settings&tab=connections", selector: ".u-list-group, .u-group, .u-shell", widths: [390, 768, 1440, 2560] },
  { name: "sequences", path: "/app?view=sequences", selector: ".app-page", widths: [390, 768, 1440, 2560] },
  { name: "replies", path: "/app?view=inbox", selector: ".kinbox-container, .kinbox-list-card", widths: [390, 768, 1440, 2560] },
  { name: "find-leads", path: "/app?view=progress", selector: ".app-page, .kprog-page, .kprog-grid", widths: [390, 768, 1440, 2560] },
  { name: "email-accounts", path: "/app?view=settings&tab=mailboxes", selector: ".acct-table, .u-shell", widths: [390, 768, 1440, 2560] },
];

async function main() {
  console.log("================================================================================");
  console.log("FULL RESPONSIVE PROOF SCREENSHOT CAPTURE");
  console.log("================================================================================\n");

  if (!STAGING_EMAIL || !STAGING_PASSWORD) {
    console.error("❌ Missing STAGING_TEST_EMAIL or STAGING_TEST_PASSWORD");
    process.exit(1);
  }

  const cookieJar = {};
  const sb = createBrowserClient(SUPABASE_URL, SUPABASE_KEY, {
    cookies: {
      getAll: () => Object.entries(cookieJar).map(([name, value]) => ({ name, value })),
      setAll: (c) => c.forEach(({ name, value }) => { cookieJar[name] = value; }),
    },
  });

  const { data: authData, error: authError } = await sb.auth.signInWithPassword({
    email: STAGING_EMAIL,
    password: STAGING_PASSWORD,
  });

  if (authError || !authData.session) {
    console.error("❌ Staging auth failed:", authError?.message);
    process.exit(1);
  }
  console.log("✓ Signed in as:", STAGING_EMAIL);

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

  // Freeze time and accept cookies
  await page.addInitScript(() => {
    try {
      localStorage.setItem("kestrel-consent", JSON.stringify({ v: 1, analytics: false, marketing: false, at: "2026-11-23T12:00:00Z" }));
      localStorage.setItem("kestrel_cookie_consent", JSON.stringify({ v: 1, analytics: false, marketing: false, at: "2026-11-23T12:00:00Z" }));
    } catch {}
    const fixedTime = new Date("2026-11-23T12:00:00Z").getTime();
    Date.now = () => fixedTime;
    const OriginalDate = window.Date;
    class MockDate extends OriginalDate {
      constructor(...args) {
        if (args.length === 0) super(fixedTime);
        else super(...args);
      }
    }
    MockDate.now = () => fixedTime;
    window.Date = MockDate;
  });

  let totalCaptured = 0;
  let totalOverflows = 0;

  for (const screen of SCREENS) {
    console.log(`\n--- Capturing Screen: ${screen.name} ---`);
    for (const w of screen.widths) {
      const vp = VIEWPORTS[w];
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(`${BASE_URL}${screen.path}`, { waitUntil: "networkidle" });
      if (screen.selector) {
        try {
          await page.waitForSelector(screen.selector, { timeout: 10000 });
        } catch {}
      }
      await page.addStyleTag({ content: MASK_CSS });
      await page.waitForTimeout(300);

      // Verify no horizontal overflow
      const overflow = await page.evaluate(() => {
        return {
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: window.innerWidth,
          hasOverflow: document.documentElement.scrollWidth > window.innerWidth,
        };
      });

      if (overflow.hasOverflow) {
        console.error(`  ⚠️ Overflow on ${screen.name} @ ${w}px (scroll: ${overflow.scrollWidth}px / client: ${overflow.clientWidth}px)`);
        totalOverflows++;
      }

      for (const theme of THEMES) {
        await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
        await page.waitForTimeout(250);

        const fileName = `${screen.name}-${w}-${theme}.png`;
        const filePath = path.join(responsiveDir, fileName);
        const shot = await page.screenshot({ fullPage: false });
        fs.writeFileSync(filePath, shot);
        totalCaptured++;
      }
      console.log(`  ✓ ${screen.name} @ ${w}px captured in 3 themes`);
    }
  }

  // Phone Drawer Open (390px) in 3 themes
  console.log("\n--- Capturing Phone Drawer Open (390px) ---");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE_URL}/app?view=home`, { waitUntil: "networkidle" });
  await page.addStyleTag({ content: MASK_CSS });
  await page.waitForTimeout(300);

  const menuBtn = await page.$(".u-menu-btn");
  if (menuBtn) {
    await menuBtn.click();
    await page.waitForTimeout(400);

    for (const theme of THEMES) {
      await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
      await page.waitForTimeout(250);

      const fileName = `phone-drawer-open-390-${theme}.png`;
      const filePath = path.join(responsiveDir, fileName);
      const shot = await page.screenshot({ fullPage: false });
      fs.writeFileSync(filePath, shot);
      totalCaptured++;
      console.log(`  ✓ Drawer open captured in ${theme}`);
    }

    const closeBtn = await page.$(".u-side-close");
    if (closeBtn) {
      await closeBtn.click();
      await page.waitForTimeout(300);
    }
  }

  // Tablet Tooltip Hover (768px)
  console.log("\n--- Capturing Tablet Tooltip Hover (768px) ---");
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto(`${BASE_URL}/app?view=campaigns`, { waitUntil: "networkidle" });
  await page.addStyleTag({ content: MASK_CSS });
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
  await page.waitForTimeout(300);

  const navItem = await page.$(".u-side-link[data-tooltip]");
  if (navItem) {
    await navItem.hover();
    await page.waitForTimeout(400);
    const fileName = `tablet-tooltip-hover-768.png`;
    const filePath = path.join(responsiveDir, fileName);
    const shot = await page.screenshot({ fullPage: false });
    fs.writeFileSync(filePath, shot);
    totalCaptured++;
    console.log(`  ✓ Tablet tooltip hover captured`);
  }

  await browser.close();
  console.log(`\n================================================================================`);
  console.log(`COMPLETE: Captured ${totalCaptured} proof screenshots. Total overflows: ${totalOverflows}`);
  console.log(`================================================================================\n`);
}

main().catch((err) => {
  console.error("Capture failed:", err);
  process.exit(1);
});
