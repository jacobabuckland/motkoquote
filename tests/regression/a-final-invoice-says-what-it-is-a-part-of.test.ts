// A final invoice describes the whole scope and charges only the balance.
//
// Reported 15 Sep, on invoice FCE6A164: a document headed VAT INVOICE listing
// "Skim and finish ceilings — 3 bedrooms / Plasterboard, scrim tape and finish
// plaster", then "Net £693.00 · VAT £138.60 · Total £831.60", against a quote
// whose lines for that scope are £750.00 and £240.00. There was no "less
// deposit already paid £297.00" line, so nothing on the page reconciled the
// work described with the figure charged — and a customer's bookkeeper is the
// one reading it.
//
// Structurally the same complaint the legacy-quote fix repaired: items that do
// not sum to the net with nothing explaining why.
import { describe, expect, it } from "vitest";
import { invoicePartOfJob } from "@/lib/invoice-part-of-job";

const QUOTE = { total: 1188, vat_amount: 198 }; // £990.00 net
const DEPOSIT = { amount: 356.4, vat_amount: 59.4 }; // £297.00 net

describe("a final invoice raised after a deposit", () => {
  it("states the job total and what has already been invoiced", () => {
    expect(invoicePartOfJob({ quote: QUOTE, earlierInvoices: [DEPOSIT] })).toEqual({
      jobNet: 990,
      alreadyInvoicedNet: 297,
    });
  });

  it("reconciles: the balance plus what came before is the job", () => {
    const part = invoicePartOfJob({ quote: QUOTE, earlierInvoices: [DEPOSIT] });
    if (!part) throw new Error("expected a part-of-job statement");
    // £693.00 is the net this invoice charges; the three figures must foot.
    expect(Math.round((part.jobNet - part.alreadyInvoicedNet) * 100) / 100).toBe(693);
  });

  it("adds up several earlier invoices", () => {
    const part = invoicePartOfJob({
      quote: { total: 1200, vat_amount: 200 },
      earlierInvoices: [
        { amount: 240, vat_amount: 40 },
        { amount: 360, vat_amount: 60 },
      ],
    });
    expect(part).toEqual({ jobNet: 1000, alreadyInvoicedNet: 500 });
  });
});

describe("when it says nothing, and why", () => {
  it("says nothing on the only invoice for a job", () => {
    // There is no part-of to explain.
    expect(invoicePartOfJob({ quote: QUOTE, earlierInvoices: [] })).toBeNull();
  });

  it("says nothing when the quote never recorded its VAT", () => {
    // A pre-migration-80 row. Its net is unknown, and `invoiceNet` returns null
    // rather than guessing — a guessed net has no place on a VAT invoice.
    expect(
      invoicePartOfJob({
        quote: { total: 1188, vat_amount: null },
        earlierInvoices: [DEPOSIT],
      }),
    ).toBeNull();
  });

  it("says nothing when an earlier invoice never recorded its VAT", () => {
    expect(
      invoicePartOfJob({
        quote: QUOTE,
        earlierInvoices: [{ amount: 356.4, vat_amount: null }],
      }),
    ).toBeNull();
  });

  it("says nothing when the earlier invoices came to nothing", () => {
    expect(
      invoicePartOfJob({ quote: QUOTE, earlierInvoices: [{ amount: 0, vat_amount: 0 }] }),
    ).toBeNull();
  });
});
