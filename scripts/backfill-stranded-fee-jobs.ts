#!/usr/bin/env tsx

/**
 * Backfill script for issue #184: Correct jobs stranded at accrued under collected collections
 *
 * Usage:
 *   # Dry run (default) - generates report without making changes
 *   npx tsx scripts/backfill-stranded-fee-jobs.ts
 *
 *   # Write mode - applies corrections (run AFTER reviewing dry-run report)
 *   npx tsx scripts/backfill-stranded-fee-jobs.ts --apply
 *
 * The dry-run report is saved to docs/backfill-184-report.md for review.
 */

import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { correctStrandedFeeJobs } from "../src/lib/correct-stranded-fee-jobs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Error: Missing required environment variables");
  console.error("  NEXT_PUBLIC_SUPABASE_URL");
  console.error("  SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const dryRun = !process.argv.includes("--apply");

async function main() {
  console.log("=".repeat(80));
  console.log("Issue #184: Correct jobs stranded at accrued under collected collections");
  console.log("=".repeat(80));
  console.log();

  if (dryRun) {
    console.log("Mode: DRY RUN (no changes will be made)");
    console.log("To apply corrections, run with --apply flag after reviewing the report");
  } else {
    console.log("Mode: WRITE (corrections will be applied)");
    console.log("WARNING: This will update job records. Ensure you've reviewed the dry-run report.");
    console.log();

    // Safety confirmation in write mode
    if (process.env.CI !== "true") {
      console.log("Press Ctrl+C to abort, or wait 5 seconds to proceed...");
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }

  console.log();
  console.log("Connecting to Supabase...");

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  console.log("Running backfill function...");
  console.log();

  const result = await correctStrandedFeeJobs(supabase, { dryRun });

  console.log("Results:");
  console.log("-".repeat(80));
  console.log(`Stranded jobs found: ${result.strandedJobsFound}`);
  console.log(`Not yet double-charged: ${result.notYetDoubleCharged.length}`);
  console.log(`Already double-charged: ${result.alreadyDoubleCharged.length}`);
  console.log(`Jobs corrected: ${result.corrected}`);
  console.log("-".repeat(80));
  console.log();

  if (result.strandedJobsFound === 0) {
    console.log("✓ No stranded jobs found. The system is clean.");
    console.log();
    return;
  }

  // Generate detailed report
  const reportLines: string[] = [];
  reportLines.push("# Issue #184 Backfill Report");
  reportLines.push("");
  reportLines.push(`Generated: ${new Date().toISOString()}`);
  reportLines.push(`Mode: ${dryRun ? "DRY RUN" : "WRITE"}`);
  reportLines.push("");
  reportLines.push("## Summary");
  reportLines.push("");
  reportLines.push(`- **Stranded jobs found:** ${result.strandedJobsFound}`);
  reportLines.push(`- **Not yet double-charged:** ${result.notYetDoubleCharged.length}`);
  reportLines.push(`- **Already double-charged:** ${result.alreadyDoubleCharged.length}`);
  reportLines.push(`- **Jobs corrected:** ${result.corrected}`);
  reportLines.push("");

  if (result.notYetDoubleCharged.length > 0) {
    reportLines.push("## Not Yet Double-Charged");
    reportLines.push("");
    reportLines.push("These jobs are stranded (accrued under a collected collection) but have NOT been charged a second time yet. Correcting their fee_status prevents future double-billing.");
    reportLines.push("");
    reportLines.push("| Job ID | Collection ID | Contractor ID | Period Start | Fee Amount (pennies) |");
    reportLines.push("|--------|---------------|---------------|--------------|----------------------|");

    for (const job of result.notYetDoubleCharged) {
      reportLines.push(
        `| ${job.jobId} | ${job.collectionId} | ${job.contractorId} | ${job.periodStart} | ${job.feeAmountPennies} |`
      );
    }
    reportLines.push("");
  }

  if (result.alreadyDoubleCharged.length > 0) {
    reportLines.push("## Already Double-Charged");
    reportLines.push("");
    reportLines.push("These jobs were charged twice — once in their original collection and again in a later collection. They require MANUAL REFUND via TrueLayer.");
    reportLines.push("");
    reportLines.push("| Job ID | First Collection | Second Collection | First Period | Second Period | Fee Amount (pennies) |");
    reportLines.push("|--------|------------------|-------------------|--------------|---------------|----------------------|");

    for (const job of result.alreadyDoubleCharged) {
      reportLines.push(
        `| ${job.jobId} | ${job.firstCollectionId} | ${job.secondCollectionId} | ${job.firstPeriodStart} | ${job.secondPeriodStart} | ${job.feeAmountPennies} |`
      );
    }
    reportLines.push("");
    reportLines.push("**Action required:** Process manual refunds for the second charge amount for each contractor affected.");
    reportLines.push("");
  }

  if (dryRun) {
    reportLines.push("## Next Steps");
    reportLines.push("");
    reportLines.push("1. Review this report carefully");
    reportLines.push("2. Verify the stranded jobs list matches expectations");
    reportLines.push("3. If approved, run the backfill in write mode:");
    reportLines.push("   ```bash");
    reportLines.push("   npx tsx scripts/backfill-stranded-fee-jobs.ts --apply");
    reportLines.push("   ```");
    reportLines.push("4. Process manual refunds for already-double-charged jobs (if any)");
    reportLines.push("");
  } else {
    reportLines.push("## Correction Applied");
    reportLines.push("");
    reportLines.push(`${result.corrected} jobs have been updated to fee_status='collected'.`);
    reportLines.push("");
    reportLines.push("The backfill is complete. Re-running will find zero stranded jobs (idempotent).");
    reportLines.push("");
  }

  const report = reportLines.join("\n");

  // Save report to file
  const reportPath = resolve(__dirname, "../docs/backfill-184-report.md");
  writeFileSync(reportPath, report, "utf-8");

  console.log(`Report saved to: ${reportPath}`);
  console.log();

  // Print the report to console
  console.log(report);

  if (dryRun && result.strandedJobsFound > 0) {
    console.log("✓ Dry run complete. Review the report above before applying corrections.");
  } else if (!dryRun && result.corrected > 0) {
    console.log("✓ Backfill complete. Jobs have been corrected.");
  }

  console.log();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Error running backfill:");
    console.error(error);
    process.exit(1);
  });
