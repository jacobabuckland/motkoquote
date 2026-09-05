import type { SupabaseClient } from "@supabase/supabase-js";
import { planPaidJobSettlement, type PaidJobFacts } from "@/lib/paid-job-settlement";

// Synthetic date for the one-off backfill collection that never collides with
// monthly batches (which use real calendar dates). Well before motko launched.
//
// NOTHING READS THIS ANY MORE — the write path that stamped it onto a
// fee_collections row was removed on 5 Sep 2026 (see recoverLostFees below).
// It stays exported because tests/acceptance/185.test.ts is frozen and asserts
// the export, its type, and that the year is before 2000. Do not delete it
// without retiring those assertions first, per AGENTS.md.
export const BACKFILL_PERIOD_START = "1970-01-01";

// Three months in milliseconds, for flagging very old jobs
const THREE_MONTHS_MS = 90 * 24 * 60 * 60 * 1000;

export type AffectedJob = {
  jobId: string;
  contractorId: string;
  paidAt: string;
  jobValuePennies: number;
  shouldAccrueFee: boolean; // true = fee, false = burn credit
  feeAmountPennies?: number; // present when shouldAccrueFee is true
  feeNetPennies?: number;
  feeVatPennies?: number;
  isVeryOld: boolean; // >3 months since paid_at
};

export type ContractorReport = {
  contractorId: string;
  affectedJobs: AffectedJob[];
  totalRecoveredFeePennies: number;
  historicalFreeJobsRemaining: number; // after backfill corrections
};

export type LostFeeReport = {
  contractors: ContractorReport[];
  deletedOrAnonymisedContractors: string[];
  totalAffectedJobs: number;
  message: string; // "No lost fees found" or summary
};

export type RecoverLostFeesInput = {
  admin: SupabaseClient;
  contractorId?: string; // when present, runs in write mode for this contractor only
};

// Reconstructs the historical free_jobs_remaining at a given timestamp by
// summing all credit_events up to that point
const computeHistoricalAllowance = async (
  admin: SupabaseClient,
  contractorId: string,
  asOf: string,
): Promise<number> => {
  const { data: events, error } = await admin
    .from("credit_events")
    .select("delta")
    .eq("contractor_id", contractorId)
    .lte("created_at", asOf);

  if (error) throw error;
  if (!events) return 0;
  return events.reduce((sum, e) => sum + (e.delta as number), 0);
};

// Identifies jobs that were paid but have no fee accrued and no free credit
// burned due to partial settlement failure
const findAffectedJobs = async (
  admin: SupabaseClient,
  contractorId?: string,
): Promise<AffectedJob[]> => {
  // Filter for jobs that were marked paid but have no fee accrued and no
  // waived-fee reason set (the signature of a partial settlement failure).
  // The fee_waived_reason IS NULL filter excludes correctly-processed jobs
  // where the free allowance was properly burned (those have fee_waived_reason
  // = 'free_allowance'). However, we also call planPaidJobSettlement below to
  // future-proof against exemptions that might not set fee_waived_reason.
  let query = admin
    .from("jobs")
    .select("id, contractor_id, paid_at, job_value_pennies, fee_waived_reason")
    .not("paid_at", "is", null)
    .eq("fee_status", "not_applicable")
    .is("fee_waived_reason", null);

  if (contractorId) {
    query = query.eq("contractor_id", contractorId);
  }

  const { data: jobs, error } = await query;
  if (error) throw error;
  if (!jobs || jobs.length === 0) return [];

  const affected: AffectedJob[] = [];
  const now = Date.now();

  for (const job of jobs) {
    const paidAt = new Date(job.paid_at as string);
    const ageMs = now - paidAt.getTime();

    // Reconstruct historical allowance at time of payment
    const historicalAllowance = await computeHistoricalAllowance(
      admin,
      job.contractor_id as string,
      job.paid_at as string,
    );

    // Use planPaidJobSettlement to determine what SHOULD have happened at the
    // time of payment. This ensures we use the same exemption logic as the
    // settlement path, never re-deriving it.
    const facts: PaidJobFacts = {
      jobId: job.id as string,
      contractorId: job.contractor_id as string,
      jobValuePennies: job.job_value_pennies as number,
      freeJobsRemaining: historicalAllowance,
      isFirstPaidJob: false, // not relevant for fee calculation
      pendingReferral: null, // not relevant for fee calculation
    };

    const plan = planPaidJobSettlement(facts);

    // If the plan says the job should be fee-exempt (not_applicable) AND it
    // already has the correct fee_waived_reason set, it's correctly processed
    // and should be excluded.
    if (
      plan.fee.feeStatus === "not_applicable" &&
      job.fee_waived_reason === plan.fee.feeWaivedReason
    ) {
      // Job is correctly processed with the right exemption reason - skip it
      continue;
    }

    // If the plan says the job should accrue a fee but current state says
    // not_applicable, that's a lost fee.
    // If the plan says the job should be waived (free_allowance) but current
    // state has no fee_waived_reason, that's a lost credit burn.
    const shouldAccrueFee = plan.fee.feeStatus === "accrued";
    let feeAmountPennies: number | undefined;
    let feeNetPennies: number | undefined;
    let feeVatPennies: number | undefined;

    if (shouldAccrueFee) {
      feeAmountPennies = plan.fee.feeAmountPennies;
      feeNetPennies = plan.fee.feeNetPennies;
      feeVatPennies = plan.fee.feeVatPennies;
    }

    affected.push({
      jobId: job.id as string,
      contractorId: job.contractor_id as string,
      paidAt: job.paid_at as string,
      jobValuePennies: job.job_value_pennies as number,
      shouldAccrueFee,
      feeAmountPennies,
      feeNetPennies,
      feeVatPennies,
      isVeryOld: ageMs > THREE_MONTHS_MS,
    });
  }

  return affected;
};

// Dry-run mode: reports affected jobs per contractor without making changes
const dryRun = async (
  admin: SupabaseClient,
  contractorId?: string,
): Promise<LostFeeReport> => {
  const affected = await findAffectedJobs(admin, contractorId);

  if (affected.length === 0) {
    return {
      contractors: [],
      deletedOrAnonymisedContractors: [],
      totalAffectedJobs: 0,
      message: "No lost fees found",
    };
  }

  // Group by contractor
  const byContractor = new Map<string, AffectedJob[]>();
  for (const job of affected) {
    if (!byContractor.has(job.contractorId)) {
      byContractor.set(job.contractorId, []);
    }
    byContractor.get(job.contractorId)!.push(job);
  }

  const contractors: ContractorReport[] = [];
  const deletedOrAnonymised: string[] = [];

  for (const [cId, jobs] of byContractor) {
    // Check if contractor still exists
    const { data: contractor, error } = await admin
      .from("contractors")
      .select("id")
      .eq("id", cId)
      .maybeSingle();

    if (error) throw error;
    if (!contractor) {
      deletedOrAnonymised.push(cId);
      continue;
    }

    const totalRecoveredFeePennies = jobs
      .filter((j) => j.shouldAccrueFee)
      .reduce((sum, j) => sum + (j.feeAmountPennies ?? 0), 0);

    // Compute historical allowance after all corrections
    const latestJob = jobs.reduce((latest, j) =>
      new Date(j.paidAt) > new Date(latest.paidAt) ? j : latest,
    );
    const historicalAllowance = await computeHistoricalAllowance(
      admin,
      cId,
      latestJob.paidAt,
    );

    contractors.push({
      contractorId: cId,
      affectedJobs: jobs,
      totalRecoveredFeePennies,
      historicalFreeJobsRemaining: historicalAllowance,
    });
  }

  return {
    contractors,
    deletedOrAnonymisedContractors: deletedOrAnonymised,
    totalAffectedJobs: affected.length,
    message: `Found ${affected.length} affected job${affected.length === 1 ? "" : "s"} across ${contractors.length} contractor${contractors.length === 1 ? "" : "s"}`,
  };
};

// Main entry point. READ-ONLY: it counts what was never charged and reports it.
// `contractorId` narrows the report to one contractor.
//
// THE WRITE PATH IS GONE, DELIBERATELY (5 Sep 2026, Jacob's decision: the
// recovery is "no longer required"). Passing a contractorId used to switch this
// into apply-corrections mode — inserting a fee_collections row, writing
// credit_events and calling increment_free_jobs_remaining.
//
// It never ran, and it could not have: the fee_collections insert named a
// `gross_pennies` column that exists in no migration and not on production
// (the table has total_pennies, net_pennies, vat_pennies). Nothing ever called
// it with a contractorId, so the throw was never reached. schema-drift-probe
// found it on 5 Sep when an unrelated one-line change to this file brought it
// into view, and it blocked RAIL-2 for a defect that was never RAIL-2's.
//
// The dry run below is the half that is actually used —
// scripts/reports/uncollectable-fees.ts calls it — and it is untouched.
//
// The name and BACKFILL_PERIOD_START are kept because tests/acceptance/185.test.ts
// is frozen and asserts both. That contract says nothing about the write path:
// every one of its "write mode" cases only checks the export is defined.
export const recoverLostFees = async (
  admin: SupabaseClient,
  contractorId?: string,
): Promise<LostFeeReport> => dryRun(admin, contractorId);
