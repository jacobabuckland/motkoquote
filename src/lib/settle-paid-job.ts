import type { SupabaseClient } from "@supabase/supabase-js";
import { planPaidJobSettlement, type PendingReferral } from "@/lib/paid-job-settlement";
import { notifyContractorOfCustomerAction } from "@/lib/notify-contractor";
import { formatGBP } from "@/lib/format";

// Applies a paid-by-bank payment to our records, service-role only (runs from
// the signature-verified TrueLayer webhook, no user session). Two layers of
// idempotency:
//   • per-invoice — the `.neq("status","paid")` flip updates zero rows on a
//     redelivered event for the same invoice, so we return early.
//   • per-job — fee/credit/referral effects fire only on the job's FIRST
//     payment, guarded by an atomic `jobs.paid_at IS NULL` update. A staged job
//     (deposit then final) therefore accrues exactly one fee, banded on the
//     job's total, while each invoice still flips to paid individually.

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
  // The TrueLayer payment id, stored for audit/reconcile.
  paymentProviderRef: string;
};

export const settlePaidJob = async (
  admin: SupabaseClient,
  input: SettlePaidJobInput,
): Promise<void> => {
  const now = new Date().toISOString();

  // Flip THIS invoice to paid. Zero rows => already processed (redelivery).
  const { data } = await admin
    .from("invoices")
    .update({
      status: "paid",
      paid_at: now,
      truelayer_payment_id: input.paymentProviderRef,
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
    .update({ paid_at: now, payment_provider_ref: input.paymentProviderRef })
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
        fee_waived_reason: plan.fee.feeWaivedReason,
        fee_status: plan.fee.feeStatus,
      })
      .eq("id", job.id);

    // Write the append-only ledger and reconcile each affected trade's cached
    // free_jobs_remaining. The ledger is source of truth; the cache is nightly
    // reconciled, so a rare read-modify-write race is self-healing.
    for (const entry of plan.ledger) {
      await admin.from("credit_events").insert({
        contractor_id: entry.contractorId,
        delta: entry.delta,
        reason: entry.reason,
        related_job_id: entry.relatedJobId,
        related_referral_id: entry.relatedReferralId,
      });
      const { data: cache } = await admin
        .from("contractors")
        .select("free_jobs_remaining")
        .eq("id", entry.contractorId)
        .single();
      await admin
        .from("contractors")
        .update({ free_jobs_remaining: (cache?.free_jobs_remaining ?? 0) + entry.delta })
        .eq("id", entry.contractorId);
    }

    if (plan.referralActivation) {
      await admin
        .from("referrals")
        .update({ status: "activated", referee_first_paid_job_id: job.id })
        .eq("id", plan.referralActivation.referralId)
        .eq("status", "pending");
    }
  }

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
