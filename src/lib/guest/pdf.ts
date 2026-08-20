import type { GuestQuote } from "@/lib/guest/quote";
import type { QuotePdfPayload } from "@/lib/pdf/quote-payload";

// A guest has no business identity: no trading name, company number, VAT
// number, trade, logo or footer terms. The payload carries `contractor: null`
// so the document OMITS that block wholesale rather than printing empty labels
// or inventing values. Same for the customer block when the call never captured
// one.
export const guestQuoteToPdfPayload = (quote: GuestQuote): QuotePdfPayload => ({
  reference: quote.reference,
  createdAt: quote.createdAt,
  lineItems: quote.lineItems,
  jobType: quote.jobType,
  scope: quote.scope,
  contractor: null,
  customer: quote.customer,
});

/**
 * Renders the guest quote in the browser and returns it as a PDF blob.
 *
 * The renderer and its font data are a large bundle, so it is loaded on demand
 * — cold launch is the first thing a reviewer sees and must not pay for a PDF
 * library it may never use.
 */
export const renderGuestQuotePdfBlob = async (quote: GuestQuote): Promise<Blob> => {
  const [{ pdf }, { buildQuotePdfDocument }] = await Promise.all([
    import("@react-pdf/renderer"),
    import("@/lib/pdf/quote-payload"),
  ]);

  return pdf(
    buildQuotePdfDocument(guestQuoteToPdfPayload(quote)) as Parameters<typeof pdf>[0],
  ).toBlob();
};

export const guestQuoteFilename = (quote: GuestQuote): string =>
  `quote-${quote.reference}.pdf`;
