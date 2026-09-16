// The SECOND VAT path, and what a half-fix cost.
//
// #748 changed `vatToSetAside` to read `invoices.vat_amount`, and I reported
// D14 as fixed. It was not. `computeVATPosition` — which feeds "VAT collected
// (all time)" — is a separate computation over a separate query, and it still
// took a sixth of gross from every paid invoice. The 14 Sep review measured it:
// settling a £740 job whose quote and both invoices record £0.00 VAT moved the
// figure by exactly £123.33, which is 740 ÷ 6.
//
// The half-fix also made the money card stop footing. One line read the record
// and the other did not, so "Net through motko, all time" disagreed with its
// own itemisation by £246.64 — two zero-VAT settlements' worth. Before the
// half-fix both lines were wrong and agreed; after it, one was right and they
// did not.
//
// This pins the rule both paths now share: a RECORDED amount wins, including
// when it is zero, and a sixth of gross is the fallback only for invoices
// raised before migration 80 recorded anything.
import { describe, expect, it } from "vitest";
import { computeVATPosition, paidInvoiceVat, showsVatPosition } from "@/lib/money-position-math";

describe("the VAT inside one paid invoice", () => {
  // This is the rule that was wrong. computeVATPosition below sums whatever it
  // is handed and was never the defect — testing only that would be a stub
  // checking the answer it was given.
  it("takes the recorded amount", () => {
    expect(paidInvoiceVat({ amount: 3200.28, vat_amount: 533.38 })).toBe(533.38);
  });

  it("takes a recorded ZERO rather than a sixth of gross", () => {
    // The reported case: £740 recorded at nil. A sixth would be £123.33.
    expect(paidInvoiceVat({ amount: 740, vat_amount: 0 })).toBe(0);
    expect(paidInvoiceVat({ amount: 222, vat_amount: 0 })).toBe(0);
    expect(paidInvoiceVat({ amount: 518, vat_amount: 0 })).toBe(0);
  });

  it("falls back to a sixth only where nothing was recorded", () => {
    // An invoice raised before migration 80. Still the best guess available.
    expect(paidInvoiceVat({ amount: 740, vat_amount: null })).toBe(123.33);
    expect(paidInvoiceVat({ amount: 740 })).toBe(123.33);
  });
});

describe("VAT collected reads what was charged", () => {
  it("is nil on a job that recorded no VAT", () => {
    // Rhys's job: £222 deposit and £518 balance, both recorded at £0.00.
    // The reported movement was +£123.33.
    const position = computeVATPosition(
      [
        { id: "dep", amount: 222, vatAmount: 0 },
        { id: "bal", amount: 518, vatAmount: 0 },
      ],
      [],
    );
    expect(position.collected).toBe(0);
  });

  it("is the recorded figure on a job that did charge VAT", () => {
    // Nadia's: £3,200.28 gross, £533.38 recorded.
    expect(computeVATPosition([{ id: "n", amount: 3200.28, vatAmount: 533.38 }], []).collected).toBe(
      53338,
    );
  });

  it("does not take a sixth of gross when the record says otherwise", () => {
    // A sixth of £740 is £123.33. That figure must not appear anywhere.
    const sixth = Math.round((740 / 6) * 100);
    const collected = computeVATPosition([{ id: "r", amount: 740, vatAmount: 0 }], []).collected;
    expect(collected).not.toBe(sixth);
    expect(collected).toBe(0);
  });

  it("nets VAT on costs off the VAT collected", () => {
    // Unchanged behaviour, pinned so the fix above does not disturb it.
    const position = computeVATPosition(
      [{ id: "n", amount: 3200.28, vatAmount: 533.38 }],
      [{ id: "c", vatAmount: 10000 }],
    );
    expect(position.onCosts).toBe(10000);
    expect(position.position).toBe(43338);
  });
});

// THE THIRD COMPUTATION, found by the pass-5 review after I had twice reported
// D14 fixed.
//
// There were three independent VAT sums over three queries. #748 fixed one, the
// all-time `vatToSetAside` fixed a second, and the QUARTER figure still took a
// sixth of gross. Measured: settling a £600.00 invoice whose recorded VAT is
// £0.00, on an unregistered trade's job, moved "VAT to set aside" by exactly
// £100.00.
//
// The visible symptom was one card carrying two figures that could not both be
// right — "VAT to set aside −£5,107.61" beside "VAT collected (all time)
// £4,760.97", £346.64 apart, which is precisely the phantom VAT on the three
// zero-VAT jobs (£123.33 + £123.33 + £100.00). Two derived bottom lines
// followed them down.
//
// Pinned as the shared rule rather than as three call sites, because the defect
// each time was a site that did not use it.
describe("every VAT sum on the money card uses one rule", () => {
  it("takes a recorded zero on the reported £600 invoice", () => {
    // The measurement, exactly: £600 recorded at nil must move nothing.
    expect(paidInvoiceVat({ amount: 600, vat_amount: 0 })).toBe(0);
  });

  it("does not produce the £346.64 gap between the two card figures", () => {
    // The three zero-VAT jobs that caused it. Summed under one rule they
    // contribute nothing, so the two figures cannot diverge.
    const zeroVatJobs = [
      { amount: 740, vat_amount: 0 },
      { amount: 740, vat_amount: 0 },
      { amount: 600, vat_amount: 0 },
    ];
    const underOneRule = zeroVatJobs.reduce((sum, inv) => sum + paidInvoiceVat(inv), 0);
    expect(underOneRule).toBe(0);

    // What the un-fixed site produced from the same three rows.
    const sixths = zeroVatJobs.reduce((sum, inv) => sum + Math.round((inv.amount * 100) / 6) / 100, 0);
    expect(Math.round(sixths * 100)).toBe(34666);
  });
});

// DEREGISTERING DOES NOT UNDO WHAT WAS CHARGED.
//
// Every VAT figure on the card was gated on `vat_registered` alone, so unticking
// the box did not move them — it deleted them. Measured 15 Sep: with the box on,
// "VAT to set aside −£3,075.36" and "VAT collected (all time) £3,075.36"; with it
// off and the page reloaded, BOTH ROWS GONE. The invoices behind them still
// display GB123456789 to the customer.
//
// Pinned as the shared rule, for the reason the rule above it is: three call
// sites, and the defect each time was the one that did not use it.
describe("whether the card shows a VAT position", () => {
  it("shows it for a registered trade", () => {
    expect(showsVatPosition({ vatRegistered: true, hasChargedVat: false })).toBe(true);
  });

  it("KEEPS showing it after the trade deregisters", () => {
    // The reported case: £3,075.36 of VAT charged and collected, box unticked.
    // The liability belongs to the invoices, not to the checkbox.
    expect(showsVatPosition({ vatRegistered: false, hasChargedVat: true })).toBe(true);
  });

  it("shows nothing to a trade that has never charged VAT", () => {
    // The case the gate was actually for, and the only one it should catch.
    expect(showsVatPosition({ vatRegistered: false, hasChargedVat: false })).toBe(false);
  });

  it("does not depend on the flag once VAT has been charged", () => {
    // Toggling the box cannot move the answer in either direction.
    expect(showsVatPosition({ vatRegistered: true, hasChargedVat: true })).toBe(
      showsVatPosition({ vatRegistered: false, hasChargedVat: true }),
    );
  });
});
