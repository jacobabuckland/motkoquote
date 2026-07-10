"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createInvoicePaymentLink } from "@/lib/stripe";
import { sendInvoiceEmail } from "@/lib/email";

const createInvoiceSchema = z.object({
  quoteId: z.string().uuid(),
  invoiceType: z.enum(["deposit", "final"]),
  amount: z.number().positive(),
  dueDate: z.string().optional(),
});

type QuoteWithRelations = {
  job: {
    customer: { name: string; contact: { email?: string } } | null;
    contractor: { company_name: string };
  };
};

export const createInvoice = async (input: z.infer<typeof createInvoiceSchema>) => {
  const { quoteId, invoiceType, amount, dueDate } = createInvoiceSchema.parse(input);
  const supabase = await createClient();

  const { data: quote } = await supabase
    .from("quotes")
    .select("job:jobs(customer:customers(name, contact), contractor:contractors(company_name))")
    .eq("id", quoteId)
    .single();

  if (!quote) throw new Error("Quote not found");

  const { job } = quote as unknown as QuoteWithRelations;

  const { data: invoice, error } = await supabase
    .from("invoices")
    .insert({
      quote_id: quoteId,
      amount,
      invoice_type: invoiceType,
      due_date: dueDate || null,
      status: "sent",
    })
    .select("id")
    .single();

  if (error || !invoice) throw new Error(error?.message ?? "Failed to create invoice");

  const link = await createInvoicePaymentLink({
    companyName: job.contractor.company_name,
    description: invoiceType === "deposit" ? "Deposit invoice" : "Invoice",
    amount,
    invoiceId: invoice.id,
  });

  if (link) {
    await supabase
      .from("invoices")
      .update({ stripe_payment_link_id: link.id, stripe_payment_link_url: link.url })
      .eq("id", invoice.id);
  }

  let delivered = false;
  if (job.customer?.contact?.email) {
    const result = await sendInvoiceEmail({
      to: job.customer.contact.email,
      customerName: job.customer.name,
      companyName: job.contractor.company_name,
      amount,
      invoiceType,
      paymentUrl: link?.url ?? null,
    });
    delivered = result.delivered;
  }

  return { invoiceId: invoice.id, paymentUrl: link?.url ?? null, delivered };
};
