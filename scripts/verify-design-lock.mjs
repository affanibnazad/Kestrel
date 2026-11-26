import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
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

const baselinesDir = path.join(process.cwd(), "tests/visual-baselines");
if (!fs.existsSync(baselinesDir)) {
  fs.mkdirSync(baselinesDir, { recursive: true });
}

const diffsDir = path.join(process.cwd(), "tests/visual-diffs");
if (!fs.existsSync(diffsDir)) {
  fs.mkdirSync(diffsDir, { recursive: true });
}

const isUpdate = process.argv.includes("--update-baselines");
const isResponsive = process.argv.includes("--responsive") || process.argv.includes("--all");
const updateScreensArg = process.argv.find((a) => a.startsWith("--update-screens="));
const updateScreens = updateScreensArg ? updateScreensArg.split("=")[1].split(",").map((s) => s.trim()) : isUpdate ? ["all"] : [];

const responsiveDir = path.join(process.cwd(), "tests/responsive-proof");
if (!fs.existsSync(responsiveDir)) {
  fs.mkdirSync(responsiveDir, { recursive: true });
}

/** Decodes a PNG buffer into raw uncompressed RGBA pixel data */
function decodePng(buf) {
  let idx = 8;
  let width = 0, height = 0, colorType = 6;
  const idats = [];
  while (idx < buf.length) {
    const len = buf.readUInt32BE(idx);
    const type = buf.toString("ascii", idx + 4, idx + 8);
    if (type === "IHDR") {
      width = buf.readUInt32BE(idx + 8);
      height = buf.readUInt32BE(idx + 12);
      colorType = buf[idx + 17];
    } else if (type === "IDAT") {
      idats.push(buf.subarray(idx + 8, idx + 8 + len));
    } else if (type === "IEND") {
      break;
    }
    idx += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idats));
  const channels = colorType === 2 ? 3 : 4;
  const stride = width * channels;
  const pixels = Buffer.alloc(width * height * 4);
  let srcPos = 0, dstPos = 0;
  let prevRow = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[srcPos++];
    const rowBuf = Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      let b = raw[srcPos++];
      const left = x >= channels ? rowBuf[x - channels] : 0;
      const up = y > 0 ? prevRow[x] : 0;
      const upLeft = (y > 0 && x >= channels) ? prevRow[x - channels] : 0;
      if (filter === 1) b = (b + left) & 0xff;
      else if (filter === 2) b = (b + up) & 0xff;
      else if (filter === 3) b = (b + Math.floor((left + up) / 2)) & 0xff;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - upLeft);
        const pr = (pa <= pb && pa <= pc) ? left : (pb <= pc) ? up : upLeft;
        b = (b + pr) & 0xff;
      }
      rowBuf[x] = b;
    }
    for (let x = 0; x < width; x++) {
      if (channels === 3) {
        pixels[dstPos++] = rowBuf[x * 3];
        pixels[dstPos++] = rowBuf[x * 3 + 1];
        pixels[dstPos++] = rowBuf[x * 3 + 2];
        pixels[dstPos++] = 255;
      } else {
        pixels[dstPos++] = rowBuf[x * 4];
        pixels[dstPos++] = rowBuf[x * 4 + 1];
        pixels[dstPos++] = rowBuf[x * 4 + 2];
        pixels[dstPos++] = rowBuf[x * 4 + 3];
      }
    }
    prevRow = rowBuf;
  }
  return { width, height, pixels };
}

/** Compares two decoded PNGs and returns pixel difference ratio (0.0 to 1.0) */
function comparePixels(imgA, imgB) {
  if (imgA.width !== imgB.width || imgA.height !== imgB.height) return 1.0;
  let diffCount = 0;
  const totalPixels = imgA.width * imgA.height;
  for (let i = 0; i < imgA.pixels.length; i += 4) {
    const dr = Math.abs(imgA.pixels[i] - imgB.pixels[i]);
    const dg = Math.abs(imgA.pixels[i + 1] - imgB.pixels[i + 1]);
    const db = Math.abs(imgA.pixels[i + 2] - imgB.pixels[i + 2]);
    const da = Math.abs(imgA.pixels[i + 3] - imgB.pixels[i + 3]);
    // Allow slight anti-aliasing color variance
    if (dr > 15 || dg > 15 || db > 15 || da > 15) {
      diffCount++;
    }
  }
  return diffCount / totalPixels;
}

async function main() {
  console.log("================================================================================");
  console.log("DESIGN LOCK BASELINE VERIFICATION (30 SCREENSHOTS: 10 PAGES × LIGHT, DARK & GRADIENT)");
  console.log(`Target: ${BASE_URL} | Mode: ${isUpdate ? "UPDATE BASELINES" : "VERIFY AGAINST BASELINES"}`);
  console.log("================================================================================\n");

  if (!STAGING_EMAIL || !STAGING_PASSWORD) {
    console.error("❌ STAGING_TEST_EMAIL or STAGING_TEST_PASSWORD missing in .env.staging.local");
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
    console.error("❌ Staging authentication failed:", authError?.message || "No session");
    process.exit(1);
  }

  const campaignId = "78fac201-1d39-4411-851f-c0aa8acce1fb";

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });

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
    /* Hide scrollbars to avoid subpixel bar shift */
    ::-webkit-scrollbar {
      display: none !important;
    }
    * {
      scrollbar-width: none !important;
    }
    /* Mask dynamic avatars */
    .user-avatar,
    .biz-avatar,
    .kc-avatar,
    .kinbox-new-mail-avatar,
    .avatar,
    .avatar-round,
    img {
      visibility: hidden !important;
    }
    /* Mask dynamic sidebar account / "Free access until" block and relative reply timestamps */
    .u-user,
    .kinbox-item-time,
    .kinbox-pane-date {
      visibility: hidden !important;
    }
    /* Hide Next.js dev indicator */
    nextjs-portal,
    [data-nextjs-toast],
    #__next-build-watcher,
    div[data-nextjs-dialog-overlay] {
      display: none !important;
      visibility: hidden !important;
    }
  `;

  const SCREENS = [
    { name: "home", path: "/app?view=home", selector: ".home-grid" },
    { name: "campaigns", path: "/app?view=campaigns", selector: ".kcamp-grid" },
    { name: "campaign-detail", path: `/app?view=campaigns&c=${campaignId}`, selector: ".kpd-detail-header, .kpd-campaign-title" },
    { name: "leads", path: "/app?view=leads", selector: ".klead-card" },
    { name: "inbox", path: "/app?view=inbox", selector: ".kinbox-container, .kinbox-list-card" },
    { name: "mailboxes", path: "/app?view=mailboxes", selector: ".acct-table" },
    { name: "ai", path: "/app?view=ai", selector: ".as-page, .as-chat-wrap" },
    { name: "plan", path: "/app?view=plan", selector: ".plan-grid" },
    { name: "about", path: "/app?view=about", selector: ".about-page", fullPage: true },
    { name: "connections", path: "/app?view=settings&tab=connections", selector: ".u-list-group, .u-group" },
  ];

  const THEMES = ["light", "dark", "gradient"];
  let passed = 0;
  let failed = 0;

  for (const screen of SCREENS) {
    const url = `${BASE_URL}${screen.path}`;
    await page.goto(url, { waitUntil: "networkidle" });
    if (screen.selector) {
      try {
        await page.waitForSelector(screen.selector, { state: "visible", timeout: 15000 });
      } catch (e) {
        console.warn(`Selector timeout for ${screen.name}: ${screen.selector}`);
      }
    }
    await page.addStyleTag({ content: MASK_CSS });

    for (const theme of THEMES) {
      const baselineName = `${screen.name}-${theme}.png`;
      const baselinePath = path.join(baselinesDir, baselineName);

      await page.evaluate((t) => {
        document.documentElement.setAttribute("data-theme", t);
      }, theme);
      await page.waitForTimeout(500);

      const shot = await page.screenshot({ fullPage: screen.fullPage ?? false });

      const shouldUpdate = updateScreens.includes("all") || updateScreens.includes(screen.name);
      if (shouldUpdate) {
        fs.writeFileSync(baselinePath, shot);
        console.log(`📸 [Baseline Saved] ${baselineName}`);
        passed++;
      } else if (!fs.existsSync(baselinePath)) {
        console.log(`⚠️ PENDING BASELINE | ${screen.name.padEnd(16)} [${theme.padEnd(5)}] (run --update-screens=${screen.name} after review)`);
      } else {
        const baselineBuf = fs.readFileSync(baselinePath);
        const imgCurrent = decodePng(shot);
        const imgBaseline = decodePng(baselineBuf);
        const diffRatio = comparePixels(imgCurrent, imgBaseline);

        // Strict design lock threshold: < 0.2% diff allowed for anti-aliasing
        const threshold = 0.002;
        const diffPct = (diffRatio * 100).toFixed(3) + "%";

        if (diffRatio <= threshold) {
          console.log(`✅ PASS | ${screen.name.padEnd(16)} [${theme.padEnd(5)}] diff: ${diffPct} (under 0.2%)`);
          passed++;
        } else {
          console.error(`❌ FAIL | ${screen.name.padEnd(16)} [${theme.padEnd(5)}] diff: ${diffPct} EXCEEDS threshold 0.2%`);
          const diffPath = path.join(diffsDir, `diff-${screen.name}-${theme}.png`);
          fs.writeFileSync(diffPath, shot);
          console.error(`   Current screenshot saved to: ${diffPath}`);
          failed++;
        }
      }
    }
  }

  if (isResponsive) {
    console.log("\n================================================================================");
    console.log("RESPONSIVE SHELL VERIFICATION (390, 768, 1440, 2560 × 4 VIEWS × 3 THEMES)");
    console.log("================================================================================\n");

    const RESPONSIVE_WIDTHS = [
      { name: "390", width: 390, height: 844 },
      { name: "768", width: 768, height: 1024 },
      { name: "1440", width: 1440, height: 900 },
      { name: "2560", width: 2560, height: 1440 },
    ];

    const RESPONSIVE_SCREENS = [
      { name: "home", path: "/app?view=home", selector: ".home-grid" },
      { name: "leads", path: "/app?view=leads", selector: ".klead-card, table.leads" },
      { name: "campaigns", path: "/app?view=campaigns", selector: ".kcamp-grid, .kcamp-card" },
      { name: "connections", path: "/app?view=settings&tab=connections", selector: ".u-list-group, .u-group" },
    ];

    let overflowErrors = 0;

    for (const vp of RESPONSIVE_WIDTHS) {
      console.log(`\n--- Testing Viewport: ${vp.width}x${vp.height} (${vp.name}px) ---`);
      await page.setViewportSize({ width: vp.width, height: vp.height });

      for (const screen of RESPONSIVE_SCREENS) {
        const url = `${BASE_URL}${screen.path}`;
        await page.goto(url, { waitUntil: "networkidle" });
        if (screen.selector) {
          try {
            await page.waitForSelector(screen.selector, { state: "visible", timeout: 10000 });
          } catch {}
        }
        await page.addStyleTag({ content: MASK_CSS });

        // Check horizontal overflow
        const overflow = await page.evaluate(() => {
          return {
            scrollWidth: document.documentElement.scrollWidth,
            clientWidth: window.innerWidth,
            hasOverflow: document.documentElement.scrollWidth > window.innerWidth,
          };
        });

        if (overflow.hasOverflow) {
          console.error(`❌ [Horizontal Overflow] ${screen.name.padEnd(12)} @ ${vp.name}px (scroll: ${overflow.scrollWidth}px / client: ${overflow.clientWidth}px)`);
          overflowErrors++;
        } else {
          console.log(`✅ [No Horizontal Scroll] ${screen.name.padEnd(12)} @ ${vp.name}px (scroll: ${overflow.scrollWidth}px / client: ${overflow.clientWidth}px)`);
        }

        // Capture in all 3 themes
        for (const theme of THEMES) {
          await page.evaluate((t) => {
            document.documentElement.setAttribute("data-theme", t);
          }, theme);
          await page.waitForTimeout(400);

          const shotPath = path.join(responsiveDir, `${screen.name}-${vp.name}-${theme}.png`);
          const shot = await page.screenshot({ fullPage: false });
          fs.writeFileSync(shotPath, shot);
          console.log(`  📸 Saved: ${screen.name}-${vp.name}-${theme}.png`);
        }
      }

      // Drawer test for 390px
      if (vp.width === 390) {
        console.log("\n--- Capturing Phone Drawer Open (390px) ---");
        await page.goto(`${BASE_URL}/app?view=home`, { waitUntil: "networkidle" });
        await page.addStyleTag({ content: MASK_CSS });

        const menuBtn = await page.$(".u-menu-btn, button[aria-label='Open menu']");
        if (menuBtn) {
          await menuBtn.click();
          await page.waitForTimeout(500);

          for (const theme of THEMES) {
            await page.evaluate((t) => {
              document.documentElement.setAttribute("data-theme", t);
            }, theme);
            await page.waitForTimeout(300);

            const shotPath = path.join(responsiveDir, `phone-drawer-open-390-${theme}.png`);
            const shot = await page.screenshot({ fullPage: false });
            fs.writeFileSync(shotPath, shot);
            console.log(`  📸 Saved Drawer Open: phone-drawer-open-390-${theme}.png`);
          }

          // Verify closing drawer
          const closeBtn = await page.$(".u-side-close, button[aria-label='Close menu']");
          if (closeBtn) {
            await closeBtn.click();
            await page.waitForTimeout(400);
          }
        }
      }

      // Tooltip test for 768px
      if (vp.width === 768) {
        console.log("\n--- Capturing Tablet Tooltip Hover (768px) ---");
        await page.goto(`${BASE_URL}/app?view=campaigns`, { waitUntil: "networkidle" });
        await page.addStyleTag({ content: MASK_CSS });
        await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));

        const navItem = await page.$(".u-side a[data-tooltip], .u-side .u-side-link");
        if (navItem) {
          await navItem.hover();
          await page.waitForTimeout(400);
          const shotPath = path.join(responsiveDir, "tablet-tooltip-hover-768.png");
          const shot = await page.screenshot({ fullPage: false });
          fs.writeFileSync(shotPath, shot);
          console.log("  📸 Saved Tablet Tooltip: tablet-tooltip-hover-768.png");
        }
      }
    }

    if (overflowErrors > 0) {
      console.error(`\n❌ Responsive test failed with ${overflowErrors} horizontal overflow error(s)!`);
      failed += overflowErrors;
    } else {
      console.log("\n✅ Responsive Shell: All viewports passed with 0 horizontal scroll!");
    }
  }

  await browser.close();

  console.log("\n================================================================================");
  console.log(`DESIGN LOCK SUMMARY: Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
  console.log("================================================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
