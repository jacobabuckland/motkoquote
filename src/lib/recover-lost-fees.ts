import type { SupabaseClient } from "@supabase/supabase-js";
import { motkoFeePennies, splitFeeVat } from "@/lib/motko-fee";

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
  let query = admin
    .from("jobs")
    .select("id, contractor_id, paid_at, invoiced_total_pennies, fee_waived_reason")
    .not("paid_at", "is", null)
    .eq("fee_status", "not_applicable")
    // Exclude legitimately exempt jobs: those with fee_waived_reason already set
    // (e.g., 'free_allowance' means the free credit was properly burned)
    .is("fee_waived_reason", null);

  if (contractorId) {
    query = query.eq("contractor_id", contractorId);
  }

  const { data: jobs } = await query;
  if (!jobs || jobs.length === 0) return [];

  const affected: AffectedJob[] = [];
  const now = Date.now();

  for (const job of jobs) {
    // Exclude legitimately exempt jobs by checking what planPaidJobSettlement
    // would have done. If fee_waived_reason is null in the current state but
    // should be 'free_allowance', it's a lost free-job burn; otherwise it's
    // a bug (lost fee accrual).
    const paidAt = new Date(job.paid_at as string);
    const ageMs = now - paidAt.getTime();

    // Reconstruct historical allowance at time of payment
    const historicalAllowance = await computeHistoricalAllowance(
      admin,
      job.contractor_id as string,
      job.paid_at as string,
    );

    const shouldAccrueFee = historicalAllowance === 0;
    let feeAmountPennies: number | undefined;
    let feeNetPennies: number | undefined;
    let feeVatPennies: number | undefined;

    if (shouldAccrueFee) {
      const gross = motkoFeePennies(job.invoiced_total_pennies as number, 0);
      const split = splitFeeVat(gross);
      feeAmountPennies = gross;
      feeNetPennies = split.netPennies;
      feeVatPennies = split.vatPennies;
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

  // Apply fee corrections
  for (const job of feeJobs) {
    // Update job fee columns
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

  // Create one-off collection for all fee jobs
  if (feeJobs.length > 0) {
    const totalGross = feeJobs.reduce(
      (sum, j) => sum + (j.feeAmountPennies ?? 0),
      0,
    );
    const totalNet = feeJobs.reduce((sum, j) => sum + (j.feeNetPennies ?? 0), 0);
    const totalVat = feeJobs.reduce((sum, j) => sum + (j.feeVatPennies ?? 0), 0);

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

  // Apply credit corrections
  for (const job of creditJobs) {
    // Write missing credit_events row
    await admin.from("credit_events").insert({
      contractor_id: contractorId,
      delta: -1,
      reason: "job_consumed",
      related_job_id: job.jobId,
      related_referral_id: null,
    });

    // Update job to mark it as fee-waived
    await admin
      .from("jobs")
      .update({
        fee_status: "not_applicable",
        fee_waived_reason: "free_allowance",
      })
      .eq("id", job.jobId);
  }

  // Update the cache (free_jobs_remaining) if any credits were consumed
  if (creditJobs.length > 0) {
    const { data: contractor } = await admin
      .from("contractors")
      .select("free_jobs_remaining")
      .eq("id", contractorId)
      .single();

    if (contractor) {
      await admin
        .from("contractors")
        .update({
          free_jobs_remaining:
            (contractor.free_jobs_remaining as number) - creditJobs.length,
        })
        .eq("id", contractorId);
    }
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
