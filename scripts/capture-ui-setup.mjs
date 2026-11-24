import { chromium } from "playwright";
import { createBrowserClient } from "@supabase/ssr";
import fs from "fs";
import path from "path";

// Load .env.staging.local
const envContent = fs.readFileSync(".env.staging.local", "utf8");
const env = {};
for (const line of envContent.split("\n")) {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
  if (match) {
    let value = match[2] || "";
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
    env[match[1]] = value.trim();
  }
}

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const STAGING_EMAIL = env.STAGING_TEST_EMAIL || process.env.STAGING_TEST_EMAIL;
const STAGING_PASSWORD = env.STAGING_TEST_PASSWORD || process.env.STAGING_TEST_PASSWORD;

async function run() {
  console.log("Authenticating staging user with createBrowserClient...");
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
    console.error("Auth failed:", authError);
    process.exit(1);
  }
  console.log("Staging user authenticated. Cookies count:", Object.keys(cookieJar).length);

  const outDir = path.resolve("public/screenshots/ui-setup");
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });

  const playwrightCookies = Object.entries(cookieJar).map(([name, value]) => ({
    name,
    value,
    domain: "localhost",
    path: "/",
    httpOnly: false,
    secure: false,
    sameSite: "Lax",
  }));

  const themes = ["light", "dark", "gradient"];
  const viewports = [
    { name: "desktop", width: 1440, height: 900 },
    { name: "mobile", width: 390, height: 844 },
  ];

  for (const vp of viewports) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    await context.addCookies(playwrightCookies);
    const page = await context.newPage();

    for (const theme of themes) {
      console.log(`Capturing ${theme} at ${vp.width}px...`);
      await page.goto(`http://localhost:3333/app/dev/components?theme=${theme}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(500);

      const filePath = path.join(outDir, `dev-components-${theme}-${vp.width}.png`);
      await page.screenshot({ path: filePath, fullPage: true });
      console.log(`Saved: ${filePath}`);
    }
    await context.close();
  }

  // Also capture the Leads row close-up in gradient theme for side-by-side comparison
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addCookies(playwrightCookies);
  const page = await context.newPage();
  await page.goto("http://localhost:3333/app/dev/components?theme=gradient", { waitUntil: "networkidle" });
  await page.waitForTimeout(500);

  // Capture lead row section
  const leadRowSection = page.locator("text=Reference Verification: Lead Row").locator("xpath=../..");
  await leadRowSection.screenshot({ path: path.join(outDir, "dev-leads-row-gradient.png") });
  console.log("Saved: dev-leads-row-gradient.png");

  // Also open reference HTML file in browser and screenshot its rows for comparison
  const refPage = await context.newPage();
  const refPath = "file://" + path.resolve("docs/ui-reference/leads.html");
  await refPage.goto(refPath, { waitUntil: "networkidle" });
  await refPage.waitForTimeout(500);
  const refRows = refPage.locator(".llist");
  await refRows.screenshot({ path: path.join(outDir, "ref-leads-row-gradient.png") });
  console.log("Saved: ref-leads-row-gradient.png");

  await browser.close();
  console.log("Screenshots captured successfully.");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
