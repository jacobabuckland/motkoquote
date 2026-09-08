/**
 * The statement of work is a record of scope. It is not a second agreement, and
 * it does not disclose how it was made.
 *
 * Two unconditional literals sat at the bottom of every SOW ever rendered:
 *
 *   1. An acceptance strip — "By signing below, the customer accepts the scope,
 *      assumptions and exclusions set out in this Statement of Work" — over a
 *      "Customer signature" line and a date line. The contract is the signature
 *      point, and it is the only document that carries a price, payment terms,
 *      a cancellation right and a governing law. A signature collected on this
 *      document instead is a signature on an agreement missing all four, and
 *      two signature surfaces for one job is worse than one.
 *
 *      The route serving this PDF calls it "an internal contractor document
 *      (not a customer-facing capability URL like the quote/contract PDFs)" and
 *      is authenticated and tenant-scoped accordingly — so the product has no
 *      way to collect the signature it invites. The invitation is what makes a
 *      contractor print it and collect one by hand.
 *
 *   2. A footer reading "Based on a recorded conversation with the customer.
 *      Verify scope on site before starting work." It printed unless the
 *      contractor had set footer terms of their own. The first sentence
 *      discloses provenance the reader was never owed and cannot verify — a
 *      SOW may be edited long after any call, and jobs exist with no recording
 *      at all — and the second is advice to the contractor, rendered where a
 *      document puts its terms. The quote and contract PDFs both pass footer
 *      terms straight through with no default; this one was the anomaly.
 *
 * Asserted against the document's rendered TEXT, not its source: what the
 * reader sees is the whole claim, and it must survive any refactor of the JSX
 * that produces it.
 */

import { createElement } from "react";
import { describe, expect, it } from "vitest";

import { ContractPdf } from "@/lib/pdf/contract-pdf";
import { SowPdf } from "@/lib/pdf/sow-pdf";
import { EMPTY_SOW_STATE } from "@/lib/schemas/sow";
import { pdfProse } from "../helpers/pdf-text";

const renderSow = (overrides: { footerTerms?: string } = {}) =>
  pdfProse(
    createElement(SowPdf, {
      companyName: "Acme Building Ltd",
      reference: "AAAA1111",
      date: "1 Jan 2026",
      sow: {
        ...EMPTY_SOW_STATE,
        customer_name: "Jane Client",
        site_address: "12 Example Road, Norwich, NR1 1AA",
        overview_narrative: "Replaster two bedrooms and make good.",
      },
      ...overrides,
    }),
  );

describe("the statement of work does not ask to be signed", () => {
  it("carries no signature line", () => {
    const text = renderSow();

    expect(text).not.toMatch(/customer signature/i);
    expect(text).not.toMatch(/by signing below/i);
  });

  it("makes no claim about what signing it would mean", () => {
    // The strip's own wording is the danger, not just the line beneath it: it
    // asserts that signing accepts the scope, assumptions and exclusions —
    // which is an agreement, on a document with no price.
    expect(renderSow()).not.toMatch(/accepts the scope/i);
  });

  it("still says what the job is, so nothing was gutted along with it", () => {
    const text = renderSow();

    expect(text).toContain("Jane Client");
    expect(text).toContain("12 Example Road, Norwich, NR1 1AA");
    expect(text).toContain("Replaster two bedrooms and make good.");
  });
});

describe("the contract remains the signature point", () => {
  it("still carries a customer signature line", () => {
    // The companion half of the removal above, and the reason it is safe:
    // signing did not leave the product, it stopped being offered twice.
    const text = pdfProse(
      createElement(ContractPdf, {
        companyName: "Acme Building Ltd",
        reference: "BBBB2222",
        date: "1 Jan 2026",
        customerName: "Jane Client",
        quoteTotal: 1200,
        depositPct: null,
        renderedBody: "## 1. The Work\n\nReplaster two bedrooms.",
        status: "sent",
      }),
    );

    expect(text).toMatch(/customer signature/i);
  });
});

describe("the statement of work does not disclose how it was made", () => {
  it("says nothing about a recording", () => {
    expect(renderSow()).not.toMatch(/recorded conversation/i);
    expect(renderSow()).not.toMatch(/recording/i);
  });

  it("gives the contractor no site instructions dressed as document terms", () => {
    expect(renderSow()).not.toMatch(/verify scope on site/i);
  });

  it("still prints the contractor's own footer terms when they have set them", () => {
    // Removing the default must not remove the footer. A contractor who has
    // written their own terms keeps them; one who has not gets none, which is
    // exactly how the quote and contract documents already behave.
    const terms = "Prices held for 30 days. Waste removal excluded unless stated.";

    expect(renderSow({ footerTerms: terms })).toContain(terms);
  });
});
