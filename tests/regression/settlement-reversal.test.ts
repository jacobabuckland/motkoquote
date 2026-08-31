/**
 * FEE-10's rules, and the guarantee that the terms say the same thing.
 *
 * The card's own note is why the assertions are shaped this way: "This is a
 * small ticket with a disproportionate trust cost if it is discovered rather
 * than disclosed. The clause matters more than the code." So there are two
 * classes of test here — what a reversal does to the stored fees, and whether
 * the published clause matches it. A correct rule nobody wrote down is not
 * enforceable, and a clause the code contradicts is worse than no clause.
 *
 * There is no refund path in the product; FEE-10 is explicitly a ledger and
 * terms change with any refund UI out of scope. These tests therefore pin the
 * DECISION so that whoever builds the refund path calls the planner rather than
 * deciding again, and so that "no code path reclaims a fee from Stripe" is a
 * standing guard rather than a fact about today.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { summariseAccruedFees } from "@/lib/fee-statement";
import {
  REVERSAL_CLAUSE,
  countsAsFutureRevenue,
  planSettlementReversal,
  type SettlementFees,
} from "@/lib/settlement-reversal";

const settled = (overrides: Partial<SettlementFees> = {}): SettlementFees => ({
  feeAmountPennies: 1_500,
  feeWaivedAmountPennies: 0,
  processingFeeActualPennies: 500,
  freeCreditConsumed: false,
  ...overrides,
});

describe("a reversal never alters the stored fees", () => {
  it("leaves the service fee and the processing column untouched", () => {
    const fees = settled();
    const plan = planSettlementReversal({
      fees,
      refundPennies: 500_000,
      paymentPennies: 500_000,
      settled: true,
    });

    expect(plan.fees).toEqual(fees);
    expect(plan.fees.feeAmountPennies).toBe(1_500);
    expect(plan.fees.processingFeeActualPennies).toBe(500);
  });

  it("does not pro-rate on a partial refund", () => {
    // The intuitive behaviour, and the wrong one. A £5,000 job refunded by
    // £1,000 keeps its whole £15 fee.
    const plan = planSettlementReversal({
      fees: settled(),
      refundPennies: 100_000,
      paymentPennies: 500_000,
      settled: true,
    });

    expect(plan.partial).toBe(true);
    expect(plan.fees.feeAmountPennies).toBe(1_500);
    expect(plan.retainedFeePennies).toBe(1_500);
  });

  it("reports a full refund as not partial", () => {
    const plan = planSettlementReversal({
      fees: settled(),
      refundPennies: 500_000,
      paymentPennies: 500_000,
      settled: true,
    });
    expect(plan.partial).toBe(false);
  });

  it("never restores a consumed free-job credit — FEE-2's rule, unchanged", () => {
    const plan = planSettlementReversal({
      fees: settled({ freeCreditConsumed: true, feeWaivedAmountPennies: 200 }),
      refundPennies: 500_000,
      paymentPennies: 500_000,
      settled: true,
    });

    expect(plan.creditRestorations).toEqual([]);
    expect(plan.fees.freeCreditConsumed).toBe(true);
    expect(plan.fees.feeWaivedAmountPennies).toBe(200);
  });
});

describe("a pre-settlement reversal is a different thing", () => {
  // The card requires these be distinguishable. They look identical in the fee
  // columns — both retain nothing — and mean opposite things: one is "no fee
  // was ever due", the other is "a fee was due and is kept".
  it("has its own state", () => {
    const before = planSettlementReversal({
      fees: settled({ feeAmountPennies: 0, processingFeeActualPennies: null }),
      refundPennies: 500_000,
      paymentPennies: 500_000,
      settled: false,
    });
    const after = planSettlementReversal({
      fees: settled(),
      refundPennies: 500_000,
      paymentPennies: 500_000,
      settled: true,
    });

    expect(before.state).toBe("reversed_before_settlement");
    expect(after.state).toBe("reversed_after_settlement");
    expect(before.state).not.toBe(after.state);
  });

  it("retains nothing, because nothing was charged", () => {
    const plan = planSettlementReversal({
      fees: settled(),
      refundPennies: 500_000,
      paymentPennies: 500_000,
      settled: false,
    });
    expect(plan.retainedFeePennies).toBe(0);
    expect(plan.retainedProcessingPennies).toBe(0);
  });
});

describe("the money position does not count a reversed fee as still to come", () => {
  const row = (feeAmountPennies: number, settlementState?: string | null) => ({
    feeAmountPennies,
    netPennies: feeAmountPennies,
    vatPennies: 0,
    ...(settlementState === undefined ? {} : { settlementState }),
  });

  it("excludes a reversed settlement from the accrued total", () => {
    const totals = summariseAccruedFees([
      row(1_000),
      row(1_500, "reversed_after_settlement"),
    ]);

    expect(totals.grossPennies).toBe(1_000);
    expect(totals.jobCount).toBe(1);
  });

  it("excludes a pre-settlement reversal too", () => {
    const totals = summariseAccruedFees([row(1_000), row(0, "reversed_before_settlement")]);
    expect(totals.jobCount).toBe(1);
  });

  it("treats a row with no state as an ordinary live settlement", () => {
    // Every row was stateless before this field existed. Reading absent as
    // "live" keeps them counted; reading it as "reversed" would silently zero
    // the whole statement.
    expect(summariseAccruedFees([row(1_000), row(500, null)]).grossPennies).toBe(1_500);
  });

  it("agrees with countsAsFutureRevenue, which is the single rule", () => {
    expect(countsAsFutureRevenue(null)).toBe(true);
    expect(countsAsFutureRevenue("accrued")).toBe(true);
    expect(countsAsFutureRevenue("reversed_after_settlement")).toBe(false);
    expect(countsAsFutureRevenue("reversed_before_settlement")).toBe(false);
  });
});

describe("no code path reclaims a fee from Stripe", () => {
  // FEE-10's third acceptance criterion, as a standing guard rather than a
  // fact about today. A future refund implementation reaching for
  // `refund_application_fee` is the specific mistake — it is a real Stripe
  // parameter, it is what an implementer would reach for, and it would hand
  // back a fee the terms say is kept.
  //
  // Named parameters, not a prose regex: this asserts an API call is absent,
  // which is a behaviour of the integration, not a claim about how any file is
  // written.
  const stripeModule = readFileSync(
    join(__dirname, "..", "..", "src", "lib", "stripe-payments.ts"),
    "utf8",
  );

  it.each([
    "refund_application_fee",
    "reverse_transfer",
    "applicationFeeRefund",
  ])("never passes %s", (parameter) => {
    expect(stripeModule).not.toContain(parameter);
  });
});

describe("the published clause says what the code does", () => {
  const terms = readFileSync(
    join(__dirname, "..", "..", "src", "app", "terms", "page.tsx"),
    "utf8",
  );

  // Asserted by REFERENCE, not by text. The page renders REVERSAL_CLAUSE, so
  // the clause and the planner cannot state different rules — and this test
  // fails if someone replaces the reference with a hand-typed paragraph, which
  // is the drift it exists to catch.
  it.each(Object.keys(REVERSAL_CLAUSE))("renders the %s clause from the shared constant", (key) => {
    expect(terms).toContain(`REVERSAL_CLAUSE.${key}`);
  });

  it("states all four rules the card requires", () => {
    expect(REVERSAL_CLAUSE.serviceFee).toMatch(/not refunded/i);
    expect(REVERSAL_CLAUSE.processingFee).toMatch(/keeps its processing cost/i);
    expect(REVERSAL_CLAUSE.partialRefund).toMatch(/full fee on that payment still stands/i);
    expect(REVERSAL_CLAUSE.freeCredit).toMatch(/not returned/i);
  });

  it("says why the service fee is kept, rather than only that it is", () => {
    // The trust cost the card warns about is in the discovery, not the rule.
    // A clause that asserts a charge without a reason reads as a penalty.
    expect(REVERSAL_CLAUSE.serviceFee).toMatch(/work that has already happened/i);
  });
});
