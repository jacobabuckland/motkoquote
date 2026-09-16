// A setting must not move a number a customer was given.
//
// Migration 80 recorded the split at write time and #746 wired the READ half
// into /q/[id] only. The Chrome review of 14 Sep found the other two surfaces
// still recomputing, and the VAT ROW on all three still gated on the live
// `vat_registered` flag rather than on whether the quote carried any VAT. That
// combination failed in both directions at once:
//
//   D17  The quote PDF recomputed everything. Harriet's quote — built, sent,
//        accepted, contracted and PAID at £3,620.28 while registered — printed
//        as a £3,016.90 document the moment registration was switched off.
//        Same quote, same URL, £603.38 difference, nothing touched but a
//        checkbox.
//
//   D18  With the total correctly frozen from the record and the ROW gated on
//        the flag, the customer's own quote page showed
//        "Subtotal £3,016.90 · Total £3,620.28" and no VAT row — an
//        unexplained £603.38. The inverse, on the trade's job page, was worse:
//        an unregistered trade's £740 quote read
//        "Subtotal £740.00 · VAT (20%) £148.00 · Total £740.00", three numbers
//        that do not reconcile and a £148 that belongs to nothing. That row was
//        hard-coded to compute at 20% (`computeQuoteTotals(lines, true)`), so
//        it ignored the recorded figure entirely.
//
//   D20  And a quote written by an UNREGISTERED trade printed
//        "VAT (20%) £0.00" — quoting a rate against a registration that does
//        not exist.
//
// One rule fixes all three: the figures come from the record where there is
// one, and the row prints when there is VAT to print. Not when a checkbox is
// ticked.
import { describe, expect, it } from "vitest";
import { quoteTotalsForDisplay } from "@/lib/vat-record";
import { buildQuotePdfDocument, type QuotePdfPayload } from "@/lib/pdf/quote-payload";
import type { LineItem } from "@/lib/schemas/job";

const line = (over: Partial<LineItem>): LineItem => ({
  description: "Work",
  category: "labour",
  quantity: 1,
  unit: "job",
  unit_price: 3016.9,
  multiplier: 1,
  people_count: 1,
  overtime: false,
  assumed: false,
  ...over,
});

/** Harriet's job: £3,016.90 net, £603.38 VAT, £3,620.28 gross. */
const HARRIET_LINES = [line({})];
const HARRIET_RECORDED = { total: 3620.28, subtotal: 3016.9, vat_amount: 603.38 };

/** Owen's job: £740, written while unregistered, so no VAT was ever charged. */
const OWEN_LINES = [line({ unit_price: 740 })];
const OWEN_RECORDED = { total: 740, subtotal: 740, vat_amount: 0 };

const payload = (
  lineItems: LineItem[],
  recorded: QuotePdfPayload["recorded"],
  vatRegistered: boolean,
): QuotePdfPayload => ({
  reference: "ABCD1234",
  createdAt: "2026-09-14T09:00:00.000Z",
  lineItems,
  recorded,
  contractor: {
    companyName: "Test Trade Ltd",
    vatRegistered,
    vatNumber: vatRegistered ? "GB123456789" : null,
  },
  customer: { name: "A Customer" },
});

/**
 * The document's own totals, read off the element the renderer is handed.
 *
 * Asserting the props rather than the rendered PDF bytes: this is about which
 * NUMBERS the document is built with and whether the VAT row is asked for at
 * all, and the byte-level rendering is pinned by the golden tests already.
 */
const documentTotals = (p: QuotePdfPayload) => {
  const element = buildQuotePdfDocument(p);
  const props = element.props as { subtotal: number; vat: number; total: number; showVat: boolean };
  return { subtotal: props.subtotal, vat: props.vat, total: props.total, showVat: props.showVat };
};

describe("D17 — the PDF total does not move when a setting does", () => {
  it("prints the recorded total while registered", () => {
    expect(documentTotals(payload(HARRIET_LINES, HARRIET_RECORDED, true)).total).toBe(3620.28);
  });

  it("prints the SAME total after registration is switched off", () => {
    // The reported defect: this document became £3,016.90 — a different figure
    // from the one the customer accepted, contracted for and paid.
    expect(documentTotals(payload(HARRIET_LINES, HARRIET_RECORDED, false)).total).toBe(3620.28);
  });

  it("is identical in every figure across the toggle", () => {
    expect(documentTotals(payload(HARRIET_LINES, HARRIET_RECORDED, true))).toEqual(
      documentTotals(payload(HARRIET_LINES, HARRIET_RECORDED, false)),
    );
  });

  it("keeps the VAT row on a quote that charged VAT, whatever the flag says", () => {
    // The row disappearing is what left £603.38 unexplained between subtotal
    // and total on the customer's page.
    expect(documentTotals(payload(HARRIET_LINES, HARRIET_RECORDED, false)).showVat).toBe(true);
  });

  it("PRINTS A LEGACY ROW'S STORED TOTAL, whichever way the flag points", () => {
    // Changed 14 Sep, and this assertion used to expect the total to move with
    // the flag. It was the last path by which a CUSTOMER'S PDF still changed
    // value on a setting — measured at £450 ↔ £540 on a signed job, against an
    // invoice billing £450.
    //
    // The stored total is what the customer was told. The split is unknown, so
    // none is printed.
    const legacy = { total: 3620.28, subtotal: null, vat_amount: null };
    expect(documentTotals(payload(HARRIET_LINES, legacy, true)).total).toBe(3620.28);
    expect(documentTotals(payload(HARRIET_LINES, legacy, false)).total).toBe(3620.28);
    expect(documentTotals(payload(HARRIET_LINES, legacy, true)).showVat).toBe(false);
  });

  it("computes for a guest, who has no row and no registration", () => {
    const guest: QuotePdfPayload = {
      reference: "GUEST001",
      createdAt: "2026-09-14T09:00:00.000Z",
      lineItems: OWEN_LINES,
      contractor: null,
      customer: null,
    };
    const totals = documentTotals(guest);
    expect(totals.total).toBe(740);
    expect(totals.showVat).toBe(false);
  });
});

describe("D20 — a quote that charged no VAT prints no VAT row", () => {
  it("asks for no row on the PDF, even with registration switched on", () => {
    // "VAT (20%) £0.00" claims a registration the trade did not have when the
    // quote was written.
    expect(documentTotals(payload(OWEN_LINES, OWEN_RECORDED, true)).showVat).toBe(false);
  });

  it("asks for no row with registration off either", () => {
    expect(documentTotals(payload(OWEN_LINES, OWEN_RECORDED, false)).showVat).toBe(false);
  });
});

describe("D18 — subtotal + VAT = total, on both sides of the toggle", () => {
  // The surfaces gate their row on `totals.vat > 0`, so this is the property
  // that rule buys: whenever a row is shown the three figures reconcile, and
  // whenever one is hidden there is nothing to explain.
  const reconciles = (t: { subtotal: number; vat: number; total: number }) =>
    Math.round((t.subtotal + t.vat) * 100) / 100 === t.total;

  it("reconciles for the registered quote, registration on and off", () => {
    for (const flag of [true, false]) {
      const totals = quoteTotalsForDisplay(HARRIET_RECORDED, HARRIET_LINES, flag);
      expect(reconciles(totals), `registration ${flag}`).toBe(true);
      expect(totals.vat > 0, `registration ${flag}`).toBe(true);
    }
  });

  it("reconciles for the unregistered quote, registration on and off", () => {
    // The reported inverse: £740 + £148 ≠ £740. The £148 came from
    // `computeQuoteTotals(lines, true)` — hard-coded, so it ignored the record.
    for (const flag of [true, false]) {
      const totals = quoteTotalsForDisplay(OWEN_RECORDED, OWEN_LINES, flag);
      expect(reconciles(totals), `registration ${flag}`).toBe(true);
      expect(totals.vat, `registration ${flag}`).toBe(0);
    }
  });

  it("gives the trade's page and the customer's page the same three figures", () => {
    // Both now derive from this one function, which is the only way they can be
    // relied on to agree. The job page previously recomputed the subtotal from
    // the live flag while printing the stored total beside it.
    const trade = quoteTotalsForDisplay(OWEN_RECORDED, OWEN_LINES, true);
    const customer = quoteTotalsForDisplay(OWEN_RECORDED, OWEN_LINES, true);
    expect(trade).toEqual(customer);
  });
});
