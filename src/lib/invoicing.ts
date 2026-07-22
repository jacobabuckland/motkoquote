import type { SupabaseClient } from "@supabase/supabase-js";
import { sendInvoiceEmail } from "@/lib/email";

type CreateInvoiceRecordInput = {
  quoteId: string;
  invoiceType: "deposit" | "final";
  amount: number;
  dueDate?: string;
  companyName: string;
  customerName: string;
  customerEmail?: string;
  // Whether the quote owner has finished their pay-by-bank payout setup. The
  // customer-facing pay page (/i/[id]) still gates on this itself, but we use it
  // to nudge the tradesperson to finish setup and to word the invoice email —
  // it never blocks raising or sending the invoice.
  payoutDetailsComplete?: boolean;
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
      due_date: input.dueDate || null,
      status: "sent",
    })
    .select("id")
    .single();

  if (error || !invoice) throw new Error(error?.message ?? "Failed to create invoice");

  const paymentUrl = invoicePaymentUrl(invoice.id);

  let delivered = false;
  if (input.customerEmail) {
    const result = await sendInvoiceEmail({
      to: input.customerEmail,
      customerName: input.customerName,
      companyName: input.companyName,
      amount: input.amount,
      invoiceType: input.invoiceType,
      paymentUrl,
    });
    delivered = result.delivered;
  }

  return {
    invoiceId: invoice.id,
    paymentUrl,
    delivered,
    payoutSetupRequired,
  };
};
