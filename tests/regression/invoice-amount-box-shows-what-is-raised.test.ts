// The Amount box said £1,440.00 and the customer received £1,080.00.
//
// Reported 13 Sep on a £1,440 VAT-registered job whose 25% deposit — £360.00 —
// had already been raised and settled. Marking the work complete opened the
// invoice form with Amount pre-filled **1440.00**, above helper text reading
// "We work out the amount automatically — the deposit from your contract, or
// the balance left on the quote". The invoice the customer actually received
// was £1,080.00, which is the correct balance.
//
// So the server was right and the box was wrong, and wrong in the direction
// that reads as "I am about to bill the whole job again on top of the deposit".
//
// The box is `readOnly` and stays that way: the client sends intent — deposit
// or final — and never a figure, which is what stops a tampered request
// invoicing an arbitrary sum. Read-only is not the same as honest, though, and
// an amount box that names a different number from the one the customer gets
// has failed at the only job it has.
//
// Fixed by deriving the displayed figure from the SAME `deriveInvoiceAmount`
// the server calls, rather than rendering `quoteTotal`. A second
// implementation of the rule is a second thing to keep in step, and this
// mismatch is what one looks like once a deposit lands between them.
import { describe, expect, it } from "vitest";
import {
  previewInvoiceAmount,
  deriveInvoiceAmount,
  type ExistingInvoice,
  type QuoteContract,
} from "@/lib/invoice-amount";

const COMPLETE = { workCompletedAt: "2026-09-13T00:00:00Z" };
const NOT_COMPLETE = { workCompletedAt: null };

const SIGNED_25 = (): QuoteContract => ({ deposit_pct: 25, status: "signed" });

/** The reported job: £1,440 quote, 25% deposit raised and settled. */
const QUOTE_TOTAL = 1440;
const SETTLED_DEPOSIT: ExistingInvoice = { amount: 360, invoice_type: "deposit" };

describe("the reported job", () => {
  it("previews the balance, not the whole quote", () => {
    expect(
      previewInvoiceAmount("final", QUOTE_TOTAL, [SETTLED_DEPOSIT], [SIGNED_25()], COMPLETE),
    ).toBe(1080);
  });

  it("is exactly what the server would raise — one rule, not two", () => {
    // The whole point of the fix: the box cannot drift from the invoice.
    const preview = previewInvoiceAmount(
      "final",
      QUOTE_TOTAL,
      [SETTLED_DEPOSIT],
      [SIGNED_25()],
      COMPLETE,
    );
    const raised = deriveInvoiceAmount(
      "final",
      QUOTE_TOTAL,
      [SETTLED_DEPOSIT],
      [SIGNED_25()],
      COMPLETE,
    );

    expect(preview).toBe(raised);
  });

  it("does not show the figure that was reported", () => {
    expect(
      previewInvoiceAmount("final", QUOTE_TOTAL, [SETTLED_DEPOSIT], [SIGNED_25()], COMPLETE),
    ).not.toBe(1440);
  });

  it("previews the deposit itself before one has been raised", () => {
    expect(previewInvoiceAmount("deposit", QUOTE_TOTAL, [], [SIGNED_25()], NOT_COMPLETE)).toBe(360);
  });
});

describe("a job with no deposit is unchanged", () => {
  it("previews the full quote when nothing has been invoiced", () => {
    expect(previewInvoiceAmount("final", 1414, [], [], COMPLETE)).toBe(1414);
  });
});

describe("null is the honest answer, not zero", () => {
  // Each of these is a legitimate state for a form that has not been submitted.
  // The server still authors the refusal message on submit; the box just says
  // "Auto" until the figure is knowable.
  it("has no final figure before the work is marked complete", () => {
    expect(previewInvoiceAmount("final", QUOTE_TOTAL, [], [SIGNED_25()], NOT_COMPLETE)).toBeNull();
  });

  it("has no deposit figure when the contract sets no percentage", () => {
    expect(
      previewInvoiceAmount("deposit", QUOTE_TOTAL, [], [{ deposit_pct: null, status: "signed" }], NOT_COMPLETE),
    ).toBeNull();
  });

  it("has no deposit figure once a deposit has been raised", () => {
    expect(
      previewInvoiceAmount("deposit", QUOTE_TOTAL, [SETTLED_DEPOSIT], [SIGNED_25()], COMPLETE),
    ).toBeNull();
  });

  it("has no final figure once the quote is fully invoiced", () => {
    expect(
      previewInvoiceAmount(
        "final",
        QUOTE_TOTAL,
        [SETTLED_DEPOSIT, { amount: 1080, invoice_type: "final" }],
        [SIGNED_25()],
        COMPLETE,
      ),
    ).toBeNull();
  });

  it("never throws where deriveInvoiceAmount would", () => {
    // The form renders on every keystroke of the type toggle; a throwing
    // preview would take the page down rather than show "Auto".
    expect(() =>
      previewInvoiceAmount("final", QUOTE_TOTAL, [], [], NOT_COMPLETE),
    ).not.toThrow();
    expect(() => deriveInvoiceAmount("final", QUOTE_TOTAL, [], [], NOT_COMPLETE)).toThrow();
  });
});
