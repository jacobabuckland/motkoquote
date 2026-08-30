import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { findDrift, schemaFromMigrations } from "../../scripts/ci/schema-in-tree";

// #409: twelve selects name columns no migration creates. PostgREST rejects
// such a select outright, so the call site gets null and reads it as "nothing
// there" — the same shape as the `quotes.sent_total` failure that took the job
// page and every customer quote link down on 26 Aug.
//
// Most of the twelve needed production confirmation before they could be
// fixed, because the right replacement depends on what actually exists there.
// Jacob confirmed the live schema on 30 Aug and the set has been closing since
// — DATA-3 (#454), DATA-4 (#457) and FEE-5 (#460) among them. Each entry below
// is a site that is now clean and must stay clean.
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

  it("the fee-recovery path names no phantom column", () => {
    // `hasCancelledMandate` selected `mandate_id, mandate_status`; the columns
    // are `fee_mandate_id` and `fee_mandate_status`. PostgREST rejected the
    // select, the error was thrown rather than swallowed, and it sat inside the
    // dry-run branch — so `scripts/reports/uncollectable-fees.ts` could not run
    // at all. Renaming the columns would not have helped: 'cancelled' is not in
    // fee_mandate_status's check constraint, so the flag would have been
    // permanently false. #460 deleted it.
    expect(driftIn("src/lib/recover-lost-fees.ts")).toEqual([]);
  });

  it("still detects drift when there is drift to detect", () => {
    // The guard against every assertion above passing because the checker
    // stopped working.
    //
    // This used to name three files that were still drifting and assert the
    // count was non-zero. That inverts the incentive — fixing the last real
    // drift turns this red, and the cheapest way out is to stop looking at the
    // file that got fixed. It fired on exactly that when #460 cleaned up the
    // third of the three.
    //
    // A synthetic select against the REAL migrations proves the same thing and
    // stays true however clean the repository gets.
    const drift = findDrift(
      "src/synthetic.ts",
      'supabase.from("contractors").select("mandate_status")',
      tables,
    );
    expect(drift).toHaveLength(1);
    expect(drift[0]!.table).toBe("contractors");
    expect(drift[0]!.column).toBe("mandate_status");
  });
});
