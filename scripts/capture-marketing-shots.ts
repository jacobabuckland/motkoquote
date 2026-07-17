/**
 * Capture the real product screenshots used by the landing page, at iPhone
 * dimensions (390×844, dpr 2 → 780×1688 px), into public/marketing/*.png.
 * Screenshots default to the top of each page, so the 4:5 top-anchored crop the
 * landing page applies (see screen-frame.tsx) lines up automatically.
 *
 * Prereqs:
 *   1. pnpm add -D playwright && pnpm dlx playwright install chromium
 *   2. pnpm dlx tsx scripts/seed-demo-contractor.ts
 *      → prints DEMO_QUOTE_SENT / DEMO_QUOTE_ACCEPTED / DEMO_JOB ids
 *   3. A running app:  pnpm dev   (defaults to http://localhost:3000)
 *
 * Run (ids come from the seed output):
 *   BASE_URL=http://localhost:3000 \
 *   DEMO_QUOTE_SENT=<id> DEMO_QUOTE_ACCEPTED=<id> DEMO_JOB=<id> \
 *   pnpm dlx tsx scripts/capture-marketing-shots.ts
 *
 * Public /q/<id> pages need no login; /dashboard and /jobs/<id> log in first.
 * Any screen missing its id (or that errors) is skipped; the landing page keeps
 * its same-size placeholder for that slot. See public/marketing/MISSING.md.
 */
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = "public/marketing";
const EMAIL = "demo@harrisonelectrical.co.uk";
const PASSWORD = "MotkoDemo!2026";

const QUOTE_SENT = process.env.DEMO_QUOTE_SENT;
const QUOTE_ACCEPTED = process.env.DEMO_QUOTE_ACCEPTED;
const JOB = process.env.DEMO_JOB;

// screen → { route, whether it needs an authenticated session }.
// All customer-facing docs render from the public /q view. To keep the adjacent
// carousel cards distinct: quote = the sent quote (Accept/Decline), sow + accept
// = the accepted quote ("You accepted this quote"). dashboard + job are authed.
const SHOTS: { file: string; path: string | undefined; auth: boolean }[] = [
  { file: "dashboard.png", path: "/dashboard", auth: true },
  { file: "quote.png", path: QUOTE_SENT && `/q/${QUOTE_SENT}`, auth: false },
  { file: "sow.png", path: QUOTE_ACCEPTED && `/q/${QUOTE_ACCEPTED}`, auth: false },
  { file: "accept.png", path: QUOTE_ACCEPTED && `/q/${QUOTE_ACCEPTED}`, auth: false },
  { file: "job.png", path: JOB && `/jobs/${JOB}`, auth: true },
];

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  // Log in once (needed for the authed shots).
  await page.goto(`${BASE}/login`);
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(`${BASE}/dashboard`, { timeout: 15000 }).catch(() => {});

  for (const shot of SHOTS) {
    if (!shot.path) {
      console.warn(`skipped ${shot.file} — no id provided (keeps placeholder)`);
      continue;
    }
    try {
      await page.goto(`${BASE}${shot.path}`, { waitUntil: "networkidle" });
      await page.evaluate(() => window.scrollTo(0, 0));
      // Hide the Next.js dev-mode indicator so it doesn't leak into shots.
      await page.addStyleTag({
        content:
          "nextjs-portal,[data-next-badge-root],[data-nextjs-toast],#__next-build-watcher{display:none!important}",
      });
      await page.screenshot({ path: `${OUT}/${shot.file}` });
      console.log(`captured ${shot.file} ← ${shot.path}`);
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
