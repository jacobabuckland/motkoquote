"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createInvoiceRecord } from "@/lib/invoicing";
import { renderContractPdf } from "@/lib/pdf/render-contract";
import { sendContractEmail } from "@/lib/email";

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

  return createInvoiceRecord(supabase, {
    quoteId,
    invoiceType,
    amount,
    dueDate,
    companyName: job.contractor.company_name,
    customerName: job.customer?.name ?? "Customer",
    customerEmail: job.customer?.contact?.email,
  });
};

const createContractSchema = z.object({
  quoteId: z.string().uuid(),
  depositPct: z.number().min(0).max(100).optional(),
  termsText: z.string().min(1),
});

export const createContract = async (input: z.infer<typeof createContractSchema>) => {
  const { quoteId, depositPct, termsText } = createContractSchema.parse(input);
  const supabase = await createClient();

  const { data: quote } = await supabase
    .from("quotes")
    .select("job:jobs(customer:customers(name, contact), contractor:contractors(company_name))")
    .eq("id", quoteId)
    .single();

  if (!quote) throw new Error("Quote not found");

  const { job } = quote as unknown as QuoteWithRelations;

  const { data: contract, error } = await supabase
    .from("contracts")
    .insert({
      quote_id: quoteId,
      deposit_pct: depositPct ?? null,
      terms_text: termsText,
      status: "sent",
      sent_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error || !contract) throw new Error(error?.message ?? "Failed to create contract");

  const contractUrl = `${process.env.NEXT_PUBLIC_APP_URL}/c/${contract.id}`;

  // Best-effort — a PDF-render failure shouldn't block sending the contract.
  const pdfBuffer = await renderContractPdf(contract.id).catch(() => null);

  let delivered = false;
  if (job.customer?.contact?.email) {
    const result = await sendContractEmail({
      to: job.customer.contact.email,
      customerName: job.customer.name,
      companyName: job.contractor.company_name,
      contractUrl,
      pdfAttachment: pdfBuffer
        ? { filename: `contract-${contract.id}.pdf`, content: pdfBuffer }
        : undefined,
    });
    delivered = result.delivered;
  }

  return { contractId: contract.id, contractUrl, delivered };
};
