import { describe, expect, it } from "vitest";
import { planPaidJobSettlement, type PaidJobFacts } from "@/lib/paid-job-settlement";

const facts = (over: Partial<PaidJobFacts> = {}): PaidJobFacts => ({
  jobId: "job-1",
  contractorId: "trade-1",
  jobValuePennies: 50_000,
  freeJobsRemaining: 0,
  isFirstPaidJob: false,
  pendingReferral: null,
  ...over,
});

describe("FEE-2: Cap what one free job can waive at the base band", () => {
  // RETIRED by FEE-6: entire "Large jobs (> £1,000) with free credit — partial waiver" section
  // Superseded by marginal ladder (decision 31 Aug 2026)

  // RETIRED by SUB-3, 7 Sep 2026: the last assertion in each of "Base band jobs
  // (≤ £1,000) with free credit" and "Jobs without free credit — no waiver", and
  // with them the sections themselves. There is no base band under the schedule
  // that replaces the ladder (0.99% + 39.6p, capped at £9.90, spec §3.2), and
  // FEE-11 had already made the waiver unbounded — SUB-3 only completes it on the
  // Stripe call site, which was still waiving £2. Named on the card and approved
  // by Jacob the same day.

  describe("Invariants and accounting properties", () => {
    // RETIRED by FEE-11 (#466), 1 Sep 2026: "waived amount never exceeds
    // base-band fee". One assertion, and only this one.
    //
    // It pins FEE-2's ceiling — a credit waives at most the base-band fee and
    // the remainder is charged. FEE-11's card supersedes that rule by name:
    // "Supersedes FEE-2's base-band waiver rule, which has no meaning once
    // FEE-6 removes the bands." There is no base band; the nearest structural
    // equivalent left is the £2.00 floor, and waiving £2 of a £43 fee is not
    // recognisably a free job. Decision recorded 30 Aug (Jacob), reconfirmed
    // 1 Sep after FEE-7 was dropped changed one of its stated reasons.
    //
    // #487 (FEE-7) hit this same failure and was told NOT to retire it —
    // "that is FEE-11's job, and this card explicitly defers to it". This is
    // that job.
    //
    // What replaces it, so the property is not merely dropped: the waiver is
    // still bounded, by the fee itself rather than by a band. "waived amount is
    // never negative" below is untouched, and FEE-11 adds an assertion that
    // waived + payable equals the full computed fee — which is the invariant
    // this one was a special case of.

    // RETIRED by FEE-6: "sum of payable and waived equals the full computed fee"
    // Superseded by marginal ladder (decision 31 Aug 2026)

    it("waived amount is never negative", () => {
      const plan = planPaidJobSettlement(
        facts({ jobValuePennies: 150_000, freeJobsRemaining: 1 }),
      );

      expect(plan.fee.feeWaivedAmountPennies).toBeGreaterThanOrEqual(0);
    });

    it("payable amount is never negative", () => {
      const testCases = [
        { jobValuePennies: 10_000, freeJobsRemaining: 1 },
        { jobValuePennies: 150_000, freeJobsRemaining: 1 },
      ];

      for (const testCase of testCases) {
        const plan = planPaidJobSettlement(facts(testCase));
        expect(plan.fee.feeAmountPennies).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe("VAT split is computed from payable amount only", () => {
    // RETIRED by FEE-6: "calculates net and VAT from the payable amount, not the full or waived amount"
    // Superseded by marginal ladder (decision 31 Aug 2026)

    it("VAT split for a fully waived job is all zeros", () => {
      const plan = planPaidJobSettlement(
        facts({ jobValuePennies: 50_000, freeJobsRemaining: 1 }),
      );

      expect(plan.fee.feeAmountPennies).toBe(0);
      expect(plan.fee.feeNetPennies).toBe(0);
      expect(plan.fee.feeVatPennies).toBe(0);
    });

    // RETIRED by FEE-6: "VAT split for a full-price job (no credit) is based on full fee"
    // Superseded by marginal ladder (decision 31 Aug 2026)
  });

  describe("Credit consumption behavior", () => {
    it("consumes exactly one credit when waiver applies, regardless of payable remainder", () => {
      const testCases = [
        { jobValuePennies: 50_000, freeJobsRemaining: 5 },   // Full waiver
        { jobValuePennies: 150_000, freeJobsRemaining: 5 },  // Partial waiver
      ];

      for (const testCase of testCases) {
        const plan = planPaidJobSettlement(facts(testCase));
        const consumptionEvents = plan.ledger.filter((e) => e.reason === "job_consumed");
        expect(consumptionEvents).toHaveLength(1);
        expect(consumptionEvents[0]?.delta).toBe(-1);
      }
    });

    it("consumes no credit when allowance is already exhausted", () => {
      const plan = planPaidJobSettlement(
        facts({ jobValuePennies: 150_000, freeJobsRemaining: 0 }),
      );

      const consumptionEvents = plan.ledger.filter((e) => e.reason === "job_consumed");
      expect(consumptionEvents).toHaveLength(0);
    });
  });

  describe("Type signature change", () => {
    it("JobFeeOutcome includes feeWaivedAmountPennies field", () => {
      const plan = planPaidJobSettlement(
        facts({ jobValuePennies: 150_000, freeJobsRemaining: 1 }),
      );

      // Type check: the field exists and is a number
      expect(plan.fee).toHaveProperty("feeWaivedAmountPennies");
      expect(typeof plan.fee.feeWaivedAmountPennies).toBe("number");
    });
  });
});
