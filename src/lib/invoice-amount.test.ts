import { describe, it, expect } from "vitest";
import { deriveInvoiceAmount } from "@/lib/invoice-amount";

const signedContract = (pct: number | null) => ({ deposit_pct: pct, status: "signed" });

/** A job the trade has marked finished — the only state a Final is legal in. */
const COMPLETE = { workCompletedAt: "2026-08-30T09:00:00Z" };
/** A job still in progress, which is every job until someone says otherwise. */
const IN_PROGRESS = { workCompletedAt: null };

describe("deriveInvoiceAmount — deposit", () => {
  it("derives the deposit from the signed contract's percentage, ignoring any client intent", () => {
    const amount = deriveInvoiceAmount("deposit", 1000, [], [signedContract(25)], IN_PROGRESS);
    expect(amount).toBe(250);
  });

  it("rounds to pennies", () => {
    const amount = deriveInvoiceAmount("deposit", 999.99, [], [signedContract(33)], IN_PROGRESS);
    expect(amount).toBe(330); // round(329.9967)
  });

  it("refuses a second deposit", () => {
    expect(() =>
      deriveInvoiceAmount(
        "deposit",
        1000,
        [{ amount: 250, invoice_type: "deposit" }],
        [signedContract(25)],
        IN_PROGRESS,
      ),
    ).toThrow(/already been raised/i);
  });

  it("refuses a deposit when no contract sets a percentage", () => {
    expect(() =>
      deriveInvoiceAmount("deposit", 1000, [], [signedContract(null)], IN_PROGRESS),
    ).toThrow(
      /deposit percentage/i,
    );
    expect(() => deriveInvoiceAmount("deposit", 1000, [], [], IN_PROGRESS)).toThrow(/deposit percentage/i);
  });

  it("prefers a signed contract's percentage over an unsigned one", () => {
    const amount = deriveInvoiceAmount(
      "deposit",
      1000,
      [],
      [
        { deposit_pct: 10, status: "sent" },
        { deposit_pct: 40, status: "signed" },
      ],
      IN_PROGRESS,
    );
    expect(amount).toBe(400);
  });
});

describe("deriveInvoiceAmount — final", () => {
  it("is the quote total when nothing has been invoiced yet", () => {
    expect(deriveInvoiceAmount("final", 1000, [], [], COMPLETE)).toBe(1000);
  });

  it("is the balance after an existing deposit — never the full total again", () => {
    const amount = deriveInvoiceAmount(
      "final",
      1000,
      [{ amount: 250, invoice_type: "deposit" }],
      [signedContract(25)],
      COMPLETE,
    );
    expect(amount).toBe(750);
  });

  it("refuses a final invoice once the quote is fully invoiced", () => {
    expect(() =>
      deriveInvoiceAmount(
        "final",
        1000,
        [
          { amount: 250, invoice_type: "deposit" },
          { amount: 750, invoice_type: "final" },
        ],
        [signedContract(25)],
        COMPLETE,
      ),
    ).toThrow(/fully invoiced/i);
  });
});

describe("deriveInvoiceAmount — invoiced sum never exceeds the quote total", () => {
  it("caps the sum of all raised invoices at the quote total across deposit then final", () => {
    const total = 1000;
    const deposit = deriveInvoiceAmount("deposit", total, [], [signedContract(30)], IN_PROGRESS);
    const raised = [{ amount: deposit, invoice_type: "deposit" }];
    const final = deriveInvoiceAmount("final", total, raised, [signedContract(30)], COMPLETE);
    expect(deposit + final).toBe(total);
  });
});

// THE DEFECT (Bugs board, Quote Flow defect review 28 Aug, §7 ticket I1 —
// severity Critical, legal exposure).
//
// With the quote accepted, the contract awaiting signature and no work done,
// the app offered a Final invoice for the full quote value, pre-filled and one
// tap from sending. A final invoice asserts the work is complete; the contract
// was not in force; and demanding payment in full from a domestic customer
// before signature is the exact pattern consumers are warned about.
//
// There was no gate because there was nothing to gate on — `StageKey` stopped
// at `invoiced` and no `work_completed_at` existed anywhere in the tree. #419
// added the state, which is what unblocked this.
//
// Jacob's D10 answer (areas/motko.md, 28 Aug) permits a Deposit or Materials
// invoice before completion — with a warning in the UI while the contract is
// unsigned — so the deposit cases above deliberately pass a job still in
// progress. Both readings of the review agreed Final is never available before
// completion, and that is what these pin.
describe("deriveInvoiceAmount — a final invoice asserts the work is done", () => {
  it("refuses a final invoice on a job that is not marked complete", () => {
    expect(() => deriveInvoiceAmount("final", 1000, [], [], IN_PROGRESS)).toThrow(
      /mark the work complete/i,
    );
  });

  it("refuses it for the full quote value, which is the reported shape", () => {
    // Quote accepted, contract unsigned, nothing invoiced, no work done — the
    // exact state in the review, where the offered figure was the whole quote.
    expect(() =>
      deriveInvoiceAmount("final", 4800, [], [{ deposit_pct: null, status: "sent" }], IN_PROGRESS),
    ).toThrow(/mark the work complete/i);
  });

  it("refuses it even when a contract is signed, if the work is not done", () => {
    // Signature is not completion. The review's stricter recommendation stopped
    // at signature; the decision that was taken goes further for Final.
    expect(() =>
      deriveInvoiceAmount("final", 1000, [], [signedContract(25)], IN_PROGRESS),
    ).toThrow(/mark the work complete/i);
  });

  it("allows it once the work is marked complete", () => {
    expect(deriveInvoiceAmount("final", 1000, [], [signedContract(25)], COMPLETE)).toBe(1000);
  });

  it("still allows a deposit while the work is in progress", () => {
    // The half D10 changed. Blocking this would be the review's stricter
    // recommendation, which was explicitly not the answer given — some trades
    // bill up front on materials-heavy jobs, and refusing reads as the software
    // telling them how to run their business.
    expect(deriveInvoiceAmount("deposit", 1000, [], [signedContract(25)], IN_PROGRESS)).toBe(250);
  });

  it("names the way out in the refusal, rather than only refusing", () => {
    // A trade who has just been stopped needs to know what they CAN send.
    let message = "";
    try {
      deriveInvoiceAmount("final", 1000, [], [signedContract(25)], IN_PROGRESS);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/deposit invoice/i);
  });
});
