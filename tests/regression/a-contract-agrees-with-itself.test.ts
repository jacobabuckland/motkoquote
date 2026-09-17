// PASS-14 SERIOUS 1: a withdrawn or declined contract showed the LIVE quote's
// money in its summary, contradicting its own clauses.
//
// The summary box at the top of a public contract page was computed from the
// quote; the clause bodies below it are frozen at send time in `rendered_body`.
// Once the quote moved, the same page stated two different totals:
//
//   Summary header   Total £1,800.00   Deposit £600.00
//   Clause 2 Price   Total £1,440.00
//   Clause 3 Payment                   Deposit £360.00
//
// A customer opening the link they were emailed at £1,440 saw £1,800 in bold at
// the top — the two surfaces disagreeing by £360 on one page, and the bold one
// is the one that gets read.
//
// Nothing is added to the schema. `contracts.variables_json` has stored the
// rendered money since the table was created, and the clause text is produced
// from exactly these values, so reading them back is reading the document
// rather than forming a second opinion about it.
import { describe, expect, it } from "vitest";
import { contractMoney, parseFormattedGBP } from "@/lib/contract-money";

// The reported contract: emailed at £1,440 with a £360 deposit, on a quote that
// has since been re-issued at £1,800 with a £600 deposit.
const asIssued = {
  total_price: "£1,440.00",
  deposit_amount: "£360.00",
  subtotal: "£1,200.00",
  vat_amount: "£240.00",
};

const asTheQuoteReadsNow = { total: 1800, deposit: 600 };

describe("a contract's summary states what the contract says", () => {
  it("shows the total it was issued at, not the quote's total today", () => {
    expect(contractMoney(asIssued, asTheQuoteReadsNow).total).toBe(1440);
  });

  it("shows the deposit it was issued with", () => {
    expect(contractMoney(asIssued, asTheQuoteReadsNow).deposit).toBe(360);
  });

  it("derives the balance from those two, so all three agree", () => {
    // £1,080, which is what clause 3 promises. The header said £1,200.
    expect(contractMoney(asIssued, asTheQuoteReadsNow).balance).toBe(1080);
  });

  it("reads a total with a thousands separator", () => {
    // formatGBP writes £1,440.00. A parser that chokes on the comma gets 1.44
    // or NaN, and a silently wrong total here is worse than the bug.
    expect(parseFormattedGBP("£1,440.00")).toBe(1440);
    expect(parseFormattedGBP("£12,345.67")).toBe(12345.67);
  });
});

describe("a contract issued with no deposit", () => {
  // `deposit_amount` is the EMPTY STRING when no deposit was agreed — the
  // template renderer has no {{^var}}, so absence is expressed this way.
  const noDeposit = { ...asIssued, deposit_amount: "" };

  it("does not borrow a deposit the quote gained later", () => {
    // The load-bearing case. Falling through to the live figure here would put
    // a £600 deposit on a document that promises none — the same class of
    // defect from the other direction.
    expect(contractMoney(noDeposit, asTheQuoteReadsNow).deposit).toBeNull();
  });

  it("bills the whole total on completion", () => {
    expect(contractMoney(noDeposit, asTheQuoteReadsNow).balance).toBe(1440);
  });

  it("keeps null distinct from a deposit of zero", () => {
    // "No deposit" and "a deposit of nothing" are different statements, and
    // conflating them is how a 100%-deposit contract came to promise a balance.
    expect(contractMoney({ ...asIssued, deposit_amount: "£0.00" }, asTheQuoteReadsNow).deposit).toBe(0);
  });
});

describe("a contract with nothing frozen to read", () => {
  it("falls back to the live figures rather than showing a blank", () => {
    // A contract raised before these variables existed must keep rendering
    // exactly as it does now. A missing total is worse than a stale one.
    expect(contractMoney(null, asTheQuoteReadsNow)).toEqual({
      total: 1800,
      deposit: 600,
      balance: 1200,
    });
  });

  it("falls back when the stored value is unreadable", () => {
    expect(contractMoney({ total_price: "n/a" }, asTheQuoteReadsNow).total).toBe(1800);
  });

  it("is not fooled by a non-object", () => {
    expect(contractMoney("nonsense", asTheQuoteReadsNow).total).toBe(1800);
    expect(contractMoney(42, asTheQuoteReadsNow).total).toBe(1800);
  });
});

describe("a live contract, where the quote cannot have moved", () => {
  it("reads the same either way, which is why this is not special-cased", () => {
    // A sent, unsigned contract locks its quote against editing, so frozen and
    // live agree. Preferring frozen changes nothing here and leaves no path
    // back to the divergence if that guard is ever bypassed.
    const inStep = { total: 1440, deposit: 360 };

    expect(contractMoney(asIssued, inStep)).toEqual({
      total: 1440,
      deposit: 360,
      balance: 1080,
    });
  });
});
