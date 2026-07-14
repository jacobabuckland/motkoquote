import { createElement } from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { createAdminClient } from "@/lib/supabase/admin";
import { computeQuoteTotals } from "@/lib/quote-math";
import { QuotePdf } from "@/lib/pdf/quote-pdf";
import type { LineItem } from "@/lib/schemas/job";

type QuoteWithRelations = {
  created_at: string;
  line_items_json: LineItem[];
  job: {
    extracted_json: { job_type?: string } | null;
    customer: { name: string; contact: { email?: string; phone?: string; address?: string } | null } | null;
    contractor: {
      company_name: string;
      company_number: string | null;
      trade: string | null;
      vat_registered: boolean;
      vat_number: string | null;
      branding: { brand_color?: string; logo_url?: string; footer_terms?: string } | null;
    };
  };
};

// Shared by the public quote-PDF route and the send-quote email action, so
// both always produce an identical document from a single source of truth.
export const renderQuotePdf = async (quoteId: string): Promise<Buffer | null> => {
  const admin = createAdminClient();

  const { data: quote } = await admin
    .from("quotes")
    .select(
      "created_at, line_items_json, job:jobs(extracted_json, customer:customers(name, contact), contractor:contractors(company_name, company_number, trade, vat_registered, vat_number, branding))",
    )
    .eq("id", quoteId)
    .maybeSingle();

  if (!quote) return null;

  const { created_at: createdAt, line_items_json: lineItems, job } =
    quote as unknown as QuoteWithRelations;
  const totals = computeQuoteTotals(lineItems, job.contractor.vat_registered);

  return renderToBuffer(
    createElement(QuotePdf, {
      companyName: job.contractor.company_name,
      trade: job.contractor.trade,
      companyNumber: job.contractor.company_number,
      vatNumber: job.contractor.vat_number,
      brandColor: job.contractor.branding?.brand_color,
      logoUrl: job.contractor.branding?.logo_url,
      footerTerms: job.contractor.branding?.footer_terms,
      reference: quoteId.slice(0, 8).toUpperCase(),
      date: new Date(createdAt).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      }),
      jobType: job.extracted_json?.job_type,
      customerName: job.customer?.name ?? "Customer",
      customerEmail: job.customer?.contact?.email,
      customerPhone: job.customer?.contact?.phone,
      siteAddress: job.customer?.contact?.address,
      lineItems,
      subtotal: totals.subtotal,
      vat: totals.vat,
      total: totals.total,
      vatRegistered: job.contractor.vat_registered,
    }) as Parameters<typeof renderToBuffer>[0],
  );
};
