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

const outputDir = path.join(process.cwd(), "tests/responsive-proof");
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
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
  .user-avatar, .biz-avatar, .kc-avatar, .kinbox-new-mail-avatar, .avatar, .avatar-round, img {
    visibility: hidden !important;
  }
  nextjs-portal, [data-nextjs-toast], #__next-build-watcher, div[data-nextjs-dialog-overlay] {
    display: none !important;
    visibility: hidden !important;
  }
`;

const WIDTHS = [
  { width: 390, height: 844, name: "390" },
  { width: 768, height: 1024, name: "768" },
  { width: 1440, height: 900, name: "1440" },
  { width: 2560, height: 1440, name: "2560" },
];

const VIEWS = [
  { id: "home", path: "/app?view=home", selector: ".home-grid" },
  { id: "leads", path: "/app?view=leads", selector: ".klead-card, table.leads" },
  { id: "campaigns", path: "/app?view=campaigns", selector: ".kcamp-grid, .kcamp-listcard" },
  { id: "connections", path: "/app?view=settings&tab=connections", selector: ".u-list-group, .u-group" },
];

const THEMES = ["light", "dark", "gradient"];

async function main() {
  console.log("================================================================================");
  console.log("GENERATING RESPONSIVE SHELL PROOF SCREENSHOTS");
  console.log("Widths: 390, 768, 1440, 2560 | Views: Home, Leads, Campaigns, Connections | Themes: 3");
  console.log("================================================================================\n");

  const cookieJar = {};
  const sb = createBrowserClient(SUPABASE_URL, SUPABASE_KEY, {
    cookies: {
      getAll: () => Object.entries(cookieJar).map(([name, value]) => ({ name, value })),
      setAll: (cookiesToSet) => {
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
    console.error("❌ Staging auth failed:", authError?.message || "No session");
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });

  const overflowIssues = [];

  for (const w of WIDTHS) {
    console.log(`\n--- Testing Viewport: ${w.width}x${w.height} (${w.name}px) ---`);
    const context = await browser.newContext({
      viewport: { width: w.width, height: w.height },
      deviceScaleFactor: 1,
    });

    const cookies = Object.entries(cookieJar).map(([name, value]) => ({
      name,
      value,
      domain: "localhost",
      path: "/",
      httpOnly: false,
      secure: false,
      sameSite: "Lax",
    }));
    await context.addCookies(cookies);

    const page = await context.newPage();

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
          super(args.length === 0 ? fixedTime : args[0]);
        }
      }
      MockDate.now = () => fixedTime;
      window.Date = MockDate;
    });

    for (const view of VIEWS) {
      await page.goto(`${BASE_URL}${view.path}`, { waitUntil: "networkidle" });
      if (view.selector) {
        try {
          await page.waitForSelector(view.selector, { state: "visible", timeout: 10000 });
        } catch {}
      }
      await page.addStyleTag({ content: MASK_CSS });

      // Check horizontal scroll
      const overflow = await page.evaluate(() => {
        const docWidth = document.documentElement.clientWidth;
        const scrollWidth = document.documentElement.scrollWidth;
        const bodyScrollWidth = document.body.scrollWidth;
        const isOverflow = scrollWidth > docWidth || bodyScrollWidth > docWidth;
        return {
          docWidth,
          scrollWidth,
          bodyScrollWidth,
          isOverflow,
        };
      });

      if (overflow.isOverflow) {
        const issue = `OVERFLOW at ${w.width}px on ${view.id}: scrollWidth=${overflow.scrollWidth}, docWidth=${overflow.docWidth}`;
        console.error(`❌ ${issue}`);
        overflowIssues.push(issue);
      } else {
        console.log(`✅ [No Horizontal Scroll] ${view.id.padEnd(12)} @ ${w.width}px (scroll: ${overflow.scrollWidth}px / doc: ${overflow.docWidth}px)`);
      }

      for (const theme of THEMES) {
        await page.evaluate((t) => {
          document.documentElement.setAttribute("data-theme", t);
        }, theme);
        await page.waitForTimeout(300);

        const fileName = `${view.id}-${w.name}-${theme}.png`;
        const filePath = path.join(outputDir, fileName);
        await page.screenshot({ path: filePath });
        console.log(`  📸 Saved: ${fileName}`);
      }
    }

    // At 390px: capture the phone drawer open
    if (w.width === 390) {
      console.log("\n--- Capturing Phone Drawer Open (390px) ---");
      await page.goto(`${BASE_URL}/app?view=settings&tab=connections`, { waitUntil: "networkidle" });
      await page.addStyleTag({ content: MASK_CSS });

      // Click the mobile hamburger menu button
      const menuBtn = page.locator(".u-mobile-menu-btn");
      if (await menuBtn.isVisible()) {
        await menuBtn.click();
        await page.waitForTimeout(400);

        for (const theme of THEMES) {
          await page.evaluate((t) => {
            document.documentElement.setAttribute("data-theme", t);
          }, theme);
          await page.waitForTimeout(300);

          const fileName = `phone-drawer-open-390-${theme}.png`;
          const filePath = path.join(outputDir, fileName);
          await page.screenshot({ path: filePath });
          console.log(`  📸 Saved Drawer Open: ${fileName}`);
        }
      } else {
        console.warn("⚠️ Mobile menu button not visible at 390px!");
      }
    }

    await context.close();
  }

  await browser.close();

  console.log("\n================================================================================");
  console.log(`COMPLETED: Screenshots saved in tests/responsive-proof`);
  console.log(`Horizontal Overflow Issues: ${overflowIssues.length}`);
  console.log("================================================================================");

  if (overflowIssues.length > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
