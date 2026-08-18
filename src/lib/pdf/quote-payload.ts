import { createElement, type ReactElement } from "react";
import { computeQuoteTotals } from "@/lib/quote-math";
import { QuotePdf } from "@/lib/pdf/quote-pdf";
import type { LineItem } from "@/lib/schemas/job";

// The quote document, defined once as plain data plus one element builder.
//
// This module is deliberately isomorphic: it imports no Supabase client and
// nothing node-only, so the browser can render a guest quote from an in-memory
// artefact using exactly the same document definition the server renders a
// stored quote with. Keeping the two transports on one definition is what stops
// them drifting.

// Everything the quote document needs. No row ids, no session.
//
// `contractor` and `customer` are nullable rather than partially-filled: a
// guest has no business identity and may have no named customer, and the
// document omits those blocks entirely rather than printing empty labels or
// invented values.
export type QuotePdfPayload = {
  // Short human reference printed on the document (the stored path derives it
  // from the quote id; a guest artefact carries its own client-side one).
  reference: string;
  createdAt: string;
  lineItems: LineItem[];
  jobType?: string;
  contractor: {
    companyName: string;
    companyNumber?: string | null;
    trade?: string | null;
    vatRegistered: boolean;
    vatNumber?: string | null;
    brandColor?: string;
    logoUrl?: string;
    footerTerms?: string;
  } | null;
  customer: {
    name?: string;
    email?: string;
    phone?: string;
    address?: string;
  } | null;
};

const formatDocumentDate = (createdAt: string): string =>
  new Date(createdAt).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

export const buildQuotePdfDocument = (payload: QuotePdfPayload): ReactElement => {
  // A guest is not VAT registered as far as this document is concerned: no VAT
  // number, no registration, so no VAT line. Nothing is assumed on their
  // behalf — the absence of a contractor is the absence of a VAT status.
  const vatRegistered = payload.contractor?.vatRegistered ?? false;
  const totals = computeQuoteTotals(payload.lineItems, vatRegistered);

  return createElement(QuotePdf, {
    companyName: payload.contractor?.companyName,
    trade: payload.contractor?.trade,
    companyNumber: payload.contractor?.companyNumber,
    vatNumber: payload.contractor?.vatNumber,
    brandColor: payload.contractor?.brandColor,
    logoUrl: payload.contractor?.logoUrl,
    footerTerms: payload.contractor?.footerTerms,
    reference: payload.reference,
    date: formatDocumentDate(payload.createdAt),
    jobType: payload.jobType,
    // No "Customer" fallback — PartyBlock omits an empty name rather than
    // printing the literal label as the value ("Customer: Customer"). Send
    // is already blocked without a customer name, so a real quote has one.
    customerName: payload.customer?.name ?? "",
    customerEmail: payload.customer?.email,
    customerPhone: payload.customer?.phone,
    siteAddress: payload.customer?.address,
    lineItems: payload.lineItems,
    subtotal: totals.subtotal,
    vat: totals.vat,
    total: totals.total,
    vatRegistered,
  });
};
