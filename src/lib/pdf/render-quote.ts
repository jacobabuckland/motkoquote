import { renderToBuffer } from "@react-pdf/renderer";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildQuotePdfDocument, type QuotePdfPayload } from "@/lib/pdf/quote-payload";
import type { LineItem } from "@/lib/schemas/job";

export type { QuotePdfPayload } from "@/lib/pdf/quote-payload";
export { buildQuotePdfDocument } from "@/lib/pdf/quote-payload";

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

// Server-side render from plain data. Pure with respect to our database: it
// reads nothing and writes nothing, which is what lets the identical document
// definition also render in a guest's browser (see @/lib/guest/pdf).
export const renderQuotePdfFromPayload = async (
  payload: QuotePdfPayload,
): Promise<Buffer> =>
  renderToBuffer(
    buildQuotePdfDocument(payload) as Parameters<typeof renderToBuffer>[0],
  );

// Maps a stored quote row onto the payload above. Separate from the row load so
// the mapping is testable without a database.
export const quoteRowToPdfPayload = (
  quoteId: string,
  quote: QuoteWithRelations,
): QuotePdfPayload => {
  const { created_at: createdAt, line_items_json: lineItems, job } = quote;

  return {
    reference: quoteId.slice(0, 8).toUpperCase(),
    createdAt,
    lineItems,
    jobType: job.extracted_json?.job_type,
    contractor: {
      companyName: job.contractor.company_name,
      companyNumber: job.contractor.company_number,
      trade: job.contractor.trade,
      vatRegistered: job.contractor.vat_registered,
      vatNumber: job.contractor.vat_number,
      brandColor: job.contractor.branding?.brand_color,
      logoUrl: job.contractor.branding?.logo_url,
      footerTerms: job.contractor.branding?.footer_terms,
    },
    customer: job.customer
      ? {
          name: job.customer.name,
          email: job.customer.contact?.email,
          phone: job.customer.contact?.phone,
          address: job.customer.contact?.address,
        }
      : null,
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

  return renderQuotePdfFromPayload(
    quoteRowToPdfPayload(quoteId, quote as unknown as QuoteWithRelations),
  );
};
