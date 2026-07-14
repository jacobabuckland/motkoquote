import type { SupabaseClient } from "@supabase/supabase-js";
import { createInvoicePaymentLink } from "@/lib/stripe";
import { sendInvoiceEmail } from "@/lib/email";
import { trackEvent } from "@/lib/track";

type CreateInvoiceRecordInput = {
  quoteId: string;
  invoiceType: "deposit" | "final";
  amount: number;
  dueDate?: string;
  companyName: string;
  customerName: string;
  customerEmail?: string;
};

// Shared by the contractor-facing "create invoice" dashboard action and the
// automatic deposit invoice raised when a customer signs a contract — both
// need identical payment-link creation and email delivery. Takes whichever
// Supabase client the caller already has (user-scoped from the dashboard,
// admin from the public signing flow) so RLS is respected where it applies.
export const createInvoiceRecord = async (
  supabase: SupabaseClient,
  input: CreateInvoiceRecordInput,
): Promise<{ invoiceId: string; paymentUrl: string | null; delivered: boolean }> => {
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

  const link = await createInvoicePaymentLink({
    companyName: input.companyName,
    description: input.invoiceType === "deposit" ? "Deposit invoice" : "Invoice",
    amount: input.amount,
    invoiceId: invoice.id,
  });

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

  await trackEvent("invoice_sent", {
    invoice_id: invoice.id,
    quote_id: input.quoteId,
    invoice_type: input.invoiceType,
    amount: input.amount,
    delivered,
  });

  return { invoiceId: invoice.id, paymentUrl: link?.url ?? null, delivered };
};
