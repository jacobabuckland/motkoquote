import { createElement, type ReactElement } from "react";
import { computeQuoteTotals } from "@/lib/quote-math";
import { QuotePdf } from "@/lib/pdf/quote-pdf";
import { synthesizeTimeline, type SowState, type SowRoom } from "@/lib/schemas/sow";
import type { LineItem, MaterialsSupply } from "@/lib/schemas/job";

// The quote document, defined once as plain data plus one element builder.
//
// This module is deliberately isomorphic: it imports no Supabase client and
// nothing node-only, so the browser can render a guest quote from an in-memory
// artefact using exactly the same document definition the server renders a
// stored quote with. Keeping the two transports on one definition is what stops
// them drifting.

// Narrowed projection of SowState for customer-facing rendering. Contractor-
// only fields (contractor_flags, assumption_note, next_question,
// unasked_required, wrap_incomplete) are omitted.
export type QuoteScope = {
  overviewNarrative?: string;
  rooms: SowRoom[];
  additionalItems: string[];
  existingConditions?: string;
  accessIssues?: string;
  inclusions: string[];
  exclusions: string[];
  materialsMentioned: string[];
  materialsSupply: MaterialsSupply | null;
  assumptions: Array<{ description: string; treatment: "excluded" | "provisional_sum" | "assumed_ok" }>;
  timeline: string;
};

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
  scope?: QuoteScope | null;
};

const formatDocumentDate = (createdAt: string): string =>
  new Date(createdAt).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

// Builds QuoteScope from SowState. Returns null when scope is too thin (all
// arrays empty, all narrative fields absent) - no heading rendered in that case.
// Calls synthesizeTimeline with the crew size the pricing actually used (via
// crewSizeOverride parameter) to prevent understating the crew.
export const buildQuoteScope = (
  sow: SowState,
  crewSizeOverride?: number,
): QuoteScope | null => {
  const hasContent =
    sow.rooms.length > 0 ||
    sow.additional_items.length > 0 ||
    sow.inclusions.length > 0 ||
    sow.exclusions.length > 0 ||
    sow.assumptions_and_unknowns.length > 0 ||
    sow.materials_mentioned.length > 0 ||
    sow.overview_narrative ||
    sow.existing_conditions ||
    sow.access_issues;

  if (!hasContent) return null;

  return {
    overviewNarrative: sow.overview_narrative,
    rooms: sow.rooms,
    additionalItems: sow.additional_items,
    existingConditions: sow.existing_conditions,
    accessIssues: sow.access_issues,
    inclusions: sow.inclusions,
    exclusions: sow.exclusions,
    materialsMentioned: sow.materials_mentioned,
    materialsSupply: sow.materials_supply,
    assumptions: sow.assumptions_and_unknowns,
    timeline: synthesizeTimeline(sow, crewSizeOverride),
  };
};

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
    scope: payload.scope ?? null,
  });
};
