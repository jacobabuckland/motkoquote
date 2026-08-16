import type { SupabaseClient } from "@supabase/supabase-js";
import { planPaidJobSettlement, type PaidJobFacts } from "@/lib/paid-job-settlement";

// Synthetic date for the one-off backfill collection that never collides with
// monthly batches (which use real calendar dates). Well before motko launched.
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
  hasCancelledMandate: boolean;
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
  const { data: events } = await admin
    .from("credit_events")
    .select("delta")
    .eq("contractor_id", contractorId)
    .lte("created_at", asOf);

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
    .select("id, contractor_id, paid_at, invoiced_total_pennies, fee_waived_reason")
    .not("paid_at", "is", null)
    .eq("fee_status", "not_applicable")
    .is("fee_waived_reason", null);

  if (contractorId) {
    query = query.eq("contractor_id", contractorId);
  }

  const { data: jobs } = await query;
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
      jobValuePennies: job.invoiced_total_pennies as number,
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
      jobValuePennies: job.invoiced_total_pennies as number,
      shouldAccrueFee,
      feeAmountPennies,
      feeNetPennies,
      feeVatPennies,
      isVeryOld: ageMs > THREE_MONTHS_MS,
    });
  }

  return affected;
};

// Checks if a contractor has a cancelled mandate
const hasCancelledMandate = async (
  admin: SupabaseClient,
  contractorId: string,
): Promise<boolean> => {
  const { data: contractor } = await admin
    .from("contractors")
    .select("mandate_id, mandate_status")
    .eq("id", contractorId)
    .single();

  return contractor?.mandate_status === "cancelled";
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
    const { data: contractor } = await admin
      .from("contractors")
      .select("id")
      .eq("id", cId)
      .single();

    if (!contractor) {
      deletedOrAnonymised.push(cId);
      continue;
    }

    const totalRecoveredFeePennies = jobs
      .filter((j) => j.shouldAccrueFee)
      .reduce((sum, j) => sum + (j.feeAmountPennies ?? 0), 0);

    const cancelled = await hasCancelledMandate(admin, cId);

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
      hasCancelledMandate: cancelled,
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

// Write mode: applies corrections for a single contractor
const applyCorrections = async (
  admin: SupabaseClient,
  contractorId: string,
): Promise<LostFeeReport> => {
  const affected = await findAffectedJobs(admin, contractorId);

  if (affected.length === 0) {
    return {
      contractors: [],
      deletedOrAnonymisedContractors: [],
      totalAffectedJobs: 0,
      message: `No lost fees found for contractor ${contractorId}`,
    };
  }

  // Separate jobs by correction type
  const feeJobs = affected.filter((j) => j.shouldAccrueFee);
  const creditJobs = affected.filter((j) => !j.shouldAccrueFee);

  // Apply fee corrections: create collection FIRST, then update jobs.
  // This ordering ensures idempotency: if job updates fail, re-running will
  // find the jobs again and skip creating a duplicate collection.
  if (feeJobs.length > 0) {
    const totalGross = feeJobs.reduce(
      (sum, j) => sum + (j.feeAmountPennies ?? 0),
      0,
    );
    const totalNet = feeJobs.reduce((sum, j) => sum + (j.feeNetPennies ?? 0), 0);
    const totalVat = feeJobs.reduce((sum, j) => sum + (j.feeVatPennies ?? 0), 0);

    // Check if a backfill collection already exists for this contractor
    const { data: existingCollection } = await admin
      .from("fee_collections")
      .select("id")
      .eq("contractor_id", contractorId)
      .eq("period_start", BACKFILL_PERIOD_START)
      .maybeSingle();

    // Only create if it doesn't exist - supports idempotent re-runs
    if (!existingCollection) {
      await admin.from("fee_collections").insert({
        contractor_id: contractorId,
        period_start: BACKFILL_PERIOD_START,
        period_end: BACKFILL_PERIOD_START, // synthetic period
        status: "pending",
        gross_pennies: totalGross,
        net_pennies: totalNet,
        vat_pennies: totalVat,
        job_ids: feeJobs.map((j) => j.jobId),
      });
    }

    // Now update all fee jobs. These updates are the "commit point" - once
    // done, the jobs won't be found by the query again.
    for (const job of feeJobs) {
      await admin
        .from("jobs")
        .update({
          fee_amount_pennies: job.feeAmountPennies,
          fee_net_pennies: job.feeNetPennies,
          fee_vat_pennies: job.feeVatPennies,
          fee_status: "accrued",
        })
        .eq("id", job.jobId);
    }
  }

  // Apply credit corrections: write ledger entry, update cache via RPC, then
  // update job. The RPC call (increment_free_jobs_remaining) must be used
  // instead of directly updating the cache, per spec section 4.
  for (const job of creditJobs) {
    // Check if credit_events row already exists for this job
    const { data: existingCreditEvent } = await admin
      .from("credit_events")
      .select("id")
      .eq("contractor_id", contractorId)
      .eq("reason", "job_consumed")
      .eq("related_job_id", job.jobId)
      .maybeSingle();

    // Only create if it doesn't exist - prevents duplicate ledger entries
    if (!existingCreditEvent) {
      await admin.from("credit_events").insert({
        contractor_id: contractorId,
        delta: -1,
        reason: "job_consumed",
        related_job_id: job.jobId,
        related_referral_id: null,
      });

      // Call increment_free_jobs_remaining RPC to update the cache, matching
      // the settlement path (src/lib/settle-paid-job.ts:159). This ensures
      // the cache stays in sync with the ledger and encapsulates any logic
      // the RPC contains (constraints, triggers, consistency checks).
      await admin.rpc("increment_free_jobs_remaining", {
        p_id: contractorId,
        p_delta: -1,
      });
    }

    // Always update the job (in case it wasn't updated in a prior failed run).
    // This is the "commit point" - once done, the job won't be found again.
    await admin
      .from("jobs")
      .update({
        fee_status: "not_applicable",
        fee_waived_reason: "free_allowance",
      })
      .eq("id", job.jobId);
  }

  // Return a report of what was corrected
  const totalRecoveredFeePennies = feeJobs.reduce(
    (sum, j) => sum + (j.feeAmountPennies ?? 0),
    0,
  );
  const cancelled = await hasCancelledMandate(admin, contractorId);

  return {
    contractors: [
      {
        contractorId,
        affectedJobs: affected,
        totalRecoveredFeePennies,
        hasCancelledMandate: cancelled,
        historicalFreeJobsRemaining: await computeHistoricalAllowance(
          admin,
          contractorId,
          new Date().toISOString(),
        ),
      },
    ],
    deletedOrAnonymisedContractors: [],
    totalAffectedJobs: affected.length,
    message: `Corrected ${affected.length} job${affected.length === 1 ? "" : "s"} for contractor ${contractorId} (${feeJobs.length} fee${feeJobs.length === 1 ? "" : "s"}, ${creditJobs.length} credit${creditJobs.length === 1 ? "" : "s"})`,
  };
};

// Main entry point: dry-run by default, write mode when contractorId is provided
export const recoverLostFees = async (
  admin: SupabaseClient,
  contractorId?: string,
): Promise<LostFeeReport> => {
  if (contractorId) {
    return applyCorrections(admin, contractorId);
  }
  return dryRun(admin);
};
