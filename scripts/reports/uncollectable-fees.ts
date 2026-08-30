/**
 * Reports fees motko is owed but has no rail to collect on.
 *
 * PAY-7 (#239) is a decision — invoice the contractor, charge their balance,
 * net against future fees, or write the lot off — and the card says plainly it
 * "needs a number in front of it, not an agent". This is the number.
 *
 * recoverLostFees() has existed since #185, is dry-run by default, and had no
 * caller. AGENTS.md names that state directly: two money backfills shipped as
 * library functions with no entry point, every gate green, and the deliverable
 * could not be run. This is the entry point for one of them.
 *
 * READ-ONLY. recoverLostFees(admin) with no contractorId takes the dry-run
 * branch and writes nothing. Passing a contractor id would switch it to write
 * mode, so this script does not accept one — there is no flag that makes it
 * modify anything.
 *
 * RUNNABLE: npx tsx scripts/reports/uncollectable-fees.ts
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the
 * environment. Run it against production, since numbers from anywhere else
 * would answer a question nobody asked.
 */

import { createClient } from "@supabase/supabase-js";
import { recoverLostFees } from "../../src/lib/recover-lost-fees";

const pounds = (pennies: number): string =>
  `£${(pennies / 100).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const main = async (): Promise<void> => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    console.error(
      "Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running.",
    );
    process.exit(2);
  }

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // No contractorId: the dry-run branch. Nothing is written.
  const report = await recoverLostFees(admin);

  const totalPennies = report.contractors.reduce(
    (sum, c) => sum + c.totalRecoveredFeePennies,
    0,
  );

  // The denominator. £0 across a large pool of correctly-settled jobs and £0
  // across a pool of two look identical without it, and they support very
  // different conclusions about whether the defect ever happened.
  const { count: paidJobs } = await admin
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .not("paid_at", "is", null);

  console.log(`ran against: ${url}\n`);

  console.log("1. Fees recoverable from partial settlement (#185 dry-run)");
  console.log(`  paid jobs examined:   ${paidJobs ?? "unknown"}`);
  console.log(`  total value:          ${pounds(totalPennies)}`);
  console.log(`  contractors affected: ${report.contractors.length}`);
  console.log(`  jobs affected:        ${report.totalAffectedJobs}`);
  console.log(
    `  deleted/anonymised:   ${report.deletedOrAnonymisedContractors.length}` +
      " (collection may be impossible or prohibited)",
  );
  console.log(`  ${report.message}`);

  if (report.contractors.length > 0) {
    console.log("\nPer contractor:");
    for (const c of [...report.contractors].sort(
      (a, b) => b.totalRecoveredFeePennies - a.totalRecoveredFeePennies,
    )) {
      console.log(
        `  ${c.contractorId}  ${pounds(c.totalRecoveredFeePennies).padStart(12)}` +
          `  ${c.affectedJobs.length} job(s)`,
      );
    }
  }

  // Source 2 of 3. Counted whether or not a provider_collection_ref was ever
  // minted: PAY-5 removed the rail these would have been charged on, so a
  // pending collection is uncollectable either way. Filtering on a null ref
  // would underreport the quantity this exists to measure.
  const { data: stranded, error: strandedError } = await admin
    .from("fee_collections")
    .select("contractor_id, total_pennies, provider_collection_ref")
    .eq("status", "pending");

  if (strandedError) throw strandedError;

  // Zero-value rows are free-job batches: nothing to collect, so they are
  // counted but contribute nothing.
  const rows = stranded ?? [];
  const chargeable = rows.filter((r) => (r.total_pennies as number) > 0);
  const strandedPennies = chargeable.reduce(
    (sum, r) => sum + (r.total_pennies as number),
    0,
  );
  const strandedContractors = new Set(
    chargeable.map((r) => r.contractor_id as string),
  );
  const withRef = chargeable.filter((r) => r.provider_collection_ref !== null).length;

  console.log("\n2. Stranded pending fee collections");
  console.log(`  pending rows:         ${rows.length} (${rows.length - chargeable.length} zero-value)`);
  console.log(`  total value:          ${pounds(strandedPennies)}`);
  console.log(`  contractors affected: ${strandedContractors.size}`);
  console.log(
    `  reached TrueLayer:    ${withRef} of ${chargeable.length}` +
      " (carry a provider ref; the rail is gone either way)",
  );

  console.log("\n3. Fees lost to over-waived free jobs");
  console.log("  NOT MEASURED — no detection exists for this source anywhere in the codebase.");

  const combined = totalPennies + strandedPennies;
  const allContractors = new Set([
    ...report.contractors.map((c) => c.contractorId),
    ...strandedContractors,
  ]);

  console.log("\nCombined across the two sources that can be measured");
  console.log(`  total value:          ${pounds(combined)}`);
  console.log(`  contractors affected: ${allContractors.size}`);

  // The decision this feeds is PAY-7's and it is a person's to make. Stating
  // the threshold rather than applying it: the card says option (d), writing
  // the lot off, becomes correct if the total is small, and small is not
  // something this script gets to decide.
  console.log(
    `\nPAY-7 (#239) asks which collection mechanism to build. ${pounds(combined)} ` +
      `across ${allContractors.size} contractor(s), with source 3 unmeasured, is the ` +
      "input to that choice, not the answer.",
  );
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
