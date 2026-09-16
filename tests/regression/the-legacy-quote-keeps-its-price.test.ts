// The worst defect of the 14 Sep pass-5 review, and the one that put a wrong
// number in front of a customer on a signed job.
//
// A quote written before migration 80 records no VAT split. Every surface read
// the recorded columns where they existed — and where they did not, fell back
// to recomputing from the contractor's CURRENT registration flag. So a legacy
// row still moved on a checkbox, which is the entire defect migration 80 was
// written to end, surviving in the fallback.
//
// Measured on a signed job with registration ON:
//
//   Job page headline           £450.00
//   Quote block, same screen    Subtotal £450.00 · VAT (20%) £90.00 · Total £540.00
//   /q/[id] (the customer's)    Subtotal £450.00 · VAT (20%) £90.00 · Total £540.00
//   Quote PDF                   Subtotal £450.00 · VAT (20%) £90.00 · Total £540.00
//   The invoice the app raised  £450.00
//
// Four numbers, two values, one job — and the divergence guard then told the
// customer in writing that the trade "has since updated this quote to £540.00,
// which is … the one that applies". Nobody touched that quote.
//
// The rule now: no recorded split means the stored total is what was charged
// and the split is unknown. Show the total, assert no VAT. Identical to what
// the P&L card already does with an invoice that records no `vat_amount`.
import { describe, expect, it } from "vitest";
import { quoteTotalsForDisplay } from "@/lib/vat-record";
import type { LineItem } from "@/lib/schemas/job";

const line = (over: Partial<LineItem> = {}): LineItem => ({
  description: "Skim two walls",
  category: "other",
  quantity: 1,
  unit: "job",
  unit_price: 450,
  multiplier: 1,
  people_count: 1,
  overtime: false,
  assumed: false,
  ...over,
});

/** Megan's quote: written 13 Sep, so no recorded split. £450 stored. */
const LEGACY = { total: 450, subtotal: null, vat_amount: null };

describe("a quote written before the columns existed", () => {
  it("does NOT invent £90 when registration is switched on", () => {
    const totals = quoteTotalsForDisplay(LEGACY, [line()], true);
    expect(totals.total).toBe(450);
    expect(totals.vat).toBe(0);
  });

  it("reads the same with registration off", () => {
    const on = quoteTotalsForDisplay(LEGACY, [line()], true);
    const off = quoteTotalsForDisplay(LEGACY, [line()], false);
    expect(on).toEqual(off);
  });

  it("agrees with the invoice the app actually raised", () => {
    // The final invoice on that job billed £450.00. A quote page saying £540
    // beside an invoice asking £450 is the customer-facing half of the defect.
    expect(quoteTotalsForDisplay(LEGACY, [line()], true).total).toBe(450);
  });

  it("foots: subtotal plus VAT equals total, in both directions", () => {
    // The reported screen did not: £450 + £90 ≠ £450 on the job page, and the
    // three figures never reconciled on any surface.
    for (const registered of [true, false]) {
      const t = quoteTotalsForDisplay(LEGACY, [line()], registered);
      expect(t.subtotal + t.vat).toBe(t.total);
    }
  });

  it("says it is not recorded, so a surface can mark it if it wants to", () => {
    expect(quoteTotalsForDisplay(LEGACY, [line()], true).recorded).toBe(false);
  });

  it("keeps a legacy VAT-INCLUSIVE total whole rather than stripping VAT off it", () => {
    // A legacy quote written while registered stored the gross. We do not know
    // the split and must not guess one — but we must not shrink the total
    // either, which is what a customer's document moving would look like from
    // the other direction.
    const legacyGross = { total: 540, subtotal: null, vat_amount: null };
    expect(quoteTotalsForDisplay(legacyGross, [line()], false).total).toBe(540);
    expect(quoteTotalsForDisplay(legacyGross, [line()], true).total).toBe(540);
  });
});

describe("a draft that has never been saved still computes", () => {
  it("falls back to the line items when there is no stored total at all", () => {
    // The one case where computing is the only answer — and the one the editor
    // needs while a quote is being built.
    const fresh = { total: 0, subtotal: null, vat_amount: null };
    expect(quoteTotalsForDisplay(fresh, [line()], false).total).toBe(450);
    expect(quoteTotalsForDisplay(fresh, [line()], true).total).toBe(540);
  });
});

describe("a recorded row is untouched by any of this", () => {
  it("still reads its own split, whichever way the flag points", () => {
    const recorded = { total: 3200.28, subtotal: 2666.9, vat_amount: 533.38 };
    for (const registered of [true, false]) {
      const t = quoteTotalsForDisplay(recorded, [line()], registered);
      expect(t).toEqual({ subtotal: 2666.9, vat: 533.38, total: 3200.28, recorded: true });
    }
  });

  it("still reads a recorded ZERO as zero rather than as unknown", () => {
    const nil = { total: 740, subtotal: 740, vat_amount: 0 };
    expect(quoteTotalsForDisplay(nil, [line()], true).vat).toBe(0);
    expect(quoteTotalsForDisplay(nil, [line()], true).recorded).toBe(true);
  });
});
