import type { SupabaseClient } from "@supabase/supabase-js";
import { createInvoicePaymentLink } from "@/lib/stripe";
import { sendInvoiceEmail } from "@/lib/email";

type CreateInvoiceRecordInput = {
  quoteId: string;
  invoiceType: "deposit" | "final";
  amount: number;
  dueDate?: string;
  companyName: string;
  customerName: string;
  customerEmail?: string;
  // The quote owner's Stripe Connect account and whether it can accept charges.
  // Payments are destination charges to this account, so we only create an
  // online payment link when the owner has finished payout onboarding
  // (chargesEnabled). Otherwise the invoice is raised without a pay link and
  // the email falls back to "they'll be in touch with a way to pay".
  connectedAccountId?: string | null;
  chargesEnabled?: boolean;
};

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
  paymentUrl: string | null;
  delivered: boolean;
  // True when the invoice is payable but the owner hasn't finished payout
  // setup, so no online payment link could be created. The dashboard uses this
  // to nudge the tradesperson to finish onboarding — it never blocks sending.
  payoutSetupRequired: boolean;
}> => {
  // Idempotency guard: a double-tap (or a contract signed twice) must not
  // raise two identical invoices, mint two Stripe payment links, or email
  // the customer twice. If an invoice for this exact quote/type/amount was
  // already created, reuse it and skip the external side effects entirely.
  const { data: existing } = await supabase
    .from("invoices")
    .select("id, stripe_payment_link_url")
    .eq("quote_id", input.quoteId)
    .eq("invoice_type", input.invoiceType)
    .eq("amount", input.amount)
    .limit(1)
    .maybeSingle();

  const canCharge = Boolean(input.chargesEnabled && input.connectedAccountId);

  if (existing) {
    return {
      invoiceId: existing.id,
      paymentUrl: existing.stripe_payment_link_url ?? null,
      delivered: false,
      // A pre-existing invoice with no pay link, on an owner who still can't
      // charge, means setup is still outstanding.
      payoutSetupRequired: !canCharge && !existing.stripe_payment_link_url,
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

  // Only mint an online payment link when the owner can actually accept
  // charges (payout onboarding complete). Without it, the invoice is still
  // raised and emailed — just without a "Pay now" link.
  const link = canCharge
    ? await createInvoicePaymentLink({
        companyName: input.companyName,
        description: input.invoiceType === "deposit" ? "Deposit invoice" : "Invoice",
        amount: input.amount,
        invoiceId: invoice.id,
        connectedAccountId: input.connectedAccountId!,
        // Stable across retries for the same quote/type/amount so Stripe never
        // creates duplicate objects even if two requests race past the check.
        idempotencyKey: `inv_${input.quoteId}_${input.invoiceType}_${Math.round(input.amount * 100)}`,
      })
    : null;

  if (link) {
    await supabase
      .from("invoices")
      .update({ stripe_payment_link_id: link.id, stripe_payment_link_url: link.url })
      .eq("id", invoice.id);
  }

  let delivered = false;
  if (input.customerEmail) {
    const result = await sendInvoiceEmail({
      to: input.customerEmail,
      customerName: input.customerName,
      companyName: input.companyName,
      amount: input.amount,
      invoiceType: input.invoiceType,
      paymentUrl: link?.url ?? null,
    });
    delivered = result.delivered;
  }

  return {
    invoiceId: invoice.id,
    paymentUrl: link?.url ?? null,
    delivered,
    payoutSetupRequired: !canCharge,
  };
};
