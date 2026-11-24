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

// Target screenshots to capture:
// 1. Sequences, Replies, Find leads, Settings → Email accounts @ 390, 768, 1440, 2560 in 3 themes
// 2. Home, Leads @ 1024, 1920 in 3 themes
const TASKS = [
  { name: "sequences", path: "/app?view=sequences", selector: ".kseq-container, .app-page", widths: [390, 768, 1440, 2560] },
  { name: "replies", path: "/app?view=inbox", selector: ".kinbox-container, .kinbox-list-card", widths: [390, 768, 1440, 2560] },
  { name: "find-leads", path: "/app?view=progress", selector: ".app-page, .kprog-page, .kprog-grid", widths: [390, 768, 1440, 2560] },
  { name: "email-accounts", path: "/app?view=settings&tab=mailboxes", selector: ".acct-table, .u-shell", widths: [390, 768, 1440, 2560] },
  { name: "home", path: "/app?view=home", selector: ".home-grid", widths: [1024, 1920] },
  { name: "leads", path: "/app?view=leads", selector: ".klead-card, table.leads", widths: [1024, 1920] },
];

async function main() {
  console.log("=== CAPTURING MISSING RESPONSIVE PROOF SCREENSHOTS ===");
  if (!STAGING_EMAIL || !STAGING_PASSWORD) {
    console.error("Missing STAGING_TEST_EMAIL or STAGING_TEST_PASSWORD");
    process.exit(1);
  }

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
    console.error("Auth failed:", authError?.message);
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

  // Freeze the clock and accept cookies
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
        if (args.length === 0) {
          super(fixedTime);
        } else {
          super(...args);
        }
      }
    }
    MockDate.now = () => fixedTime;
    window.Date = MockDate;
  });

  for (const task of TASKS) {
    console.log(`\nScreen: ${task.name} (${task.path})`);
    for (const w of task.widths) {
      const vp = VIEWPORTS[w];
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(`${BASE_URL}${task.path}`, { waitUntil: "networkidle" });
      if (task.selector) {
        try {
          await page.waitForSelector(task.selector, { timeout: 10000 });
        } catch {}
      }
      await page.addStyleTag({ content: MASK_CSS });
      await page.waitForTimeout(300);

      for (const theme of THEMES) {
        await page.evaluate((t) => {
          document.documentElement.setAttribute("data-theme", t);
        }, theme);
        await page.waitForTimeout(300);

        const fileName = `${task.name}-${w}-${theme}.png`;
        const filePath = path.join(responsiveDir, fileName);
        const shot = await page.screenshot({ fullPage: false });
        fs.writeFileSync(filePath, shot);
        console.log(`  📸 Saved ${fileName}`);
      }
    }
  }

  await browser.close();
  console.log("\n=== ALL MISSING SCREENSHOTS CAPTURED ===");
}

main().catch((err) => {
  console.error("Capture failed:", err);
  process.exit(1);
});
