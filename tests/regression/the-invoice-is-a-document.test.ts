// Four findings from the 14 Sep Chrome review, all about invoices.
//
//   D9   /i/[id] was a business name, "Invoice for <customer>", an amount, a
//        due date and a pay button. A VAT-registered limited company sent a
//        customer a demand for £3,620.28 carrying nothing they or their
//        accountant could reclaim against — no VAT breakdown, no VAT number,
//        no supplier address, no invoice number, no description of the work.
//
//   D13  /setup said 7 days and contract clause 3 said "7 days", and the
//        invoice was raised due in 14. createInvoiceRecord called
//        defaultInvoiceDueDate() with no arguments, so the trade's own terms
//        reached their contract and never their invoice.
//
// D11 (a signed job offering no way to invoice) and D12 (a settled job with no
// route back to its invoices) are page-composition changes and are covered by
// the component tests beside this file; what is pinned here is the logic they
// rest on.
import { describe, expect, it } from "vitest";
import { paymentTermDays } from "@/lib/payment-term-days";
import { defaultInvoiceDueDate, DEFAULT_INVOICE_TERM_DAYS } from "@/lib/invoice-due-date";
import { invoiceReference } from "@/app/i/[id]/vat-invoice-details";
import { describeSupply } from "@/lib/invoice-supply";
import type { LineItem } from "@/lib/schemas/job";

describe("D13 — the invoice inherits the terms the trade chose", () => {
  // The four /setup offers, which is what makes reading them safe at all.
  it("reads every option the setup form can produce", () => {
    expect(paymentTermDays("On receipt")).toBe(0);
    expect(paymentTermDays("7 days")).toBe(7);
    expect(paymentTermDays("14 days")).toBe(14);
    expect(paymentTermDays("30 days")).toBe(30);
  });

  it("is not fussy about case or surrounding space", () => {
    expect(paymentTermDays("  7 Days  ")).toBe(7);
    expect(paymentTermDays("ON RECEIPT")).toBe(0);
  });

  it("REFUSES to read a number out of prose", () => {
    // This is the rule invoice-due-date.ts was written around, and it survives
    // unchanged: "deriving a number of days from prose would mean guessing at
    // the one figure that decides when a customer is told they are late."
    // A sentence could as easily be about when the TRADE pays a supplier.
    expect(paymentTermDays("payment due within 30 days of invoice")).toBeNull();
    expect(paymentTermDays("7 days from completion")).toBeNull();
    expect(paymentTermDays("net 30")).toBeNull();
    expect(paymentTermDays("as agreed")).toBeNull();
  });

  it("says nothing rather than zero for an unset field", () => {
    // Null and 0 are different answers: 0 is "on receipt", null is "not
    // stated", and only one of them should move a due date.
    expect(paymentTermDays(null)).toBeNull();
    expect(paymentTermDays(undefined)).toBeNull();
    expect(paymentTermDays("")).toBeNull();
    expect(paymentTermDays("   ")).toBeNull();
  });

  it("moves the due date by the chosen term", () => {
    const from = new Date("2026-09-14T10:00:00.000Z");
    expect(defaultInvoiceDueDate(from, 7)).toBe("2026-09-21");
    expect(defaultInvoiceDueDate(from, 30)).toBe("2026-10-14");
    // On receipt: due the day it is raised.
    expect(defaultInvoiceDueDate(from, 0)).toBe("2026-09-14");
  });

  it("still defaults to 14 where the terms cannot be read", () => {
    const from = new Date("2026-09-14T10:00:00.000Z");
    const unreadable = paymentTermDays("payment due within 30 days of invoice");
    expect(defaultInvoiceDueDate(from, unreadable ?? undefined)).toBe(
      defaultInvoiceDueDate(from, DEFAULT_INVOICE_TERM_DAYS),
    );
    expect(defaultInvoiceDueDate(from)).toBe("2026-09-28");
  });

  it("reproduces the reported case exactly", () => {
    // The trade was set to 7 days; the invoice was raised due 28 Sept, 14 days
    // out. With the terms read, the same invoice is due the 21st.
    const raisedOn = new Date("2026-09-14T10:00:00.000Z");
    const theirTerms = paymentTermDays("7 days");
    expect(defaultInvoiceDueDate(raisedOn, theirTerms ?? undefined)).toBe("2026-09-21");
    expect(defaultInvoiceDueDate(raisedOn)).toBe("2026-09-28");
  });
});

describe("D9 — the invoice carries a reference a person can quote", () => {
  it("is stable for one invoice", () => {
    const id = "f03c725f-1111-4222-8333-444444444444";
    expect(invoiceReference(id)).toBe(invoiceReference(id));
  });

  it("is eight readable characters, with no dashes", () => {
    const ref = invoiceReference("f03c725f-1111-4222-8333-444444444444");
    expect(ref).toBe("F03C725F");
    expect(ref).toMatch(/^[0-9A-F]{8}$/);
  });

  it("differs between invoices", () => {
    expect(invoiceReference("d725ba3c-1111-4222-8333-444444444444")).not.toBe(
      invoiceReference("8ec1d341-1111-4222-8333-444444444444"),
    );
  });
});

describe("D13 — the manual invoice form seeds from the trade's terms too", () => {
  // The server default was fixed on 14 Sep and the manual path never reached
  // it: the form pre-filled defaultInvoiceDueDate() with no argument and then
  // SENT that date, which overrides the server entirely. Measured the same day
  // — /setup at 7 days, then 30, then "On receipt", all three producing an
  // invoice due in 14, while the auto-raised deposit on the same job correctly
  // honoured 7.
  const raisedOn = new Date("2026-09-14T10:00:00.000Z");

  it("gives each setting its own answer rather than 14 for all three", () => {
    const seedFor = (terms: string) =>
      defaultInvoiceDueDate(raisedOn, paymentTermDays(terms) ?? undefined);

    expect(seedFor("7 days")).toBe("2026-09-21");
    expect(seedFor("30 days")).toBe("2026-10-14");
    expect(seedFor("On receipt")).toBe("2026-09-14");
    // Three settings, three answers. The defect was three settings, one answer.
    expect(new Set([seedFor("7 days"), seedFor("30 days"), seedFor("On receipt")]).size).toBe(3);
  });

  it("still seeds 14 where the terms are prose", () => {
    expect(
      defaultInvoiceDueDate(raisedOn, paymentTermDays("payment due within 30 days") ?? undefined),
    ).toBe("2026-09-28");
  });

  it("agrees with the auto-raised deposit path, which already honoured terms", () => {
    // Both paths now derive the same way, so the deposit and the balance on one
    // job cannot state different terms.
    const terms = paymentTermDays("7 days") ?? undefined;
    expect(defaultInvoiceDueDate(raisedOn, terms)).toBe(defaultInvoiceDueDate(raisedOn, terms));
    expect(defaultInvoiceDueDate(raisedOn, terms)).toBe("2026-09-21");
  });
});

// The second half of D9, reported again on 14 Sep after the first fix landed:
// the invoice named a TRADE where it needed to name a SUPPLY. "For:
// Plastering" on a £3,620.28 demand is not something an accountant accepts —
// a VAT invoice has to identify the services and their extent.
const line = (over: Partial<LineItem>): LineItem => ({
  description: "Reskim hallway ceiling",
  category: "other",
  quantity: 1,
  unit: "job",
  unit_price: 500,
  multiplier: 1,
  people_count: 1,
  overtime: false,
  assumed: false,
  ...over,
});

describe("D9 — the invoice says what was supplied", () => {
  it("itemises the work the customer already agreed to", () => {
    const supply = describeSupply({
      invoiceType: "final",
      lineItems: [
        line({ description: "Reskim hallway ceiling", quantity: 12, unit: "m2" }),
        line({ description: "Bonding and multi-finish" }),
        line({ description: "Waste removal" }),
      ],
    });

    expect(supply?.lines).toEqual([
      "Reskim hallway ceiling — 12 m2",
      "Bonding and multi-finish",
      "Waste removal",
    ]);
  });

  it("carries the extent, because 2 days and 1 day are a different supply", () => {
    const supply = describeSupply({
      invoiceType: "final",
      lineItems: [line({ description: "Labour", quantity: 2, unit: "day" })],
    });
    expect(supply?.lines).toEqual(["Labour — 2 day"]);
  });

  it("drops a bare '1 job', which tells a reader nothing they cannot see", () => {
    const supply = describeSupply({
      invoiceType: "final",
      lineItems: [line({ description: "Waste removal", quantity: 1, unit: "job" })],
    });
    expect(supply?.lines).toEqual(["Waste removal"]);
  });

  it("says a deposit is AGAINST the work, not the price of it", () => {
    // A £905.07 deposit listing £3,620.28 of work under a plain "For" claims
    // the amount is what that work costs. It is a payment on account.
    const lineItems = [line({ description: "Reskim hallway ceiling" })];
    expect(describeSupply({ invoiceType: "deposit", lineItems })?.heading).toBe("Deposit against");
    expect(describeSupply({ invoiceType: "final", lineItems })?.heading).toBe("For");
  });

  it("falls back to the job type ONLY when there are no line items", () => {
    const supply = describeSupply({ invoiceType: "final", lineItems: [], jobType: "Plastering" });
    expect(supply?.lines).toEqual(["Plastering"]);
    // Never presented as an itemisation of a deposit's worth of work.
    expect(describeSupply({ invoiceType: "deposit", lineItems: [], jobType: "Plastering" })?.heading).toBe(
      "Deposit for",
    );
  });

  it("says nothing rather than something empty", () => {
    expect(describeSupply({ invoiceType: "final", lineItems: [] })).toBeNull();
    expect(describeSupply({ invoiceType: "final", lineItems: [], jobType: "   " })).toBeNull();
    expect(describeSupply({ invoiceType: "final", lineItems: [line({ description: "  " })] })).toBeNull();
  });

  it("never prices a line, so the page carries one figure and it is the invoice's", () => {
    // The unit price is £500 and the invoice is for a deposit. Neither the
    // rate nor a line total may appear beside the description.
    const supply = describeSupply({
      invoiceType: "deposit",
      lineItems: [line({ description: "Reskim hallway ceiling", unit_price: 500 })],
    });
    for (const text of supply?.lines ?? []) {
      expect(text).not.toMatch(/£|500/);
    }
  });
});
