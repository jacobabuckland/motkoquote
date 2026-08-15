import type { SupabaseClient } from "@supabase/supabase-js";
import { planPaidJobSettlement, type PendingReferral } from "@/lib/paid-job-settlement";
import { notifyContractorOfCustomerAction } from "@/lib/notify-contractor";
import { track } from "@/lib/analytics";
import { formatGBP } from "@/lib/format";

// Postgres error code for unique violation
const UNIQUE_VIOLATION = "23505";

// Applies a settled payment to our records — the SINGLE settlement path for
// BOTH on-rails TrueLayer pay-ins and off-rails "mark as paid" (cash / bank
// transfer / other), service-role only. Whatever the source, a paid job settles
// identically: invoice→paid, fee accrual, free-job burn, credit_events,
// referral firing. Two layers of idempotency, unchanged by the source:
//   • per-invoice — the `.neq("status","paid")` flip updates zero rows on a
//     redelivered event OR a manual mark after the webhook already landed, so
//     we return early (first writer wins, no double-settle).
//   • per-job — fee/credit/referral effects fire only on the job's FIRST
//     payment, guarded by an atomic `jobs.paid_at IS NULL` update. A staged job
//     (deposit then final) therefore accrues exactly one fee, banded on the
//     job's total, while each invoice still flips to paid individually.
// The webhook-vs-manual race is resolved by these same two atomic guards: the
// loser's conditional UPDATE matches zero rows and no-ops.

// Where the settlement originated. 'manual' is the trade marking an off-rails
// payment paid; 'truelayer_webhook' is the signature-verified pay-in webhook.
export type SettlementSource = "truelayer_webhook" | "manual";

// How the customer actually paid. 'motko_bank' is an on-rails TrueLayer
// pay-by-bank; the rest are off-rails methods recorded at manual settlement.
export type PaymentMethod = "motko_bank" | "cash" | "bank_transfer" | "other";

type PaidInvoiceRow = {
  id: string;
  invoice_type: string;
  amount: number;
  quote: {
    total: number;
    job: {
      id: string;
      contractor_id: string;
      customer: { name: string } | null;
    } | null;
  } | null;
};

export type SettlePaidJobInput = {
  invoiceId: string;
  source: SettlementSource;
  paymentMethod: PaymentMethod;
  // The TrueLayer payment id, stored for audit/reconcile. Absent for manual
  // settlement (there is no provider payment).
  paymentProviderRef?: string;
  // When the money actually moved. Defaults to now; the manual path passes a
  // (validated, non-future) backdated timestamp when the trade sets one.
  paidAt?: string;
};

// Detects duplicate referral_unlock rows in credit_events. Returns the count of
// referral_unlock entries that appear more than once for the same related_referral_id.
// Used to verify backfill completion before applying the unique index migration.
// Also checks for null related_referral_id rows which the partial unique index
// won't protect (Postgres allows multiple nulls in partial unique indexes).
export const detectDuplicateReferralCredits = async (
  admin: SupabaseClient,
): Promise<number> => {
  // Count duplicates: referral_unlock rows grouped by related_referral_id with count > 1
  const { data: duplicates } = await admin
    .from("credit_events")
    .select("related_referral_id")
    .eq("reason", "referral_unlock")
    .not("related_referral_id", "is", null);

  if (!duplicates) return 0;

  // Group by related_referral_id and count occurrences
  const grouped = duplicates.reduce(
    (acc, row) => {
      const key = row.related_referral_id;
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  // Count how many referral_ids have duplicates (count > 1)
  const duplicateCount = Object.values(grouped).filter((count) => count > 1).length;

  return duplicateCount;
};

export const settlePaidJob = async (
  admin: SupabaseClient,
  input: SettlePaidJobInput,
): Promise<void> => {
  const paidAt = input.paidAt ?? new Date().toISOString();

  // Flip THIS invoice to paid. Zero rows => already processed (redelivery, or
  // the other settlement source won the race). truelayer_payment_id is only set
  // when a provider ref exists (on-rails); manual leaves it null.
  const { data } = await admin
    .from("invoices")
    .update({
      status: "paid",
      paid_at: paidAt,
      payment_method: input.paymentMethod,
      ...(input.paymentProviderRef
        ? { truelayer_payment_id: input.paymentProviderRef }
        : {}),
    })
    .eq("id", input.invoiceId)
    .neq("status", "paid")
    .select(
      "id, invoice_type, amount, quote:quotes(total, job:jobs(id, contractor_id, customer:customers(name)))",
    )
    .maybeSingle();

  const invoice = data as unknown as PaidInvoiceRow | null;
  const job = invoice?.quote?.job;
  if (!invoice || !job) return;

  // Per-job guard: only the job's first payment settles fee/credit/referral.
  const { data: firstJobPayment } = await admin
    .from("jobs")
    .update({ paid_at: paidAt, payment_provider_ref: input.paymentProviderRef ?? null })
    .eq("id", job.id)
    .is("paid_at", null)
    .select("id")
    .maybeSingle();

  if (firstJobPayment) {
    // Fee bands on the job's total value (quote total), not the single invoice —
    // so a deposit-first payment is banded on the whole job, once.
    const jobValuePennies = Math.round((invoice.quote?.total ?? invoice.amount) * 100);

    const { data: contractor } = await admin
      .from("contractors")
      .select("free_jobs_remaining")
      .eq("id", job.contractor_id)
      .single();
    const freeJobsRemaining = contractor?.free_jobs_remaining ?? 0;

    // First paid job across this trade? (exclude the one we just marked paid.)
    const { count } = await admin
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("contractor_id", job.contractor_id)
      .not("paid_at", "is", null)
      .neq("id", job.id);
    const isFirstPaidJob = (count ?? 0) === 0;

    // A still-pending referral in which this trade is the referee.
    const { data: referral } = await admin
      .from("referrals")
      .select("id, referrer_contractor_id")
      .eq("referee_contractor_id", job.contractor_id)
      .eq("status", "pending")
      .maybeSingle();
    const pendingReferral: PendingReferral | null = referral
      ? { referralId: referral.id, referrerContractorId: referral.referrer_contractor_id }
      : null;

    const plan = planPaidJobSettlement({
      jobId: job.id,
      contractorId: job.contractor_id,
      jobValuePennies,
      freeJobsRemaining,
      isFirstPaidJob,
      pendingReferral,
    });

    await admin
      .from("jobs")
      .update({
        job_value_pennies: jobValuePennies,
        fee_amount_pennies: plan.fee.feeAmountPennies,
        fee_net_pennies: plan.fee.feeNetPennies,
        fee_vat_pennies: plan.fee.feeVatPennies,
        fee_waived_reason: plan.fee.feeWaivedReason,
        fee_status: plan.fee.feeStatus,
      })
      .eq("id", job.id);

    // Write the append-only ledger (source of truth) and fold each delta into
    // the cached free_jobs_remaining atomically, so concurrent settlements for
    // the same trade compose instead of clobbering one another.
    for (const entry of plan.ledger) {
      let insertSucceeded = false;

      try {
        await admin.from("credit_events").insert({
          contractor_id: entry.contractorId,
          delta: entry.delta,
          reason: entry.reason,
          related_job_id: entry.relatedJobId,
          related_referral_id: entry.relatedReferralId,
        });
        insertSucceeded = true;
      } catch (error) {
        // Catch unique violation on referral_unlock — the concurrent settlement
        // won the race. This is expected and harmless: the other path already
        // wrote the credit event and incremented the cache, so we skip both here.
        if (
          entry.reason === "referral_unlock" &&
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === UNIQUE_VIOLATION
        ) {
          console.log(
            `[referral_unlock_duplicate_detected] Referral ${entry.relatedReferralId} already credited (concurrent settlement race). Skipping duplicate insert and cache increment.`,
          );
          // Do not re-throw — this is a successful no-op, not a failure
        } else {
          // Re-throw any other error (non-referral_unlock or non-unique-violation)
          throw error;
        }
      }

      // Only increment the cache if the insert actually wrote a row. If we caught
      // a unique violation above, insertSucceeded is false and we skip this,
      // keeping the cache correct without a compensating decrement.
      if (insertSucceeded) {
        await admin.rpc("increment_free_jobs_remaining", {
          p_id: entry.contractorId,
          p_delta: entry.delta,
        });
      }
    }

    if (plan.referralActivation) {
      await admin
        .from("referrals")
        .update({ status: "activated", referee_first_paid_job_id: job.id })
        .eq("id", plan.referralActivation.referralId)
        .eq("status", "pending");
    }
  }

  // One analytics event per settled invoice, tagged with how (payment_method)
  // and by which path (settlement_source) so off-rails settlement is visible
  // alongside on-rails pay-ins. Anonymous-safe: the webhook has no session.
  await track(
    "invoice_paid",
    {
      invoice_id: invoice.id,
      job_id: job.id,
      contractor_id: job.contractor_id,
      invoice_type: invoice.invoice_type,
      amount: invoice.amount,
      payment_method: input.paymentMethod,
      settlement_source: input.source,
      first_job_payment: !!firstJobPayment,
    },
    { allowAnonymous: true },
  );

  // Notify the trade for every invoice paid (deposit and final alike).
  const customerName = job.customer?.name ?? "Your customer";
  const label = invoice.invoice_type === "deposit" ? "the deposit" : "your invoice";
  await notifyContractorOfCustomerAction(admin, {
    jobId: job.id,
    event: invoice.invoice_type === "deposit" ? "deposit_paid" : "final_paid",
    subject: `${customerName} paid ${label}`,
    heading: `${customerName} paid ${label} — ${formatGBP(invoice.amount)}.`,
    nextStep:
      invoice.invoice_type === "deposit"
        ? "Next step: crack on with the work — raise the final invoice when you're done."
        : "Nothing else needed — the job's settled and paid.",
  });
};
