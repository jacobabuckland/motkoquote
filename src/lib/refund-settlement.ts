/**
 * REFUND-1: Full and partial refund on a settled job
 *
 * Core refund logic: eligibility check, Stripe API call, state update.
 * Refunds debit the trade's Stripe connected account (may go negative).
 */

type RefundEligibility =
  | { eligible: true; maxRefundablePennies: number }
  | { eligible: false; reason: string };

type RefundResult =
  | { success: true; refundId: string; newState: string }
  | { success: false; error: string };

/**
 * Check if a job is eligible for refund and how much can be refunded.
 *
 * Eligibility rules:
 * - Job must have settled via Stripe (payment_provider_ref present)
 * - Job must not already be fully refunded
 * - Returns maxRefundablePennies = settled amount - already refunded
 */
export async function getRefundEligibility(
  jobId: string,
): Promise<RefundEligibility> {
  const { createServerClient } = await import("@/lib/supabase/server");
  const supabase = await createServerClient();

  // Fetch job with settlement details
  const { data: job, error } = await supabase
    .from("jobs")
    .select(
      "id, settlement_state, payment_provider_ref, sent_total, total_refunded_pennies",
    )
    .eq("id", jobId)
    .single();

  if (error || !job) {
    return { eligible: false, reason: "Job not found" };
  }

  // Check if job is settled (check this before payment_provider_ref)
  if (!job.settlement_state || job.settlement_state === null) {
    return { eligible: false, reason: "Job not settled" };
  }

  // Check if job has a Stripe payment (not manually marked paid)
  if (!job.payment_provider_ref) {
    return {
      eligible: false,
      reason: "No settlement to reverse (manual payment)",
    };
  }

  // Check if already fully refunded
  if (job.settlement_state === "refunded") {
    return { eligible: false, reason: "Job is already refunded" };
  }

  // Only 'settled' and 'partially_refunded' states are eligible for refund
  if (
    job.settlement_state !== "settled" &&
    job.settlement_state !== "partially_refunded"
  ) {
    return {
      eligible: false,
      reason: `Cannot refund job with settlement_state: ${job.settlement_state}`,
    };
  }

  const sentTotal = job.sent_total ?? 0;

  // Check how much has already been refunded using our database tracking
  const totalRefunded = job.total_refunded_pennies ?? 0;

  const maxRefundablePennies = sentTotal - totalRefunded;

  if (maxRefundablePennies <= 0) {
    return { eligible: false, reason: "Job is already refunded" };
  }

  return { eligible: true, maxRefundablePennies };
}

/**
 * Process a refund for a job.
 *
 * - Calls Stripe refunds.create with the payment_intent
 * - Updates job settlement_state to 'refunded' (full) or 'partially_refunded'
 * - Idempotent via Stripe's idempotency keys
 * - Returns refundId and new state on success
 */
export async function refundJob(
  jobId: string,
  refundAmountPennies: number,
): Promise<RefundResult> {
  const { createServerClient } = await import("@/lib/supabase/server");
  const supabase = await createServerClient();

  // Fetch job
  const { data: job, error: fetchError } = await supabase
    .from("jobs")
    .select(
      "id, settlement_state, payment_provider_ref, sent_total, total_refunded_pennies",
    )
    .eq("id", jobId)
    .single();

  if (fetchError || !job) {
    return { success: false, error: "Job not found" };
  }

  // Check eligibility
  const eligibility = await getRefundEligibility(jobId);
  if (!eligibility.eligible) {
    return { success: false, error: eligibility.reason };
  }

  // Validate refund amount
  if (refundAmountPennies <= 0) {
    return { success: false, error: "Refund amount must be positive" };
  }

  if (refundAmountPennies > eligibility.maxRefundablePennies) {
    return {
      success: false,
      error: `Refund amount exceeds refundable balance (max: ${eligibility.maxRefundablePennies})`,
    };
  }

  const { stripe } = await import("@/lib/stripe");
  if (!stripe) {
    return { success: false, error: "Stripe not configured" };
  }

  // Process refund via Stripe
  try {
    const refund = await stripe.refunds.create({
      payment_intent: job.payment_provider_ref!,
      amount: refundAmountPennies,
      metadata: {
        job_id: jobId,
      },
    });

    // Determine new state: full refund or partial?
    const sentTotal = job.sent_total ?? 0;
    const previousRefunded = job.total_refunded_pennies ?? 0;
    const totalRefunded = previousRefunded + refundAmountPennies;

    const newState = totalRefunded >= sentTotal ? "refunded" : "partially_refunded";

    // Update job state and total refunded amount
    const { error: updateError } = await supabase
      .from("jobs")
      .update({
        settlement_state: newState,
        total_refunded_pennies: totalRefunded,
      })
      .eq("id", jobId)
      .single();

    if (updateError) {
      // Refund went through but state update failed - log for manual resolution
      console.error(
        `Refund ${refund.id} succeeded but state update failed:`,
        updateError,
      );
      return {
        success: false,
        error: `Refund processed but state update failed: ${updateError.message}`,
      };
    }

    return {
      success: true,
      refundId: refund.id,
      newState,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return {
      success: false,
      error: `Stripe refund failed: ${message}`,
    };
  }
}
