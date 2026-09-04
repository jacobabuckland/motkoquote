"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createInvoiceRecord } from "@/lib/invoicing";
import { deriveInvoiceAmount } from "@/lib/invoice-amount";
import { renderContractPdf } from "@/lib/pdf/render-contract";
import { notifyCustomer } from "@/lib/notify-customer";
import { contractJobInputSchema, contractTemplateKeySchema } from "@/lib/schemas/contract";
import type { BusinessProfile } from "@/lib/schemas/contract";
import type { LineItem } from "@/lib/schemas/job";
import { getContractTemplate } from "@/lib/contracts/templates";
import { renderContractTemplate } from "@/lib/contracts/render-template";
import { buildContractVariables } from "@/lib/contracts/build-variables";
import { actionableError } from "@/lib/actionable-error";

// The client sends its intent only — never a figure. `amount` is derived
// server-side from the quote total, the contract's deposit percentage, and the
// invoices already raised (see deriveInvoiceAmount). A prefilled amount in the
// form is display-only and is intentionally not accepted here.
const createInvoiceSchema = z.object({
  quoteId: z.string().uuid(),
  invoiceType: z.enum(["deposit", "final"]),
  dueDate: z.string().optional(),
});

type QuoteWithRelations = {
  total: number;
  invoices: { amount: number; invoice_type: string }[];
  contracts: { deposit_pct: number | null; status: string }[];
  job: {
    work_completed_at: string | null;
    customer: {
      name: string;
      contact: { email?: string; phone?: string; sms_opt_out?: boolean };
    } | null;
    contractor: {
      company_name: string;
      payout_details_complete: boolean;
    };
  };
};

export const createInvoice = async (input: z.infer<typeof createInvoiceSchema>) => {
  const { quoteId, invoiceType, dueDate } = createInvoiceSchema.parse(input);
  const supabase = await createClient();

  const { data: quote } = await supabase
    .from("quotes")
    .select(
      "total, invoices(amount, invoice_type), contracts(deposit_pct, status), job:jobs(work_completed_at, customer:customers(name, contact), contractor:contractors(company_name, payout_details_complete))",
    )
    .eq("id", quoteId)
    .single();

  if (!quote) throw new Error("Quote not found");

  const { job, total, invoices, contracts } = quote as unknown as QuoteWithRelations;

  // Authoritative amount — refuses a final invoice before the work is marked
  // complete, a second deposit, over-invoicing, or an arbitrary client figure.
  //
  // `work_completed_at` is read here rather than trusted from the request: the
  // client sends intent, never state. A stale dashboard whose Final button was
  // rendered before the job moved is refused on the same path as a tampered one.
  const amount = deriveInvoiceAmount(invoiceType, total, invoices ?? [], contracts ?? [], {
    workCompletedAt: job.work_completed_at,
  });

  const result = await createInvoiceRecord(supabase, {
    quoteId,
    invoiceType,
    amount,
    dueDate,
    companyName: job.contractor.company_name,
    customerName: job.customer?.name ?? "Customer",
    customerEmail: job.customer?.contact?.email,
    customerPhone: job.customer?.contact?.phone,
    customerSmsOptOut: job.customer?.contact?.sms_opt_out === true,
    payoutDetailsComplete: job.contractor.payout_details_complete,
  });

  // Refresh the server data the client navigates into, so the caller only
  // needs router.push (not a racing router.refresh) once this resolves.
  revalidatePath("/dashboard");
  revalidatePath("/jobs/[id]", "page");

  return result;
};

const archiveQuoteSchema = z.object({ quoteId: z.string().uuid() });

// Soft-archive rather than hard-delete: quotes cascade-delete their invoices
// and contracts, so a stray tap would silently destroy financial records.
// Archiving just flips status out of every dashboard pipeline query.
export const archiveQuote = async (input: z.infer<typeof archiveQuoteSchema>) => {
  const { quoteId } = archiveQuoteSchema.parse(input);
  const supabase = await createClient();

  const { error } = await supabase
    .from("quotes")
    .update({ status: "archived" })
    .eq("id", quoteId);

  if (error) throw new Error(error.message);

  revalidatePath("/dashboard");
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
    work_completed_at: string | null;
    customer: {
      name: string;
      contact: { email?: string; phone?: string; sms_opt_out?: boolean };
    } | null;
    contractor: {
      company_name: string;
      company_number: string | null;
      trade: string | null;
      vat_registered: boolean;
      vat_number: string | null;
      business_profile: BusinessProfile;
      payout_account_holder_name: string | null;
      payout_sort_code: string | null;
      payout_account_number: string | null;
      stripe_account_id: string | null;
      stripe_payouts_enabled: boolean;
      payout_details_complete: boolean;
    };
  };
};

export const createContract = async (input: z.infer<typeof createContractSchema>) => {
  const { quoteId, depositPct, templateKey, jobInput } = createContractSchema.parse(input);
  const supabase = await createClient();

  const { data: quote } = await supabase
    .from("quotes")
    .select(
      "total, line_items_json, job:jobs(customer:customers(name, contact), contractor:contractors(company_name, company_number, trade, vat_registered, vat_number, business_profile, payout_account_holder_name, payout_sort_code, payout_account_number, payout_details_complete, stripe_account_id, stripe_payouts_enabled))",
    )
    .eq("id", quoteId)
    .single();

  if (!quote) throw actionableError("Quote not found");

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

  if (error || !contract) {
    // Duplicate key error: a contract already exists for this quote
    if (error?.code === "23505") {
      const { data: existingContract } = await supabase
        .from("contracts")
        .select("id")
        .eq("quote_id", quoteId)
        .maybeSingle();

      const message = existingContract
        ? `A contract has already been sent for this quote. You can share it again using this link: ${process.env.NEXT_PUBLIC_APP_URL}/c/${existingContract.id}`
        : `A contract has already been sent for this quote, but we couldn't retrieve it. Please check your contracts or contact support.`;

      throw actionableError(message);
    }

    throw actionableError("Couldn't create the contract. Please try again.");
  }

  const contractUrl = `${process.env.NEXT_PUBLIC_APP_URL}/c/${contract.id}`;

  // Best-effort — a PDF-render failure shouldn't block sending the contract.
  const pdfBuffer = await renderContractPdf(contract.id).catch(() => null);

  // Through the dispatcher, so this step honours sms_opt_out and reaches a
  // phone-only customer. It previously sent email and nothing else, which left
  // the contract needing a signature going to an address such a customer does
  // not have.
  //
  // Guarded — a delivery failure shouldn't prevent the contract from being
  // created. The action completes with delivered: false, allowing the job page
  // to display the delivered=0 banner with a copy-link fallback.
  const customerEmail = job.customer?.contact?.email;
  const customerPhone = job.customer?.contact?.phone;
  const customerSmsOptOut = job.customer?.contact?.sms_opt_out === true;

  const report = await notifyCustomer({
    event: "contract_sent",
    customer: {
      name: job.customer?.name ?? "there",
      email: customerEmail,
      phone: customerPhone,
      smsOptOut: customerSmsOptOut,
    },
    companyName: job.contractor.company_name,
    url: contractUrl,
    pdfAttachment: pdfBuffer
      ? { filename: `contract-${contract.id}.pdf`, content: pdfBuffer }
      : undefined,
  }).catch(() => ({
    delivered: false,
    email: { attempted: Boolean(customerEmail), delivered: false },
    sms: { attempted: Boolean(customerPhone) && !customerSmsOptOut, delivered: false },
  }));

  const delivered = report.delivered;

  revalidatePath("/dashboard");
  revalidatePath("/jobs/[id]", "page");

  return {
    contractId: contract.id,
    contractUrl,
    delivered,
    // Renamed from hasCustomerEmail: with SMS in play, "no email on file" is
    // the wrong thing to tell a contractor whose phone-only customer we just
    // failed to text. This says whether there was ANY channel to try.
    hadContactChannel: report.email.attempted || report.sms.attempted,
  };
};
