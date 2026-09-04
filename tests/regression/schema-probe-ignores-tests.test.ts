import { describe, expect, it } from "vitest";

import { isTestFile } from "../../scripts/ci/schema-probe";

// The probe reads `.from("t")` and `.insert({ col: … })` as references to real
// tables and columns. That is right for shipped code and wrong for a test,
// where those strings are FIXTURES.
//
// PFIX-6 was blocked by exactly this:
//
//   Column 'whatever' referenced in tests/regression/schema-in-tree.test.ts
//   does not exist in production table 'quotes'
//   Column 'mandate_status' referenced in ... does not exist in ... 'quotes'
//
// Both are invented names inside that file's own DROP COLUMN cases. Left
// alone, any PR whose tests name a column production does not have would hit
// it — which is most PRs that test schema handling at all.
//
// This is the same direction as the comment-stripping fix the probe already
// carries: more precise, not more permissive. A test naming a column that is
// not there fails its own assertion in the gate. It cannot reach production
// and so cannot drift from it.

describe("what the drift probe treats as production code", () => {
  it("skips the two files that actually blocked PFIX-6", () => {
    expect(isTestFile("tests/regression/schema-in-tree.test.ts")).toBe(true);
    expect(isTestFile("tests/acceptance/542.test.ts")).toBe(true);
  });

  it("skips tests and fixtures wherever they live", () => {
    for (const path of [
      "tests/regression/anything.test.ts",
      "tests/helpers/pipeline-compare.ts",
      "fixtures/pipeline/scenario-1.ts",
      "src/lib/quote-math.test.ts",
      "src/checks/function-privileges.check.test.ts",
      "src/components/thing.spec.tsx",
    ]) {
      expect(isTestFile(path), path).toBe(true);
    }
  });

  it("still scans everything that can actually reach production", () => {
    // The load-bearing half. Narrowing what a drift check looks at is only
    // safe while it still looks at the code that ships, and #387 took every
    // job page down over a column that was missing from production.
    for (const path of [
      "src/app/jobs/actions.ts",
      "src/lib/account-erasure.ts",
      "src/lib/supabase/middleware.ts",
      "scripts/ci/schema-probe.ts",
      "scripts/backfill/recover-over-waived-fees.ts",
    ]) {
      expect(isTestFile(path), path).toBe(false);
    }
  });

  it("does not skip a file merely because its name contains 'test'", () => {
    // `contest`, `latest`, `attestation` — a substring match here would quietly
    // stop scanning shipped code, which is the failure mode that matters.
    for (const path of [
      "src/lib/latest.ts",
      "src/lib/attestation.ts",
      "src/app/contest/page.tsx",
      "src/lib/testimonials.ts",
    ]) {
      expect(isTestFile(path), path).toBe(false);
    }
  });
});
