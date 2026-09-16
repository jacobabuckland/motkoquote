// Migration 83 lets a quote carry withdrawn and declined contracts as history,
// and `pickDepositPct` fell back to ANY contract carrying a percentage.
//
// While `contracts.quote_id` was UNIQUE a quote had exactly one contract, so
// "any contract with a percentage" WAS "the contract" and the fallback was
// exact. With history rows it can land on a dead one — and PostgREST does not
// promise the array's order — so a job withdrawn at 25% and re-issued at 10%
// could invoice the customer the 25% from a document nobody is party to.
//
// These pin the restored invariant: only a LIVE contract may set the deposit.
import { describe, expect, it } from "vitest";
import { deriveInvoiceAmount } from "@/lib/invoice-amount";

const job = { workCompletedAt: null };

describe("the deposit comes from a contract that still stands", () => {
  it("ignores a withdrawn contract's percentage in favour of the live one", () => {
    // The reported shape: withdrawn at 25%, re-issued at 10%. £1,000 quote.
    const contracts = [
      { status: "withdrawn", deposit_pct: 25 },
      { status: "sent", deposit_pct: 10 },
    ];

    expect(deriveInvoiceAmount("deposit", 1000, [], contracts, job)).toBe(100);
  });

  it("does the same whichever order the embed returns them in", () => {
    // The order is not promised, so the answer must not depend on it.
    const contracts = [
      { status: "sent", deposit_pct: 10 },
      { status: "withdrawn", deposit_pct: 25 },
    ];

    expect(deriveInvoiceAmount("deposit", 1000, [], contracts, job)).toBe(100);
  });

  it("ignores a declined contract's percentage too", () => {
    const contracts = [
      { status: "declined", deposit_pct: 50 },
      { status: "sent", deposit_pct: 20 },
    ];

    expect(deriveInvoiceAmount("deposit", 1000, [], contracts, job)).toBe(200);
  });

  it("still prefers a signed contract over everything", () => {
    // The common path, and it must not move: the deposit invoice is raised on
    // signature, and a signed contract is live by definition.
    const contracts = [
      { status: "withdrawn", deposit_pct: 25 },
      { status: "signed", deposit_pct: 15 },
      { status: "sent", deposit_pct: 10 },
    ];

    expect(deriveInvoiceAmount("deposit", 1000, [], contracts, job)).toBe(150);
  });

  it("refuses rather than charging a withdrawn contract's deposit when nothing is live", () => {
    // Every contract is dead, so there is no agreed percentage. Falling back to
    // the withdrawn one would invoice a figure nobody currently agrees to, so
    // this must refuse — the same refusal as a quote with no contract at all.
    const contracts = [
      { status: "withdrawn", deposit_pct: 25 },
      { status: "declined", deposit_pct: 30 },
    ];

    expect(() => deriveInvoiceAmount("deposit", 1000, [], contracts, job)).toThrow();
  });

  it("is unchanged on the single live contract that is still the normal case", () => {
    expect(deriveInvoiceAmount("deposit", 1000, [], [{ status: "sent", deposit_pct: 25 }], job)).toBe(
      250,
    );
  });
});
