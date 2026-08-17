/**
 * Issue #123: [BACKFILL] Correct duplicate referral_unlock credits
 *
 * Detects and corrects duplicate referral_unlock credit_events that occurred
 * when a referee's first two jobs settled concurrently, granting the referrer
 * 10 free jobs instead of 5.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type CreditEvent = {
  id: string;
  contractor_id: string;
  delta: number;
  reason: string;
  related_job_id: string | null;
  related_referral_id: string | null;
  created_at: string; // ISO timestamp
};

export type Contractor = {
  id: string;
  free_jobs_remaining: number;
};

export type ContractorCorrection = {
  contractorId: string;
  surplusCredits: number; // Number of duplicate credits (e.g. 5 for one duplicate, 10 for two)
  currentBalance: number;
  resultingBalance: number;
  shortfall: number; // Credits already spent beyond entitlement
  eventIdsToDelete: string[];
};

export type CorrectionPlan = {
  corrections: ContractorCorrection[];
};

export type ContractorResult = {
  contractorId: string;
  success: boolean;
  error?: string;
};

export type CorrectionReport = {
  affectedContractors: number;
  totalSurplusCredits: number;
  corrections: ContractorCorrection[];
  orphanedEvents?: number;
  timestamp: string;
  appliedCorrections?: number;
  successfulContractors?: string[];
  failedContractors?: ContractorResult[];
};

export type CorrectionOptions = {
  dryRun?: boolean;
  applyCorrections?: boolean;
};

/**
 * Pure analysis function: detects duplicate referral_unlock credit_events
 * and computes a correction plan.
 *
 * Algorithm:
 * 1. Filter to referral_unlock events only
 * 2. Group by related_referral_id
 * 3. For each group with count > 1:
 *    - Sort by created_at, then by id (for deterministic tie-breaking)
 *    - Keep the earliest event, mark the rest for deletion
 *    - Calculate surplus credits and resulting balance
 *    - Record shortfall if balance would go negative
 */
export function computeReferralDuplicateCorrections(
  events: CreditEvent[],
  contractors: Contractor[]
): CorrectionPlan {
  // Filter to referral_unlock events only
  const referralUnlockEvents = events.filter(
    (e) => e.reason === "referral_unlock" && e.related_referral_id !== null
  );

  // Group by related_referral_id
  const groupedByReferral = new Map<string, CreditEvent[]>();
  for (const event of referralUnlockEvents) {
    const referralId = event.related_referral_id!;
    if (!groupedByReferral.has(referralId)) {
      groupedByReferral.set(referralId, []);
    }
    groupedByReferral.get(referralId)!.push(event);
  }

  // Build contractor lookup
  const contractorMap = new Map<string, Contractor>();
  for (const contractor of contractors) {
    contractorMap.set(contractor.id, contractor);
  }

  // Process each group to find duplicates
  const corrections: ContractorCorrection[] = [];

  for (const eventGroup of groupedByReferral.values()) {
    if (eventGroup.length <= 1) {
      // No duplicates for this referral
      continue;
    }

    // Sort by created_at, then by id for deterministic tie-breaking
    const sortedEvents = [...eventGroup].sort((a, b) => {
      const timeCompare = a.created_at.localeCompare(b.created_at);
      if (timeCompare !== 0) return timeCompare;
      // Tie-break by id
      return a.id.localeCompare(b.id);
    });

    // Keep the first (earliest), delete the rest
    const eventToKeep = sortedEvents[0];
    const eventsToDelete = sortedEvents.slice(1);

    // Find the contractor
    const contractor = contractorMap.get(eventToKeep.contractor_id);
    if (!contractor) {
      // Orphaned event - contractor doesn't exist
      // Per spec, these are not corrected (no contractor to update)
      continue;
    }

    // Calculate correction
    const surplusCredits = eventsToDelete.length * 5; // Each duplicate event is +5
    const currentBalance = contractor.free_jobs_remaining;
    const resultingBalance = Math.max(0, currentBalance - surplusCredits);
    const shortfall = Math.max(0, surplusCredits - currentBalance);

    corrections.push({
      contractorId: contractor.id,
      surplusCredits,
      currentBalance,
      resultingBalance,
      shortfall,
      eventIdsToDelete: eventsToDelete.map((e) => e.id),
    });
  }

  return { corrections };
}

/**
 * Async runner: fetches data, runs the analysis, and optionally applies corrections.
 *
 * @param admin - Supabase admin client
 * @param options - dryRun (default true) or applyCorrections (default false)
 * @returns Correction report
 */
export async function correctReferralDuplicates(
  admin: SupabaseClient,
  options: CorrectionOptions = {}
): Promise<CorrectionReport> {
  const { dryRun = true, applyCorrections = false } = options;

  // Fetch all referral_unlock credit_events
  const { data: events, error: eventsError } = await admin
    .from("credit_events")
    .select("id, contractor_id, delta, reason, related_job_id, related_referral_id, created_at")
    .eq("reason", "referral_unlock");

  if (eventsError) {
    throw new Error(`Failed to fetch credit_events: ${eventsError.message}`);
  }

  // Fetch all contractors
  const { data: contractors, error: contractorsError } = await admin
    .from("contractors")
    .select("id, free_jobs_remaining");

  if (contractorsError) {
    throw new Error(`Failed to fetch contractors: ${contractorsError.message}`);
  }

  // Run the pure analysis
  const plan = computeReferralDuplicateCorrections(
    events as CreditEvent[],
    contractors as Contractor[]
  );

  // Build the report
  const timestamp = new Date().toISOString();
  const report: CorrectionReport = {
    affectedContractors: plan.corrections.length,
    totalSurplusCredits: plan.corrections.reduce(
      (sum, c) => sum + c.surplusCredits,
      0
    ),
    corrections: plan.corrections,
    timestamp,
  };

  // If dry-run mode, return the report without applying changes
  if (dryRun || !applyCorrections) {
    return report;
  }

  // Apply corrections (best-effort sequential operations per contractor)
  // Note: True atomicity requires a database function (see spec discussion).
  // This implementation performs delete then decrement sequentially; if the
  // decrement fails, the delete is already committed. Failed contractors are
  // reported so they can be retried.
  let appliedCount = 0;
  const successfulContractors: string[] = [];
  const failedContractors: ContractorResult[] = [];

  for (const correction of plan.corrections) {
    try {
      // Delete surplus credit_events
      const { error: deleteError } = await admin
        .from("credit_events")
        .delete()
        .in("id", correction.eventIdsToDelete);

      if (deleteError) {
        throw deleteError;
      }

      // Decrement free_jobs_remaining using the correct parameter names
      const decrementAmount = -correction.surplusCredits;
      const { error: decrementError } = await admin.rpc(
        "increment_free_jobs_remaining",
        {
          p_id: correction.contractorId,
          p_delta: decrementAmount,
        }
      );

      if (decrementError) {
        throw decrementError;
      }

      appliedCount++;
      successfulContractors.push(correction.contractorId);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(
        `Failed to apply correction for contractor ${correction.contractorId}:`,
        error
      );
      failedContractors.push({
        contractorId: correction.contractorId,
        success: false,
        error: errorMessage,
      });
      // Continue with other contractors
    }
  }

  report.appliedCorrections = appliedCount;
  report.successfulContractors = successfulContractors;
  report.failedContractors = failedContractors;
  return report;
}
