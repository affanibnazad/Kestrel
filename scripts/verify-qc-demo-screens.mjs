import path from "node:path";
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3333";
const screenshotsDir = path.join(process.cwd(), "scripts");

async function main() {
  console.log("📸 Capturing comprehensive demo screenshots in light & dark themes...");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  // 1. Replies in demo mode (Light)
  console.log("1. Replies view (Demo mode - Light)...");
  await page.goto(`${BASE_URL}/app?demo=true&view=inbox`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(screenshotsDir, "screenshot-qc-inbox-demo-light.png") });

  // 2. Replies in demo mode (Dark)
  console.log("2. Replies view (Demo mode - Dark)...");
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(screenshotsDir, "screenshot-qc-inbox-demo-dark.png") });

  // 3. Campaigns in demo mode (Light)
  console.log("3. Campaigns view (Demo mode - Light)...");
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
  await page.goto(`${BASE_URL}/app?demo=true&view=campaigns`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(screenshotsDir, "screenshot-qc-campaigns-demo-light.png") });

  // 4. Campaigns in demo mode (Dark)
  console.log("4. Campaigns view (Demo mode - Dark)...");
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(screenshotsDir, "screenshot-qc-campaigns-demo-dark.png") });

  // 5. Owner Overview (Dark)
  console.log("5. Owner Overview (Demo mode - Dark)...");
  await page.goto(`${BASE_URL}/app?demo=true&view=owner`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(screenshotsDir, "screenshot-qc-owner-overview-demo-dark.png") });

  // 6. Plan & billing (Light & Dark)
  console.log("6. Plan and billing (Demo mode)...");
  await page.goto(`${BASE_URL}/app?demo=true&view=plan`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(screenshotsDir, "screenshot-qc-plan-demo-light.png") });

  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(screenshotsDir, "screenshot-qc-plan-demo-dark.png") });

  await browser.close();
  console.log("✓ All demo screenshots successfully captured.");
}

main().catch(console.error);
