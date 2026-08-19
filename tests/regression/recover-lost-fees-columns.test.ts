import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * recoverLostFees selected `jobs.invoiced_total_pennies`, a column that has
 * never existed in any migration. The function was therefore incapable of
 * running against a real database, and nobody found out because:
 *
 *   - its unit test mocks the query and asserts the select STRING, so the
 *     wrong name was pinned rather than caught;
 *   - it had no caller until #289, so it was never executed;
 *   - the schema-drift probe only inspects files changed in a PR, so a
 *     reference that shipped wrong is never looked at again.
 *
 * Production said so the first time it ran: `column jobs.invoiced_total_pennies
 * does not exist`. This checks the columns against the migrations instead of
 * against a string, which is the only version of this assertion that could
 * have failed.
 */

const REPO = resolve(__dirname, "../..");

const migrationsSql = (): string =>
  readdirSync(resolve(REPO, "supabase/migrations"))
    .filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(resolve(REPO, "supabase/migrations", f), "utf8"))
    .join("\n");

/** The columns the dry-run actually asks Postgres for. */
const selectedJobColumns = (): string[] => {
  const source = readFileSync(resolve(REPO, "src/lib/recover-lost-fees.ts"), "utf8");
  const match = /\.from\("jobs"\)\s*\n\s*\.select\("([^"]+)"\)/.exec(source);
  expect(match, "could not find the jobs select in recover-lost-fees.ts").not.toBeNull();
  return match![1].split(",").map((c) => c.trim());
};

describe("recoverLostFees queries columns that exist", () => {
  it("every column it selects from jobs is defined by a migration", () => {
    const sql = migrationsSql();

    for (const column of selectedJobColumns()) {
      // `id` is on the table from creation and never appears in an ALTER.
      if (column === "id") continue;

      expect(
        sql.includes(column),
        `recover-lost-fees.ts selects jobs.${column}, which no migration defines`,
      ).toBe(true);
    }
  });

  it("does not select the column that never existed", () => {
    // Named explicitly so the regression is legible rather than implied.
    expect(selectedJobColumns()).not.toContain("invoiced_total_pennies");
    expect(selectedJobColumns()).toContain("job_value_pennies");
  });
});
