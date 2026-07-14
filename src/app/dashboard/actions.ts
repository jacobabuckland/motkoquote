"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createInvoiceRecord } from "@/lib/invoicing";
import { renderContractPdf } from "@/lib/pdf/render-contract";
import { sendContractEmail } from "@/lib/email";
import { contractJobInputSchema, contractTemplateKeySchema } from "@/lib/schemas/contract";
import type { BusinessProfile } from "@/lib/schemas/contract";
import type { LineItem } from "@/lib/schemas/job";
import { getContractTemplate } from "@/lib/contracts/templates";
import { renderContractTemplate } from "@/lib/contracts/render-template";
import { buildContractVariables } from "@/lib/contracts/build-variables";
import { trackEvent } from "@/lib/track";

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
  templateKey: contractTemplateKeySchema,
  jobInput: contractJobInputSchema,
});

type ContractQuoteWithRelations = {
  total: number;
  line_items_json: LineItem[];
  job: {
    customer: { name: string; contact: { email?: string } } | null;
    contractor: {
      company_name: string;
      company_number: string | null;
      trade: string | null;
      vat_registered: boolean;
      vat_number: string | null;
      business_profile: BusinessProfile;
    };
  };
};

export const createContract = async (input: z.infer<typeof createContractSchema>) => {
  const { quoteId, depositPct, templateKey, jobInput } = createContractSchema.parse(input);
  const supabase = await createClient();

  const { data: quote } = await supabase
    .from("quotes")
    .select(
      "total, line_items_json, job:jobs(customer:customers(name, contact), contractor:contractors(company_name, company_number, trade, vat_registered, vat_number, business_profile))",
    )
    .eq("id", quoteId)
    .single();

  if (!quote) throw new Error("Quote not found");

  const { job, total, line_items_json: lineItems } = quote as unknown as ContractQuoteWithRelations;

  const depositAmount = depositPct ? Math.round(total * (depositPct / 100) * 100) / 100 : null;
  const template = getContractTemplate(templateKey);
  const variables = buildContractVariables({
    contractor: job.contractor,
    customer: job.customer,
    lineItems,
    quoteReference: quoteId.slice(0, 8).toUpperCase(),
    depositAmount,
    jobInput,
  });
  const renderedBody = renderContractTemplate(template.body, variables);

  const { data: contract, error } = await supabase
    .from("contracts")
    .insert({
      quote_id: quoteId,
      deposit_pct: depositPct ?? null,
      template_key: templateKey,
      variables_json: variables,
      // Structured per-contract input, including the client/site address
      // components resolved from Google Places. The formatted strings still
      // render via variables_json; this keeps the structured data reusable.
      job_input_json: jobInput,
      rendered_body: renderedBody,
      status: "sent",
      sent_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error || !contract) throw new Error(error?.message ?? "Failed to create contract");

  await trackEvent("contract_sent", {
    contract_id: contract.id,
    quote_id: quoteId,
    deposit_pct: depositPct ?? null,
  });

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

  return {
    contractId: contract.id,
    contractUrl,
    delivered,
    hasCustomerEmail: Boolean(job.customer?.contact?.email),
  };
};
