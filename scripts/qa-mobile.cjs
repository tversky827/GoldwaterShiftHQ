/**
 * Mobile QA: signs in as the demo employee and checks every employee screen on
 * several devices for (1) anything wider than the screen, (2) buttons/links
 * too small to tap comfortably (< 40 px), (3) JavaScript or console errors.
 * Saves a screenshot of each screen in ./qa-mobile/.
 *
 *   npm run dev        (or npm start), then in another window:
 *   QA_BASE_URL=http://localhost:3000 npm run qa:mobile
 *
 * Needs Playwright (npx playwright install chromium) and the demo data.
 */
const { chromium, devices } = require("playwright");
const fs = require("node:fs");
const BASE = process.env.QA_BASE_URL || "http://localhost:3000";
const OUT = "qa-mobile";
const DEVICES = ["iPhone SE", "iPhone 14", "Pixel 7", "iPad Mini"];
const SCREENS = ["/app", "/app/schedule", "/app/shifts", "/app/availability", "/app/profile"];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const problems = [];
  for (const name of DEVICES) {
    const ctx = await browser.newContext({ ...devices[name] });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => problems.push(`${name}: script error: ${e.message}`));
    page.on("console", (m) => m.type() === "error" && problems.push(`${name}: console error: ${m.text()}`));
    await page.goto(`${BASE}/login`);
    await page.fill('input[name="email"]', "employee@demo.test");
    await page.fill('input[name="password"]', process.env.DEMO_PASSWORD || "Demo-Password-2026");
    await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60000 }), page.click('button[type="submit"]')]);
    const screens = [...SCREENS];
    // Also the first shift's detail screen (swap / can't make it), if there is one.
    await page.goto(`${BASE}/app/schedule`, { waitUntil: "networkidle" });
    const detail = await page.locator('a[href^="/app/schedule/"]').first().getAttribute("href").catch(() => null);
    if (detail) screens.push(detail);
    for (const path of screens) {
      await page.goto(`${BASE}${path}`, { waitUntil: "networkidle", timeout: 120000 });
      const r = await page.evaluate(() => {
        const vw = window.innerWidth;
        const wide = document.documentElement.scrollWidth > vw + 1;
        const small = [...document.querySelectorAll("main a, main button, nav a, main input[type=checkbox], main input[type=radio]")]
          .filter((el) => el.offsetParent !== null)
          .map((el) => {
            const b = (el.closest("label") || el).getBoundingClientRect();
            return { text: (el.textContent || el.getAttribute("aria-label") || el.tagName).trim().slice(0, 40), w: Math.round(b.width), h: Math.round(b.height) };
          })
          .filter((x) => x.h < 40 || x.w < 40);
        return { wide, scrollWidth: document.documentElement.scrollWidth, vw, small };
      });
      const file = `${OUT}/${name.replace(/\s+/g, "-")}${path.replace(/\//g, "_").replace(/_app_schedule_[0-9a-f-]+$/, "_app_shift-detail")}.png`;
      await page.screenshot({ path: file, fullPage: true });
      if (r.wide) problems.push(`${name} ${path}: content is wider than the screen (${r.scrollWidth} > ${r.vw})`);
      for (const s of r.small) problems.push(`${name} ${path}: small tap target "${s.text}" (${s.w}×${s.h})`);
    }
    await ctx.close();
  }
  await browser.close();
  console.log(problems.length ? `\n${problems.length} problem(s):\n- ${problems.join("\n- ")}` : "\nAll screens passed on every device.");
  console.log(`Screenshots: ${OUT}/`);
  process.exit(problems.length ? 1 : 0);
})();
