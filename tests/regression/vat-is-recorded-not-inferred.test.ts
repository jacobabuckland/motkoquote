// VAT was a function of a setting rather than a record of what was charged.
//
// Nothing stored it. Every surface recomputed it from the contractor's CURRENT
// `vat_registered` flag, which made three defects reported on 13 Sep into one:
//
//   * The job page reads the stored `quotes.total`; /q/[id] recomputed from
//     live line items. Toggling registration without re-saving made them
//     disagree by exactly 1.2x — £6,000 against £7,200 on one job.
//   * "Money in and out" applied today's flag to all £13,062 ever collected and
//     set aside £2,177 of VAT, including on £11,288 taken before registration.
//   * `invoices` carried a single `amount`, so the P&L's "Invoiced (net)" was
//     gross, beside costs that genuinely are net.
//
// What a customer was charged is a historical fact. Recomputing it from a flag
// that can change means the app restates its own past whenever the trade
// registers, deregisters, or the rate moves.
//
// Migration 80 adds the columns; this pins what gets written into them.
import { describe, expect, it } from "vitest";
import {
  invoiceNet,
  invoiceVatFor,
  quoteTotalsForDisplay,
  vatRecordFor,
} from "@/lib/vat-record";
import { VAT_RATE } from "@/lib/quote-math";
import type { LineItem } from "@/lib/schemas/job";

const line = (over: Partial<LineItem>): LineItem => ({
  description: "Work",
  category: "labour",
  quantity: 1,
  unit: "job",
  unit_price: 1200,
  multiplier: 1,
  people_count: 1,
  overtime: false,
  assumed: false,
  ...over,
});

/** The reported job: £1,200 net, £1,440 gross. */
const LINES = [line({})];

describe("what a quote records", () => {
  it("splits a VAT-registered quote into net and VAT", () => {
    expect(vatRecordFor(LINES, true)).toEqual({
      subtotal: 1200,
      vat_amount: 240,
      vat_rate: 0.2,
    });
  });

  it("records zero VAT for an unregistered trade — and still records the rate", () => {
    // A zero amount beside a real rate says "no VAT was charged". A NULL rate
    // says "nobody wrote it down". Those are different answers, and keeping
    // them different is the point of the column.
    expect(vatRecordFor(LINES, false)).toEqual({
      subtotal: 1200,
      vat_amount: 0,
      vat_rate: 0.2,
    });
  });

  it("records the rate in force, not a hard-coded 20% forever", () => {
    expect(vatRecordFor(LINES, true).vat_rate).toBe(VAT_RATE);
  });

  it("is exact to the penny on an awkward subtotal", () => {
    const odd = [line({ unit_price: 333.33 })];
    const record = vatRecordFor(odd, true);
    expect(record.subtotal).toBe(333.33);
    expect(record.vat_amount).toBe(66.67);
  });
});

describe("what an invoice records", () => {
  const QUOTE = { total: 1440, vat_amount: 240, vat_rate: 0.2 };

  it("takes the same share of the VAT as it takes of the quote", () => {
    // The reported 25% deposit: £360 of £1,440, so £60 of the £240.
    expect(invoiceVatFor(360, QUOTE)).toEqual({ vat_amount: 60, vat_rate: 0.2 });
  });

  it("gives the balance the rest", () => {
    expect(invoiceVatFor(1080, QUOTE)).toEqual({ vat_amount: 180, vat_rate: 0.2 });
  });

  it("splits the quote's VAT exactly across a deposit and its balance", () => {
    // The two documents must agree to the penny — which is why this is a share
    // of the quote's recorded VAT rather than a re-derivation from the amount.
    const deposit = invoiceVatFor(360, QUOTE);
    const balance = invoiceVatFor(1080, QUOTE);
    expect((deposit?.vat_amount ?? 0) + (balance?.vat_amount ?? 0)).toBe(QUOTE.vat_amount);
  });

  it("records nothing for a quote whose VAT was never recorded", () => {
    // A quote written before migration 80. Unknown is the truth; zero is a
    // claim nobody made.
    expect(invoiceVatFor(360, { total: 1440, vat_amount: null, vat_rate: null })).toBeNull();
  });

  it("does not divide by a zero total", () => {
    expect(invoiceVatFor(0, { total: 0, vat_amount: 0, vat_rate: 0.2 })).toEqual({
      vat_amount: 0,
      vat_rate: 0.2,
    });
  });
});

describe("reading net back", () => {
  it("subtracts the recorded VAT", () => {
    expect(invoiceNet({ amount: 1440, vat_amount: 240 })).toBe(1200);
  });

  it("is the amount itself where no VAT was charged", () => {
    expect(invoiceNet({ amount: 1414, vat_amount: 0 })).toBe(1414);
  });

  it("REFUSES to answer where VAT was never recorded", () => {
    // Deliberately null rather than the gross amount. Returning gross is
    // exactly the defect: a figure labelled net that is not. A caller wanting
    // to report "invoiced, net" has to decide what to do about rows that
    // cannot answer, and this makes it decide.
    expect(invoiceNet({ amount: 1440, vat_amount: null })).toBeNull();
  });
});

describe("what a quote DISPLAYS", () => {
  // Finding 3: the job page read the stored total while /q/[id] recomputed, so
  // one quote showed £6,000 to the customer and £7,200 to the trade the moment
  // registration was toggled without a re-save.
  const RECORDED = { total: 1440, subtotal: 1200, vat_amount: 240 };

  it("uses the recorded figures, not today's VAT flag", () => {
    // The flag says NOT registered; the quote was written while registered.
    // The recorded answer wins — what the customer was told does not change
    // because a setting did.
    expect(quoteTotalsForDisplay(RECORDED, LINES, false)).toEqual({
      subtotal: 1200,
      vat: 240,
      total: 1440,
      recorded: true,
    });
  });

  it("gives the same answer whichever way the flag is set", () => {
    expect(quoteTotalsForDisplay(RECORDED, LINES, true)).toEqual(
      quoteTotalsForDisplay(RECORDED, LINES, false),
    );
  });

  it("does not show the £6,000 the recompute produced", () => {
    expect(quoteTotalsForDisplay(RECORDED, LINES, false).total).not.toBe(1200);
  });

  it("shows a legacy row's STORED TOTAL and asserts no split", () => {
    // Changed 14 Sep. This used to expect a recomputation, and the pass-5
    // review found that fallback was the last place a quote still moved on a
    // checkbox — £450 ↔ £540 across the job page, /q/[id] and the PDF, on a
    // signed job whose invoice billed £450.
    //
    // A row that recorded nothing tells us what was CHARGED (the stored total)
    // and nothing about how it split. So: show the total, assert no VAT. The
    // same rule the P&L card applies to an invoice with no recorded vat_amount.
    const legacy = { total: 1440, subtotal: null, vat_amount: null };
    for (const registered of [true, false]) {
      expect(quoteTotalsForDisplay(legacy, LINES, registered)).toEqual({
        subtotal: 1440,
        vat: 0,
        total: 1440,
        recorded: false,
      });
    }
  });

  it("says which of the two happened", () => {
    expect(quoteTotalsForDisplay(RECORDED, LINES, true).recorded).toBe(true);
    expect(
      quoteTotalsForDisplay({ total: 1440, subtotal: null, vat_amount: null }, LINES, true).recorded,
    ).toBe(false);
  });

  it("treats a recorded ZERO as recorded, not as missing", () => {
    // An unregistered trade's quote records £0 VAT. That is an answer, and it
    // must not fall through to a recomputation that today's flag might make
    // non-zero.
    const noVat = { total: 1200, subtotal: 1200, vat_amount: 0 };
    const shown = quoteTotalsForDisplay(noVat, LINES, true);
    expect(shown.vat).toBe(0);
    expect(shown.recorded).toBe(true);
  });
});
