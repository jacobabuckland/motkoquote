#!/usr/bin/env tsx

/**
 * Backfill entry point for issue #123: Correct duplicate referral_unlock credits.
 *
 * Usage:
 *   # Dry run (the default) — writes nothing, prints the report and saves it
 *   npx tsx scripts/backfill/correct-referral-duplicates.ts
 *
 *   # Correcting write — only after the dry-run report has been reviewed
 *   npx tsx scripts/backfill/correct-referral-duplicates.ts --apply
 *
 * The dry-run report is written to docs/backfill-reports/123-referral-duplicates.json,
 * which the spec requires to be reviewed and approved before --apply is ever passed.
 *
 * This moves user-visible balances: it deletes surplus credit_events rows and
 * decrements the matching free_jobs_remaining cache. The two writes are
 * sequential rather than atomic — see criterion 7 in docs/specs/123.md — so a
 * contractor whose decrement fails after its delete landed is reported by id
 * as partially corrected, and the nightly reconcile closes the gap regardless.
 */

import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { correctReferralDuplicates } from "../../src/lib/correct-referral-duplicates";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Error: missing required environment variables");
  console.error("  NEXT_PUBLIC_SUPABASE_URL");
  console.error("  SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const applyCorrections = process.argv.includes("--apply");
const REPORT_PATH = resolve(
  __dirname,
  "../../docs/backfill-reports/123-referral-duplicates.json",
);

const main = async (): Promise<void> => {
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  console.log("Issue #123: correct duplicate referral_unlock credits");
  console.log(
    applyCorrections
      ? "Mode: APPLY — deletes surplus rows and decrements balances"
      : "Mode: DRY RUN — nothing is written",
  );
  console.log();

  const report = await correctReferralDuplicates(admin, {
    dryRun: !applyCorrections,
    applyCorrections,
  });

  console.log(`Affected contractors:  ${report.affectedContractors}`);
  console.log(`Total surplus credits: ${report.totalSurplusCredits}`);

  for (const correction of report.corrections) {
    const shortfall =
      correction.shortfall > 0 ? `  (shortfall ${correction.shortfall})` : "";
    console.log(
      `  ${correction.contractorId}: -${correction.surplusCredits} credits, ` +
        `${correction.currentBalance} → ${correction.resultingBalance}${shortfall}`,
    );
  }

  if (applyCorrections) {
    console.log();
    console.log(`Corrected: ${report.successfulContractors?.length ?? 0}`);

    const failed = report.failedContractors ?? [];
    if (failed.length > 0) {
      console.error();
      console.error(
        `Partially corrected — delete landed, decrement did not (${failed.length}):`,
      );
      for (const failure of failed) {
        console.error(`  ${failure.contractorId}: ${failure.error ?? "unknown"}`);
      }
      console.error();
      console.error(
        "Re-run to retry these. The nightly reconcile-free-jobs job will also " +
          "bring their cached balances back in line with the ledger on its own.",
      );
      process.exit(1);
    }
  } else {
    writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
    console.log();
    console.log(`Report written to ${REPORT_PATH}`);
    console.log("Review it, then re-run with --apply to execute the correction.");
  }
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
