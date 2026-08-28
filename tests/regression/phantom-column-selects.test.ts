import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { findDrift, schemaFromMigrations } from "../../scripts/ci/schema-in-tree";

// #409: twelve selects name columns no migration creates. PostgREST rejects
// such a select outright, so the call site gets null and reads it as "nothing
// there" — the same shape as the `quotes.sent_total` failure that took the job
// page and every customer quote link down on 26 Aug.
//
// Most of the twelve need production confirmation before they can be fixed,
// because the right replacement depends on what actually exists there. These
// two do not: they named columns they never read, so removing them is neutral
// whatever production has, and each was a live breakage.
//
// Asserted through the real parser against the real migrations rather than by
// matching the source, so it survives any refactor of the query and fails only
// if a column with no migration behind it comes back.

const tables = (() => {
  const dir = "supabase/migrations";
  const migrations = readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => ({ path: join(dir, name), sql: readFileSync(join(dir, name), "utf8") }));
  const { tables, unmodelled } = schemaFromMigrations(migrations);
  // A rename or drop this parser does not model would make the column set
  // wrong, and a wrong column set produces confident nonsense in both
  // directions. Fail loudly rather than assert against it.
  expect(unmodelled, "migrations use a shape schema-in-tree.ts does not model").toEqual([]);
  return tables;
})();

const driftIn = (file: string) => findDrift(file, readFileSync(file, "utf8"), tables);

describe("selects that named columns nothing creates", () => {
  it("the add-cost-voice page names no phantom column", () => {
    // It selected customer_name and job_reference and read neither, so `job`
    // was always null and `if (!job) redirect("/jobs")` always fired. The page
    // could never load, and the error was not destructured, so nothing said so.
    expect(driftIn("src/app/jobs/[id]/add-cost-voice/page.tsx")).toEqual([]);
  });

  it("logging a cost by voice names no phantom column", () => {
    // Same shape: it threw "Job not found" for a job that exists.
    const drift = driftIn("src/app/costs/actions.ts").filter((f) => f.line > 80 && f.line < 120);
    expect(drift).toEqual([]);
  });

  it("still sees the drift that has NOT been fixed", () => {
    // The guard against this test passing because the checker stopped working.
    // These need production confirmation before the right replacement is known,
    // so they are deliberately still here — see #409.
    const remaining = [
      ...driftIn("src/app/jobs/[id]/pnl-actions.ts"),
      ...driftIn("src/app/ledger/query-actions.ts"),
      ...driftIn("src/lib/recover-lost-fees.ts"),
    ];
    expect(remaining.length).toBeGreaterThan(0);
  });
});
