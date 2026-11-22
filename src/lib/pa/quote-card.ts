// The quote card, and the single question "can this quote be sent from chat?".
//
// MONEY ON A CARD COMES FROM quote-math AND NOWHERE ELSE. The line amounts are
// lineItemTotal, the totals are computeQuoteTotals over the stored line items.
// The model never supplies a figure here, and a card never reads a total the
// model typed.
//
// `sendReadiness` is used twice: when a send is proposed, and again when it is
// confirmed. A draft that has stopped being sendable between the two (an
// assumption un-confirmed, a price changed) is refused at the second.

import { createHash } from "node:crypto";
import type { StatusLabel } from "@/components/ui/status-chip";
import { deriveJobTitle } from "@/lib/schemas/sow";
import type { LineItem } from "@/lib/schemas/job";
import { computeQuoteTotals, lineItemTotal } from "@/lib/quote-math";
import { quoteExceedsCeiling } from "@/lib/quote-send-guards";
import { hasUnpricedLabour, hasUnpricedNonLabour } from "@/lib/unpriced-flags";
import { deriveAssumptions, unconfirmedSlots, type AssumptionRecord } from "./assumptions";
import { lineItemsOf, sanitiseForModel, type JobBundle } from "./data";
import type { AssumptionView, QuoteCard } from "./types";

const MAX_CARD_LINES = 6;

const statusLabel = (bundle: JobBundle): StatusLabel => {
  const status = bundle.quote?.status;
  if (status === "sent") return bundle.quote?.viewed_at ? "Viewed" : "Sent";
  if (status === "accepted") return "Accepted";
  if (status === "declined") return "Declined";
  if (status === "archived") return "Archived";
  return "Draft";
};

// What identifies the quote the contractor was shown: its lines and its total.
// A pending send carries this, and refuses to run if the quote has moved since.
export const quoteFingerprint = (lineItems: LineItem[], vatRegistered: boolean): string => {
  const totals = computeQuoteTotals(lineItems, vatRegistered);
  return createHash("sha256")
    .update(JSON.stringify({ lineItems, total: totals.total, vatRegistered }))
    .digest("hex")
    .slice(0, 32);
};

export type CustomerForSend = {
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  smsOptOut?: boolean;
};

export type SendReadiness = {
  blockers: string[];
  customer: CustomerForSend | null;
  assumptions: AssumptionView[];
};

export const sendReadiness = (
  bundle: JobBundle,
  vatRegistered: boolean,
  record: AssumptionRecord | null,
): SendReadiness => {
  const blockers: string[] = [];
  const assumptions = deriveAssumptions(bundle.sow, record);
  const lineItems = lineItemsOf(bundle.quote);

  if (!bundle.quote) {
    blockers.push("There's no quote to send yet.");
  } else if (bundle.quote.status !== "draft") {
    blockers.push("This quote has already gone out.");
  }

  if (bundle.quote?.status === "draft") {
    if (lineItems.length === 0) blockers.push("The quote has no lines yet.");
    if (hasUnpricedLabour(lineItems) || hasUnpricedNonLabour(lineItems)) {
      blockers.push("Some lines aren't priced yet. Give me the figure for each.");
    }
    const { total } = computeQuoteTotals(lineItems, vatRegistered);
    if (lineItems.length > 0 && total <= 0) {
      blockers.push("The total is £0. Send a £0 quote from the quote page, where it asks you to confirm.");
    }
    if (quoteExceedsCeiling(total)) {
      blockers.push(
        "This is over £10,000, which needs a staged-payment confirmation. Send it from the quote page.",
      );
    }
    const unconfirmed = unconfirmedSlots(assumptions);
    if (unconfirmed.length > 0) {
      blockers.push(
        `Confirm the ${unconfirmed.map((a) => a.label.toLowerCase()).join(", ")} before it can go.`,
      );
    }
  }

  const name = bundle.customer?.name?.trim();
  const email = bundle.customer?.contact?.email?.trim();
  const phone = bundle.customer?.contact?.phone?.trim();
  let customer: CustomerForSend | null = null;
  if (!name) {
    blockers.push("I don't have the customer's name yet.");
  } else if (!email && !phone) {
    blockers.push("I need an email or mobile number for the customer.");
  } else {
    customer = {
      name,
      email: email || undefined,
      phone: phone || undefined,
      address: bundle.customer?.contact?.address?.trim() || undefined,
      smsOptOut: bundle.customer?.contact?.sms_opt_out === true,
    };
  }

  return { blockers, customer: blockers.length === 0 ? customer : null, assumptions };
};

export const buildQuoteCard = (
  bundle: JobBundle,
  vatRegistered: boolean,
  record: AssumptionRecord | null,
): QuoteCard | null => {
  if (!bundle.quote) return null;
  const lineItems = lineItemsOf(bundle.quote);
  const totals = computeQuoteTotals(lineItems, vatRegistered);
  const readiness = sendReadiness(bundle, vatRegistered, record);

  const recipient = bundle.customer?.name
    ? `${sanitiseForModel(bundle.customer.name, 60)}${
        bundle.customer.contact?.email
          ? `, ${sanitiseForModel(bundle.customer.contact.email, 60)}`
          : bundle.customer.contact?.phone
            ? `, ${sanitiseForModel(bundle.customer.contact.phone, 30)}`
            : ""
      }`
    : null;

  return {
    type: "quote",
    jobId: bundle.job.id,
    quoteId: bundle.quote.id,
    customerName: bundle.customer?.name ? sanitiseForModel(bundle.customer.name, 60) : null,
    title: sanitiseForModel(
      deriveJobTitle(bundle.sow, bundle.job.extracted_json?.job_type) || "Job",
      60,
    ),
    status: statusLabel(bundle),
    lines: lineItems.slice(0, MAX_CARD_LINES).map((item) => ({
      description: sanitiseForModel(item.description, 100),
      quantity: item.quantity,
      unit: item.unit,
      amount: lineItemTotal(item),
    })),
    moreLines: Math.max(0, lineItems.length - MAX_CARD_LINES),
    subtotal: totals.subtotal,
    vat: totals.vat,
    total: totals.total,
    vatRegistered,
    assumptions: readiness.assumptions,
    blockers: readiness.blockers,
    canSend: readiness.blockers.length === 0,
    recipient,
  };
};
