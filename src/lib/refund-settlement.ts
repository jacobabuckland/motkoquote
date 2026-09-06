// REFUND-1 — returning money on a settled job.
//
// Until now there was no refund path in the product, by design (see the SCOPE
// note in settlement-reversal.ts). Making Stripe Pay by Bank the default rail
// removes the assumption that made that tolerable: Pay by Bank has no
// chargeback mechanism, so a refund is the ONLY route by which money can come
// back to a customer. This module is that route.
//
// Three things here are load-bearing and are the reason this file is mostly
// comment. Each was got wrong once already.
//
// 1. WHAT "SETTLED" MEANS. Not `settlement_state = 'settled'`. Nothing in this
//    tree ever writes that value — settle-paid-job.ts records a settlement by
//    stamping `jobs.paid_at` — so gating on it produces a refund button that
//    can never appear. `settlement_state` is null on a normally settled job and
//    only becomes non-null once something has gone backwards (reversed, or now
//    refunded). So: paid_at is the settlement, settlement_state is the undoing.
//
// 2. WHERE THE CEILING COMES FROM. Stripe, never our own columns.
//    `invoices.amount` and `quotes.total` are numeric POUNDS; fee columns are
//    integer PENNIES; Stripe deals in pennies. Deriving the refundable amount
//    from a pounds column is a 100x error in a money path, and the same
//    confusion has already produced a wrong figure on the job page's paid
//    panel. Stripe knows exactly what it captured and exactly what has been
//    returned, in pennies, and it is the party that will accept or reject the
//    refund — so it is the only sane source for the ceiling.
//
// 3. reverse_transfer. Payments are DESTINATION charges: the customer pays the
//    platform, and `transfer_data.destination` moves the money on to the
//    trade's connected account (stripe-payments.ts). Refunding such a charge
//    WITHOUT `reverse_transfer: true` refunds the customer out of the
//    PLATFORM's balance and leaves the trade holding the money — motko would
//    silently underwrite every refund. The card is explicit that the money
//    comes out of the trade's account and may take it negative, and that is
//    what the trade is warned about before confirming.
//
//    `refund_application_fee` is left at its default of false, so motko's
//    service fee is NOT returned. That is FEE-10's published rule —
//    REVERSAL_CLAUSE.serviceFee, which the contractor terms state in the same
//    words — and it is why this module leaves every fee column untouched.

import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { createClient } from "@/lib/supabase/server";
import { stripe as defaultStripe } from "@/lib/stripe";
import { planSettlementReversal } from "@/lib/settlement-reversal";

/**
 * What a refund needs to reach. Injected so the logic can be exercised without
 * a network or a database; production passes nothing and gets the real pair.
 *
 * The Supabase client is deliberately the USER-scoped one, not the admin
 * client: `jobs` carries an owner-scoped RLS policy, so a job belonging to
 * another trade simply is not visible and cannot be updated. The server action
 * checks the session as well — this is the second lock, not the only one.
 */
export type RefundDeps = {
  supabase: SupabaseClient;
  stripe: Stripe;
};

export type RefundEligibility =
  | {
      eligible: true;
      /** The most that may still be returned, in pennies. Always > 0. */
      maxRefundablePennies: number;
      /** What Stripe captured from the customer, in pennies. */
      settledPennies: number;
      /** What has already been returned, in pennies. */
      alreadyRefundedPennies: number;
    }
  | { eligible: false; reason: string };

export type RefundResult =
  | { success: true; refundId: string; newState: string }
  | { success: false; error: string };

/** The settlement state after a refund. Distinct from paid, unpaid and reversed. */
type RefundState = "refunded" | "partially_refunded";

type JobRow = {
  id: string;
  paid_at: string | null;
  payment_provider_ref: string | null;
  settlement_state: string | null;
  total_refunded_pennies: number | null;
  fee_amount_pennies: number | null;
  fee_waived_amount_pennies: number | null;
  fee_waived_reason: string | null;
  processing_fee_actual_pennies: number | null;
};

const JOB_COLUMNS =
  "id, paid_at, payment_provider_ref, settlement_state, total_refunded_pennies, " +
  "fee_amount_pennies, fee_waived_amount_pennies, fee_waived_reason, " +
  "processing_fee_actual_pennies";

/**
 * A Stripe PaymentIntent id. TrueLayer settlements land in the same column
 * (`tl_…`), and a manual "mark as paid" leaves it null — neither can be
 * refunded through Stripe, and they are told apart because the two cases need
 * different words.
 */
const isStripeIntent = (ref: string | null): ref is string =>
  typeof ref === "string" && ref.startsWith("pi_");

/** Refund statuses that represent money that has left, or is leaving. */
const COUNTS_AS_RETURNED = new Set(["succeeded", "pending", "requires_action"]);

const resolveDeps = async (deps?: RefundDeps): Promise<RefundDeps | null> => {
  if (deps) return deps;
  if (!defaultStripe) return null;
  return { supabase: await createClient(), stripe: defaultStripe };
};

/**
 * Sum of every refund Stripe holds against this payment, in pennies.
 *
 * A pending refund counts. It has not settled yet, but the money is on its way
 * out, and excluding it is how a trade refunds the same payment twice.
 */
const refundedSoFarPennies = async (
  stripe: Stripe,
  paymentIntentId: string,
): Promise<number> => {
  const refunds = await stripe.refunds.list({
    payment_intent: paymentIntentId,
    limit: 100,
  });
  return refunds.data
    .filter((refund) => COUNTS_AS_RETURNED.has(refund.status ?? ""))
    .reduce((total, refund) => total + refund.amount, 0);
};

/**
 * Whether a job can be refunded, and by how much.
 *
 * Every ineligible branch returns a reason written for the trade rather than a
 * code: this text is rendered directly in the confirmation dialog, and "no
 * settlement to reverse" is one of the card's own acceptance criteria — the
 * manual-payment case has to say so rather than fail obscurely.
 */
export async function getRefundEligibility(
  jobId: string,
  deps?: RefundDeps,
): Promise<RefundEligibility> {
  const resolved = await resolveDeps(deps);
  if (!resolved) {
    return { eligible: false, reason: "Stripe isn't configured, so no refund can be made." };
  }
  const { supabase, stripe } = resolved;

  const { data, error } = await supabase
    .from("jobs")
    .select(JOB_COLUMNS)
    .eq("id", jobId)
    .maybeSingle();

  // RLS scopes `jobs` to the signed-in trade, so somebody else's job is not
  // "forbidden" here — it is simply absent, and says so.
  const job = data as JobRow | null;
  if (error || !job) return { eligible: false, reason: "Job not found." };

  if (!job.paid_at) {
    return {
      eligible: false,
      reason: "This job is not settled, so there's nothing to refund.",
    };
  }

  if (!job.payment_provider_ref) {
    return {
      eligible: false,
      reason:
        "No settlement to reverse — this job was marked paid manually, so the " +
        "money never came through motko. Refund your customer the same way they paid you.",
    };
  }

  if (!isStripeIntent(job.payment_provider_ref)) {
    return {
      eligible: false,
      reason:
        "This payment didn't go through Stripe, so it can't be refunded here. " +
        "Refund your customer the same way they paid you.",
    };
  }

  if (job.settlement_state === "refunded") {
    return { eligible: false, reason: "This job has already been fully refunded." };
  }

  if (job.settlement_state?.startsWith("reversed_")) {
    return {
      eligible: false,
      reason: "This payment was already reversed, so there's nothing left to refund.",
    };
  }

  let settledPennies: number;
  let alreadyRefundedPennies: number;
  try {
    const intent = await stripe.paymentIntents.retrieve(job.payment_provider_ref);
    // What Stripe actually took, not what was asked for. A partly-captured or
    // still-processing payment must not present its full amount as refundable.
    settledPennies = intent.amount_received ?? 0;
    alreadyRefundedPennies = await refundedSoFarPennies(stripe, job.payment_provider_ref);
  } catch {
    // Deliberately not falling back to our own columns. A refundable ceiling
    // guessed from a stale cache is how money moves twice; better to say the
    // check could not be made and let the trade try again.
    return {
      eligible: false,
      reason: "Couldn't reach Stripe to check what's refundable. Try again in a moment.",
    };
  }

  if (settledPennies <= 0) {
    return {
      eligible: false,
      reason: "Stripe hasn't collected this payment yet, so there's nothing to refund.",
    };
  }

  const maxRefundablePennies = settledPennies - alreadyRefundedPennies;
  if (maxRefundablePennies <= 0) {
    return { eligible: false, reason: "This job has already been fully refunded." };
  }

  return { eligible: true, maxRefundablePennies, settledPennies, alreadyRefundedPennies };
}

/**
 * Return `refundAmountPennies` to the customer.
 *
 * Idempotency has two layers, and the first is the one that matters. The
 * ceiling above is recomputed from Stripe on every call, so once a payment is
 * fully returned there is nothing left to refund and a repeat is refused
 * outright. The Stripe idempotency key underneath it covers the narrower case
 * of the SAME request arriving twice — a double-tap, a retried action — and is
 * keyed on how much had been refunded when this request was formed, so a
 * genuine second partial refund of the same amount still goes through.
 */
export async function refundJob(
  jobId: string,
  refundAmountPennies: number,
  deps?: RefundDeps,
): Promise<RefundResult> {
  const resolved = await resolveDeps(deps);
  if (!resolved) {
    return { success: false, error: "Stripe isn't configured, so no refund can be made." };
  }
  const { supabase, stripe } = resolved;

  const eligibility = await getRefundEligibility(jobId, resolved);
  if (!eligibility.eligible) {
    return { success: false, error: eligibility.reason };
  }

  const { maxRefundablePennies, settledPennies, alreadyRefundedPennies } = eligibility;

  if (!Number.isInteger(refundAmountPennies) || refundAmountPennies <= 0) {
    return { success: false, error: "Enter a refund amount greater than zero." };
  }

  if (refundAmountPennies > maxRefundablePennies) {
    return {
      success: false,
      error: `That's more than is left to refund on this job (£${(
        maxRefundablePennies / 100
      ).toFixed(2)}).`,
    };
  }

  // Re-read the job for the fee columns. getRefundEligibility has already
  // proved it exists, is settled, and carries a Stripe intent.
  const { data } = await supabase
    .from("jobs")
    .select(JOB_COLUMNS)
    .eq("id", jobId)
    .maybeSingle();
  const job = data as JobRow | null;
  if (!job || !isStripeIntent(job.payment_provider_ref)) {
    return { success: false, error: "Job not found." };
  }

  const totalRefundedAfter = alreadyRefundedPennies + refundAmountPennies;

  // settlement-reversal.ts owns what a reversal does to the fee columns, and
  // says so: "When one is built it calls planSettlementReversal rather than
  // deciding for itself." Its answer is that nothing changes — the service fee
  // is not refunded, is not pro-rated, and a burned free-job credit does not
  // come back. So no fee column is written below, and this call is what makes
  // that a decision taken by the rule rather than an omission.
  const plan = planSettlementReversal({
    fees: {
      feeAmountPennies: job.fee_amount_pennies ?? 0,
      feeWaivedAmountPennies: job.fee_waived_amount_pennies ?? 0,
      processingFeeActualPennies: job.processing_fee_actual_pennies,
      freeCreditConsumed: job.fee_waived_reason === "free_allowance",
    },
    refundPennies: totalRefundedAfter,
    paymentPennies: settledPennies,
    settled: true,
  });

  const newState: RefundState = plan.partial ? "partially_refunded" : "refunded";

  let refund: Stripe.Refund;
  try {
    refund = await stripe.refunds.create(
      {
        payment_intent: job.payment_provider_ref,
        amount: refundAmountPennies,
        // See the header. Without this the platform pays and the trade keeps
        // the money. With it, the transfer is reversed pro-rata and the
        // trade's connected account carries the refund — which is what they
        // are warned about before confirming, and may take them negative.
        reverse_transfer: true,
        // Left explicit rather than defaulted, because the default happens to
        // be right for a reason somebody has to be able to find:
        // REVERSAL_CLAUSE.serviceFee — the motko fee is not returned.
        refund_application_fee: false,
        metadata: { job_id: jobId },
      },
      {
        idempotencyKey: `refund:${jobId}:${alreadyRefundedPennies}:${refundAmountPennies}`,
      },
    );
  } catch (err) {
    // The customer's bank can reject a return; the card requires that reach
    // the trade rather than be swallowed.
    const message = err instanceof Error ? err.message : "Unknown error";
    return { success: false, error: `Stripe couldn't process the refund: ${message}` };
  }

  const { error: updateError } = await supabase
    .from("jobs")
    .update({
      settlement_state: newState,
      total_refunded_pennies: totalRefundedAfter,
    })
    .eq("id", jobId);

  if (updateError) {
    // The money HAS moved. Reporting failure here would invite a second
    // refund, so this reports success and leaves a loud trace: Stripe's own
    // refund list is the source of truth and already reflects it, so the
    // ceiling stays correct on the next call even with our cache stale.
    console.error(
      `[refund_state_write_failed] job=${jobId} refund=${refund.id} ` +
        `state=${newState} total_refunded_pennies=${totalRefundedAfter}: ${updateError.message}`,
    );
  }

  return { success: true, refundId: refund.id, newState };
}
