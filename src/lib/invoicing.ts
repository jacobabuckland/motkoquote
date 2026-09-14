import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyCustomer } from "@/lib/notify-customer";
import { invoiceVatFor } from "@/lib/vat-record";
import { defaultInvoiceDueDate } from "@/lib/invoice-due-date";
import { paymentTermDays } from "@/lib/payment-term-days";

type CreateInvoiceRecordInput = {
  quoteId: string;
  invoiceType: "deposit" | "final";
  amount: number;
  dueDate?: string;
  companyName: string;
  customerName: string;
  customerEmail?: string;
  // Added with the dispatcher: an invoice previously went to email only, so a
  // phone-only customer never received the thing asking them for money.
  customerPhone?: string;
  customerSmsOptOut?: boolean;
  // Whether the quote owner has finished their pay-by-bank payout setup. The
  // customer-facing pay page (/i/[id]) still gates on this itself, but we use it
  // to nudge the tradesperson to finish setup and to word the invoice email —
  // it never blocks raising or sending the invoice.
  payoutDetailsComplete?: boolean;
  // For staged jobs: the payment_stage ID to link this invoice to
  paymentStageId?: string;
};

// The public pay-by-bank page for an invoice. The payment itself is minted at
// button-press via /api/truelayer/create-payment, so the link is just the
// invoice's own page — stable and known the moment the invoice exists.
const invoicePaymentUrl = (invoiceId: string): string =>
  `${process.env.NEXT_PUBLIC_APP_URL}/i/${invoiceId}`;

// Shared by the contractor-facing "create invoice" dashboard action and the
// automatic deposit invoice raised when a customer signs a contract — both
// need identical payment-link creation and email delivery. Takes whichever
// Supabase client the caller already has (user-scoped from the dashboard,
// admin from the public signing flow) so RLS is respected where it applies.
export const createInvoiceRecord = async (
  supabase: SupabaseClient,
  input: CreateInvoiceRecordInput,
): Promise<{
  invoiceId: string;
  paymentUrl: string;
  delivered: boolean;
  // True when the invoice is payable but the owner hasn't finished payout
  // setup, so customers can't yet pay online. The dashboard uses this to nudge
  // the tradesperson to finish onboarding — it never blocks sending.
  payoutSetupRequired: boolean;
}> => {
  const payoutSetupRequired = !input.payoutDetailsComplete;

  // The quote this invoice is a part of, for its recorded VAT split and for
  // the trade's own payment terms.
  const { data: quoteRow } = await supabase
    .from("quotes")
    .select("total, vat_amount, vat_rate, job:jobs(contractor:contractors(business_profile))")
    .eq("id", input.quoteId)
    .maybeSingle();

  // Null where the trade has not chosen terms, or typed prose this refuses to
  // read a number out of — defaultInvoiceDueDate then keeps its own default.
  const contractorTermDays = paymentTermDays(
    (
      quoteRow as {
        job?: { contractor?: { business_profile?: { default_payment_terms?: string | null } | null } | null } | null;
      } | null
    )?.job?.contractor?.business_profile?.default_payment_terms,
  );

  const vat = quoteRow
    ? invoiceVatFor(input.amount, quoteRow as { total: number; vat_amount: number | null; vat_rate: number | null })
    : null;

  // Idempotency guard: a double-tap (or a contract signed twice) must not
  // raise two identical invoices or email the customer twice. If an invoice
  // for this exact quote/type/amount was already created, reuse it and skip
  // the side effects entirely.
  const { data: existing } = await supabase
    .from("invoices")
    .select("id")
    .eq("quote_id", input.quoteId)
    .eq("invoice_type", input.invoiceType)
    .eq("amount", input.amount)
    .limit(1)
    .maybeSingle();

  if (existing) {
    return {
      invoiceId: existing.id,
      paymentUrl: invoicePaymentUrl(existing.id),
      delivered: false,
      payoutSetupRequired,
    };
  }

  const { data: invoice, error } = await supabase
    .from("invoices")
    .insert({
      quote_id: input.quoteId,
      amount: input.amount,
      invoice_type: input.invoiceType,
      // Never null. A blank due date leaves the customer with no stated
      // terms and the contractor with nothing to chase against — isInvoiceOverdue
      // cannot fire without one. Defaulted here rather than in the form so the
      // automatic deposit invoice raised on contract signature gets terms too.
      //
      // AND THE TERMS ARE THE TRADE'S OWN. This called defaultInvoiceDueDate()
      // with no arguments, so every invoice was due in 14 days while /setup and
      // the contract clause both said whatever the trade had chosen. Reported
      // 14 Sep on a trade set to 7 days: their contract promised 7 and their
      // invoice asked for 14. paymentTermDays reads only the exact options
      // /setup offers and returns null for anything else, so legacy free prose
      // still falls back to 14 rather than being guessed at.
      due_date: input.dueDate || defaultInvoiceDueDate(new Date(), contractorTermDays ?? undefined),
      // THE VAT INSIDE THIS AMOUNT, recorded now rather than inferred later.
      //
      // `amount` is what the customer is asked to pay. Until migration 80 there
      // was nothing beside it, so the P&L reported gross figures under a label
      // reading "(net)" and the money card applied the trade's CURRENT
      // registration to every payment ever taken. A charged figure is a
      // historical fact; it must not move when a setting does.
      //
      // Taken as the same SHARE of the quote's VAT that this invoice is of the
      // quote's total, rather than re-derived from the amount and a rate. A
      // deposit is a part of a quote, and the two documents have to agree to
      // the penny. Null quote VAT — a quote written before migration 80 — gives
      // null here: unknown, which is the truth, and never zero.
      ...(vat ?? {}),
      status: "sent",
    })
    .select("id")
    .single();

  if (error || !invoice) throw new Error(error?.message ?? "Failed to create invoice");

  // For staged jobs: link the payment stage to this invoice
  if (input.paymentStageId) {
    const { error: stageError } = await supabase
      .from("payment_stages")
      .update({ invoice_id: invoice.id })
      .eq("id", input.paymentStageId);

    if (stageError) {
      console.error("Failed to link invoice to payment stage:", stageError);
      // Non-fatal: the invoice was created successfully, just the stage link failed
    }
  }

  const paymentUrl = invoicePaymentUrl(invoice.id);

  const report = await notifyCustomer({
    event: "invoice_sent",
    customer: {
      name: input.customerName,
      email: input.customerEmail,
      phone: input.customerPhone,
      smsOptOut: input.customerSmsOptOut === true,
    },
    companyName: input.companyName,
    url: paymentUrl,
    amount: input.amount,
    invoiceType: input.invoiceType,
  });
  const delivered = report.delivered;

  return {
    invoiceId: invoice.id,
    paymentUrl,
    delivered,
    payoutSetupRequired,
  };
};
