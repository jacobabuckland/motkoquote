import { createElement, type ReactElement } from "react";
import { computeQuoteTotals, labourCrewSize } from "@/lib/quote-math";
import { QuotePdf } from "@/lib/pdf/quote-pdf";
import { synthesizeTimeline, type SowState } from "@/lib/schemas/sow";
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
// The scope of works, as the CUSTOMER document needs it.
//
// A deliberately narrowed projection of SowState rather than SowState itself.
// The SoW carries contractor-only channels — next_question, unasked_required,
// wrap_incomplete, reclassification bookkeeping — and handing the whole object
// to a customer-facing renderer makes leaking one of them a matter of someone
// adding a field, not a decision. This type is the list of things a customer
// is allowed to read.
export type QuoteScope = {
  overviewNarrative?: string;
  rooms: { name: string; dimensions?: string; workItems: string[] }[];
  additionalItems: string[];
  existingConditions?: string;
  accessIssues?: string;
  inclusions: string[];
  exclusions: string[];
  materialsMentioned: string[];
  materialsSupply: { contractorSupplied: string[]; customerSupplied: string[] } | null;
  assumptions: string[];
  timeline: string;
};

// Maps a stored SoW onto the projection above, or null when there is nothing
// worth a section. Kept here, beside the payload, so the guest browser path and
// the server path derive scope identically — the same reason this module
// imports no Supabase client.
export const buildQuoteScope = (
  sow: SowState,
  lineItems: LineItem[],
): QuoteScope | null => {
  const rooms = sow.rooms
    .filter((room) => room.work_items.length > 0 || Boolean(room.dimensions))
    .map((room) => ({
      name: room.name,
      dimensions: room.dimensions ?? undefined,
      workItems: room.work_items,
    }));

  const assumptions = sow.assumptions_and_unknowns.map((a) => a.description);

  // "Thin" means nothing a customer could read. An empty section with a heading
  // is worse than no section: it advertises that scope was captured and then
  // shows none.
  const hasContent =
    rooms.length > 0 ||
    sow.additional_items.length > 0 ||
    sow.inclusions.length > 0 ||
    sow.exclusions.length > 0 ||
    sow.materials_mentioned.length > 0 ||
    assumptions.length > 0 ||
    Boolean(sow.overview_narrative) ||
    Boolean(sow.existing_conditions) ||
    Boolean(sow.access_issues);

  if (!hasContent) return null;

  // The crew the PRICING actually used overrides labour_plan.people_count, so
  // the timeline can never understate the team — synthesizeTimeline takes the
  // override for exactly this reason.
  const crewSize = labourCrewSize(lineItems);

  return {
    overviewNarrative: sow.overview_narrative ?? undefined,
    rooms,
    additionalItems: sow.additional_items,
    existingConditions: sow.existing_conditions ?? undefined,
    accessIssues: sow.access_issues ?? undefined,
    inclusions: sow.inclusions,
    exclusions: sow.exclusions,
    materialsMentioned: sow.materials_mentioned,
    materialsSupply: sow.materials_supply
      ? {
          contractorSupplied: sow.materials_supply.contractor_supplied,
          customerSupplied: sow.materials_supply.customer_supplied,
        }
      : null,
    assumptions,
    timeline: synthesizeTimeline(sow, crewSize > 0 ? crewSize : undefined),
  };
};

export type QuotePdfPayload = {
  // Short human reference printed on the document (the stored path derives it
  // from the quote id; a guest artefact carries its own client-side one).
  reference: string;
  createdAt: string;
  lineItems: LineItem[];
  jobType?: string;
  // Optional: a payload without it renders exactly as before, which is what
  // keeps every existing golden byte-identical.
  scope?: QuoteScope;
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
    scope: payload.scope,
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
