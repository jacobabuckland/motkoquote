/**
 * FEE-11 — the full waiver, and the cap that replaces the ceiling it removed.
 *
 * FEE-1 removed the cap on banked credits in favour of unlimited stacking, on
 * the reasoning that FEE-2's base-band ceiling was the remaining control on
 * leakage. FEE-11 removes that ceiling, so the cap has to replace it as the
 * bound — and the exposure it bounds falls hardest on the best-connected
 * contractors, the ones who refer, who would otherwise waive the most.
 *
 * Both halves are asserted here because neither had coverage: the acceptance
 * file pinned FEE-2's ceiling (retired in this branch's first commit) and
 * nothing anywhere tested a grant against a balance.
 */

import { describe, expect, it } from "vitest";

import {
  MAX_BANKED_FREE_JOBS,
  motkoFeePennies,
  waiverSplit,
} from "@/lib/motko-fee";
import { planPaidJobSettlement, type PaidJobFacts } from "@/lib/paid-job-settlement";

const facts = (overrides: Partial<PaidJobFacts> = {}): PaidJobFacts => ({
  jobId: "job-1",
  contractorId: "c-1",
  jobValuePennies: 900_000,
  freeJobsRemaining: 1,
  isFirstPaidJob: false,
  ...overrides,
});

describe("a credit waives the whole fee, at any job size", () => {
  it.each([50_000, 100_000, 900_000, 2_200_000])(
    "waives all of the fee on a %i-penny job",
    (jobValuePennies) => {
      const plan = planPaidJobSettlement(facts({ jobValuePennies }));
      const fullFee = motkoFeePennies(jobValuePennies, 0);

      expect(plan.fee.feeWaivedAmountPennies).toBe(fullFee);
      expect(plan.fee.feeAmountPennies).toBe(0);
      expect(plan.fee.feeWaivedReason).toBe("free_allowance");
      expect(plan.fee.feeStatus).toBe("not_applicable");
    },
  );

  it("keeps waived plus payable equal to the full fee — the invariant FEE-2's ceiling was a case of", () => {
    for (const jobValuePennies of [50_000, 450_000, 2_200_000]) {
      const plan = planPaidJobSettlement(facts({ jobValuePennies }));
      expect(plan.fee.feeWaivedAmountPennies + plan.fee.feeAmountPennies).toBe(
        motkoFeePennies(jobValuePennies, 0),
      );
    }
  });

  it("never records a negative waiver", () => {
    const plan = planPaidJobSettlement(facts({ jobValuePennies: 1 }));
    expect(plan.fee.feeWaivedAmountPennies).toBeGreaterThanOrEqual(0);
  });

  it("consumes exactly one credit however many are held", () => {
    const plan = planPaidJobSettlement(facts({ freeJobsRemaining: 9 }));
    const burns = plan.ledger.filter((e) => e.reason === "job_consumed");
    expect(burns).toHaveLength(1);
    expect(burns[0].delta).toBe(-1);
  });

  it("charges in full and records no waiver when no credit is held", () => {
    const plan = planPaidJobSettlement(facts({ freeJobsRemaining: 0 }));
    expect(plan.fee.feeAmountPennies).toBe(motkoFeePennies(900_000, 0));
    expect(plan.fee.feeWaivedAmountPennies).toBe(0);
    expect(plan.fee.feeWaivedReason).toBeNull();
    expect(plan.ledger.filter((e) => e.reason === "job_consumed")).toEqual([]);
  });

  it("keeps the split machinery, so reinstating a ceiling is a config change", () => {
    // The card asks for this explicitly. waiverSplit is the one function both
    // settlement and the copy call, so a ceiling would move both at once.
    expect(waiverSplit(4_300)).toEqual({ waivedPennies: 4_300, payablePennies: 0 });
  });
});

describe("the banked-credit cap", () => {
  const referral = (referrerFreeJobsRemaining?: number, activatedReferralCount = 5) =>
    planPaidJobSettlement(
      facts({
        isFirstPaidJob: true,
        pendingReferral: { referralId: "r-1", referrerContractorId: "c-2" },
        activatedReferralCount,
        referrerFreeJobsRemaining,
      }),
    );

  const grant = (plan: ReturnType<typeof planPaidJobSettlement>) =>
    plan.ledger.find((e) => e.reason === "referral_unlock")?.delta ?? 0;

  it("is 10", () => {
    expect(MAX_BANKED_FREE_JOBS).toBe(10);
  });

  it("grants in full when there is room", () => {
    expect(grant(referral(0))).toBe(5);
  });

  it("truncates a grant to the room remaining rather than refusing it", () => {
    // Refusing outright would silently drop a reward somebody earned. The
    // referral still activates; the referrer banks what fits.
    expect(grant(referral(7))).toBe(3);
    expect(referral(7).referralActivation).not.toBeNull();
  });

  it("grants nothing at the cap, and the balance never exceeds it", () => {
    const plan = referral(MAX_BANKED_FREE_JOBS);
    expect(grant(plan)).toBe(0);
    expect(plan.ledger.filter((e) => e.reason === "referral_unlock")).toEqual([]);
    expect(plan.referralActivation).not.toBeNull();
  });

  it("never claws back a balance already above the cap", () => {
    // FEE-11: "Existing balances already above the cap are not clawed back."
    // A negative delta here would take credits off someone who holds them.
    const plan = referral(14);
    expect(grant(plan)).toBe(0);
    for (const entry of plan.ledger) expect(entry.delta).toBeGreaterThanOrEqual(-1);
  });

  it("grants in full when the referrer's balance is unknown", () => {
    // Undefined means "not supplied", not "zero". Truncating on a figure the
    // caller never gave would drop a real reward on incomplete information.
    expect(grant(referral(undefined))).toBe(5);
  });

  it("leaves the champion tier alone — only the ceiling on banked credits changed", () => {
    expect(grant(referral(0, 4))).toBe(3);
    expect(grant(referral(0, 5))).toBe(5);
  });

  it("caps the lower tier too, not just the champion one", () => {
    expect(grant(referral(9, 4))).toBe(1);
  });
});
