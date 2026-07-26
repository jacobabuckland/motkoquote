#!/usr/bin/env node
// Generate a demo-account Playwright storageState for the QA smoke suite.
//
// Opens a real browser, lets YOU sign in by hand as the seeded demo account
// (no credential ever touches the repo, an env var, or an agent), then saves
// the authenticated session to e2e/.auth/demo.json for the smoke suite to reuse.
//
// Usage:  node scripts/qa-save-auth.mjs
// Requires the `playwright` dependency (already in devDependencies) and its
// browser binaries: `npx playwright install chromium`.

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createInterface } from "node:readline";

const BASE_URL = process.env.QA_BASE_URL ?? "https://motko.app";
const OUT = "e2e/.auth/demo.json";

const waitForEnter = (prompt) =>
  new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, () => (rl.close(), resolve()));
  });

const main = async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/login`);

  console.log(
    "\nSign in as the SEEDED DEMO ACCOUNT in the browser window, land on /dashboard,",
  );
  await waitForEnter("then come back here and press Enter to save the session… ");

  mkdirSync(dirname(OUT), { recursive: true });
  await context.storageState({ path: OUT });
  console.log(`\nSaved authenticated session -> ${OUT} (git-ignored; do not commit).`);
  await browser.close();
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
