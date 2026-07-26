import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Checker rule (H2): every /api/cron/* route MUST authorise through
// rejectUnauthorizedCron (which fails closed) and MUST NOT hand-roll the old
// `if (secret && …)` guard that skipped auth when CRON_SECRET was unset.
const CRON_DIR = join(process.cwd(), "src/app/api/cron");

const cronRouteFiles = (): string[] =>
  readdirSync(CRON_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => join(CRON_DIR, e.name, "route.ts"));

describe("cron routes fail closed", () => {
  const files = cronRouteFiles();

  it("finds cron route files to check", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)("%s uses rejectUnauthorizedCron", (file) => {
    const src = readFileSync(file, "utf8");
    expect(src).toContain("rejectUnauthorizedCron");
  });

  it.each(files)("%s does not use the fail-open `if (secret &&` guard", (file) => {
    const src = readFileSync(file, "utf8");
    expect(src).not.toMatch(/if\s*\(\s*secret\s*&&/);
    expect(src).not.toMatch(/if\s*\(\s*secret\s*\)/);
  });
});
