/**
 * Capture the real product screenshots used by the landing page, at iPhone
 * dimensions (390×844, dpr 2), into public/marketing/*.png.
 *
 * Prereqs:
 *   1. pnpm add -D playwright && pnpm dlx playwright install chromium
 *   2. pnpm dlx tsx scripts/seed-demo-contractor.ts   (creates the demo login)
 *   3. A running app:  pnpm dev   (defaults to http://localhost:3000)
 *
 * Run:  pnpm dlx tsx scripts/capture-marketing-shots.ts
 * Env:  BASE_URL (default http://localhost:3000)
 *
 * Any screen that can't be captured non-interactively gets skipped with a note;
 * the landing page falls back to a same-size placeholder (see MISSING.md).
 */
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = "public/marketing";
const EMAIL = "demo@harrisonelectrical.co.uk";
const PASSWORD = "MotkoDemo!2026";

// route → output filename. Adjust the routes to your seeded ids as needed.
const SHOTS: { file: string; path: string }[] = [
  { file: "dashboard.png", path: "/dashboard" },
  { file: "quote.png", path: "/dashboard" }, // TODO: point at a specific quote page
  { file: "sow.png", path: "/dashboard" }, // TODO: point at the scope-of-work view
  { file: "accept.png", path: "/dashboard" }, // TODO: point at the accepted/signed view
  { file: "job.png", path: "/dashboard" }, // TODO: point at a job page
];

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  // Log in once.
  await page.goto(`${BASE}/login`);
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(`${BASE}/dashboard`, { timeout: 15000 }).catch(() => {});

  for (const shot of SHOTS) {
    try {
      await page.goto(`${BASE}${shot.path}`, { waitUntil: "networkidle" });
      await page.screenshot({ path: `${OUT}/${shot.file}` });
      console.log(`captured ${shot.file}`);
    } catch (e) {
      console.warn(`skipped ${shot.file} — ${(e as Error).message}`);
    }
  }

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
