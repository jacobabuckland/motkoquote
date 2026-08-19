import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * PAY-7 (#239) needs a number before anyone can choose a collection mechanism.
 * recoverLostFees() has computed that number since #185 and had no caller —
 * the state AGENTS.md describes as "every gate passed and the deliverable could
 * not be run".
 *
 * These invoke the command, rather than importing the function behind it. That
 * distinction is the whole point: a test that imports and asserts a return
 * value is satisfied by a library function, which is how this got shipped
 * without an entry point twice.
 */

const SCRIPT = "scripts/reports/uncollectable-fees.ts";
const REPO = resolve(__dirname, "../..");

const run = (env: Record<string, string>) =>
  spawnSync("npx", ["tsx", SCRIPT], {
    cwd: REPO,
    encoding: "utf8",
    env: { ...process.env, ...env },
    timeout: 60_000,
  });

describe("the uncollectable-fees report is runnable", () => {
  it("exists at the path its RUNNABLE line names", () => {
    expect(existsSync(resolve(REPO, SCRIPT))).toBe(true);
  });

  it("refuses to run without credentials, naming both", () => {
    const proc = run({
      NEXT_PUBLIC_SUPABASE_URL: "",
      SUPABASE_SERVICE_ROLE_KEY: "",
    });

    expect(proc.status).toBe(2);
    expect(proc.stderr).toMatch(/NEXT_PUBLIC_SUPABASE_URL/);
    expect(proc.stderr).toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
  }, 60_000);

  it("takes no argument that could switch it into write mode", () => {
    // recoverLostFees(admin, contractorId) applies corrections when a
    // contractor id is passed. The runner must offer no way to reach that
    // branch, so a read-only report cannot become a money write by flag.
    const source = readFileSync(resolve(REPO, SCRIPT), "utf8");

    expect(source).toContain("recoverLostFees(admin)");
    expect(source).not.toMatch(/recoverLostFees\(\s*admin\s*,/);
    expect(source).not.toMatch(/process\.argv\[\d\]/);
  });
});
