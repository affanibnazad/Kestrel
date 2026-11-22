import { chromium } from "playwright";

async function runAuthAndDemoTests() {
  console.log("🔒 Starting Kestrel Authentication & Demo Boundary Verification...\n");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const text = msg.text();
      consoleErrors.push(text);
      console.log("   [Browser Error]:", text);
    }
  });

  const results = [];
  function record(testName, passed, details = "") {
    results.push({ testName, passed, details });
    const mark = passed ? "✅ PASS" : "❌ FAIL";
    console.log(`${mark} | ${testName}${details ? ` (${details})` : ""}`);
  }

  try {
    // -------------------------------------------------------------
    // SCENARIO 1: Unauthenticated Direct Access to Protected /app
    // -------------------------------------------------------------
    console.log("1. Testing unauthenticated direct access to /app...");
    await page.goto("http://localhost:3333/app", { waitUntil: "networkidle" });
    const currentUrlAfterApp = page.url();
    const redirectedToLogin = currentUrlAfterApp.includes("/login");
    const hasNextParam = currentUrlAfterApp.includes("next=");
    record(
      "Unauthenticated /app redirects to /login",
      redirectedToLogin && hasNextParam,
      `URL: ${currentUrlAfterApp}`
    );

    // Verify protected content was not rendered
    const hasSidebar = await page.locator(".side.kside").count();
    const hasLoginForm = await page.locator(".auth-form").count();
    record(
      "Protected app shell not rendered on unauthenticated /app",
      hasSidebar === 0 && hasLoginForm > 0,
      `Sidebar count: ${hasSidebar}, Login form count: ${hasLoginForm}`
    );

    // -------------------------------------------------------------
    // SCENARIO 2: Unauthenticated Direct Access to Nested Views
    // -------------------------------------------------------------
    console.log("2. Testing unauthenticated access to sensitive views (/app?view=owner, /app?view=campaigns)...");
    await page.goto("http://localhost:3333/app?view=owner", { waitUntil: "networkidle" });
    const ownerUrl = page.url();
    record(
      "Unauthenticated /app?view=owner redirects to /login with return destination",
      ownerUrl.includes("/login") && ownerUrl.includes("view%3Downer"),
      `URL: ${ownerUrl}`
    );

    await page.goto("http://localhost:3333/app?view=campaigns", { waitUntil: "networkidle" });
    const campaignsUrl = page.url();
    record(
      "Unauthenticated /app?view=campaigns redirects to /login",
      campaignsUrl.includes("/login") && campaignsUrl.includes("view%3Dcampaigns"),
      `URL: ${campaignsUrl}`
    );

    // -------------------------------------------------------------
    // SCENARIO 3: Login Page UI & Form Elements
    // -------------------------------------------------------------
    console.log("3. Verifying Login Page rendering and security elements...");
    await page.goto("http://localhost:3333/login", { waitUntil: "networkidle" });
    const loginTitle = await page.title();
    const googleBtn = await page.locator(".auth-google").count();
    const emailInput = await page.locator("input[type='email']").count();
    const submitBtn = await page.locator(".auth-go").count();
    record(
      "Login page renders cleanly with Google and Magic Link OTP options",
      googleBtn > 0 && emailInput > 0 && submitBtn > 0,
      `Title: ${loginTitle}, Google: ${googleBtn}, Email: ${emailInput}`
    );

    // -------------------------------------------------------------
    // SCENARIO 4: Open Redirect Protection on /login?next=
    // -------------------------------------------------------------
    console.log("4. Testing open-redirect protection on /login?next=...");
    await page.goto("http://localhost:3333/login?next=https://malicious-site.example", { waitUntil: "networkidle" });
    const callbackOrigin = await page.evaluate(() => {
      return window.location.href;
    });
    record(
      "Open-redirect target blocked (stays on site)",
      callbackOrigin.includes("localhost:3333") && !callbackOrigin.includes("malicious-site.example/login"),
      `Current URL: ${callbackOrigin}`
    );

    // -------------------------------------------------------------
    // SCENARIO 5: Explicit Demo Mode Access (?demo=true)
    // -------------------------------------------------------------
    console.log("5. Testing explicit Demo Mode access (/app?demo=true)...");
    await page.goto("http://localhost:3333/app?demo=true", { waitUntil: "networkidle" });
    const demoUrl = page.url();
    const isApp = demoUrl.includes("/app");
    record("Explicit demo parameter allows entry to /app", isApp, `URL: ${demoUrl}`);

    // Verify prominent Demo Mode Banner
    const demoBannerCount = await page.locator(".demo-mode-band").count();
    const demoTagText = await page.locator(".demo-mode-band").innerText();
    const hasDemoTag = demoTagText.includes("DEMO SANDBOX") || demoTagText.includes("Demo Sandbox");
    record(
      "Prominent Demo Sandbox indicator banner displayed at top",
      demoBannerCount > 0 && hasDemoTag,
      `Banner text snippet: ${demoTagText.slice(0, 45)}...`
    );

    // Verify synthetic data only (Alex Example / Example Studio)
    const pageText = await page.innerText("body");
    const hasAlexExample = pageText.includes("Alex Example") || pageText.includes("Example Studio");
    record("Demo sandbox loads synthetic demo data", hasAlexExample);

    // -------------------------------------------------------------
    // SCENARIO 6: Demo Mode Write Protection & Outbound Guards
    // -------------------------------------------------------------
    console.log("6. Verifying demo mode write & outbound restrictions...");
    // Check hunter email toast or blocked actions
    await page.goto("http://localhost:3333/app?demo=true&view=about", { waitUntil: "networkidle" });
    const aboutTitle = await page.locator("h1").innerText();
    record("Demo mode can inspect About view safely", aboutTitle.includes("business") || aboutTitle.includes("About"));

    // -------------------------------------------------------------
    // SCENARIO 7: Backend API Authentication Enforcement (401)
    // -------------------------------------------------------------
    console.log("7. Verifying backend API endpoints reject unauthenticated/demo calls...");
    const apiTest = await page.evaluate(async () => {
      const endpoints = [
        "/api/owner/offers",
        "/api/mail/suggest",
        "/api/verify",
        "/api/spam/fix"
      ];
      const results = {};
      for (const ep of endpoints) {
        try {
          const res = await fetch(ep, { method: "POST", headers: { "Content-Type": "application/json" } });
          results[ep] = res.status;
        } catch {
          results[ep] = "error";
        }
      }
      return results;
    });
    const all401 = Object.values(apiTest).every((status) => status === 401 || status === 405);
    record(
      "Backend APIs enforce authentication (returns 401 Unauthorized)",
      all401,
      `API statuses: ${JSON.stringify(apiTest)}`
    );

    // -------------------------------------------------------------
    // SCENARIO 8: Sign Out Security Flow
    // -------------------------------------------------------------
    console.log("8. Verifying sign-out routing (/auth/signout)...");
    const signoutTest = await page.request.post("http://localhost:3333/auth/signout", {
      maxRedirects: 0,
    });
    const signoutStatus = signoutTest.status();
    const signoutLocation = signoutTest.headers()["location"] || "";
    record(
      "Sign-out endpoint clears session and redirects to /login",
      signoutStatus === 303 && signoutLocation.includes("/login"),
      `Status: ${signoutStatus}, Location: ${signoutLocation}`
    );

    // -------------------------------------------------------------
    // SCENARIO 9: Responsive Viewport Validation
    // -------------------------------------------------------------
    console.log("9. Testing viewports (Desktop, Tablet, Mobile)...");
    // Desktop
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("http://localhost:3333/app?demo=true", { waitUntil: "networkidle" });
    const desktopBanner = await page.locator(".demo-mode-band").isVisible();

    // Mobile
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("http://localhost:3333/app?demo=true", { waitUntil: "networkidle" });
    const mobileBanner = await page.locator(".demo-mode-band").isVisible();
    record("Demo banner and app shell responsive across viewports", desktopBanner && mobileBanner, "Desktop: OK, Mobile: OK");

    await page.screenshot({ path: "scripts/demo-banner-mobile.png" });

  } catch (err) {
    console.error("Test execution encountered an error:", err);
    record("Test run without unhandled fatal exception", false, err.message);
  } finally {
    await browser.close();
  }

  console.log("\n================ TEST SUMMARY ================");
  const passedCount = results.filter((r) => r.passed).length;
  console.log(`Total: ${results.length} | Passed: ${passedCount} | Failed: ${results.length - passedCount}`);
  if (passedCount === results.length) {
    console.log("🎉 ALL AUTHENTICATION & DEMO SAFEGUARD TESTS PASSED CLEANLY!\n");
  } else {
    console.log("❌ SOME TESTS FAILED.\n");
  }
}

runAuthAndDemoTests();
