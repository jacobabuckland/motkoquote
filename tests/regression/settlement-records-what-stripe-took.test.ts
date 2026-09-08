/**
 * The settled job records the fee Stripe actually took.
 *
 * `free_jobs_remaining` is read TWICE on the Stripe path: once in
 * `create-payment-intent` to size `application_fee_amount`, and again in
 * `settlePaidJob` to decide the fee outcome. A bank-app redirect sits between
 * them, so the two reads can disagree — and until this change the settlement
 * recomputed eligibility from the second read instead of recording what the
 * first one had already caused Stripe to charge.
 *
 * Both directions of the disagreement produced a wrong record:
 *
 *   - Allowance ran out mid-flight: Stripe took nothing, settlement computed a
 *     full fee and wrote `accrued`. A debt for money that never moved, and
 *     nothing in the product collects `accrued`.
 *   - A referral unlock landed mid-flight: Stripe took the fee, settlement saw
 *     an allowance and wrote `feeWaivedReason: 'free_allowance'` with a zero
 *     amount. That is the one that cannot be explained to a trade — a record
 *     denying a charge on their own statement.
 *
 * Decision 8 Sep 2026 (Jacob): reconcile at settlement against the settled
 * charge rather than pinning the allowance at intent creation. Pinning needs a
 * reservation with a TTL and a release path, and an abandoned intent would hold
 * a credit hostage. `application_fee_amount` on the settled charge is the only
 * value in the sequence that is a fact rather than a forecast.
 */

import { describe, expect, it } from "vitest";

import { motkoFeePennies } from "@/lib/motko-fee";
import { planPaidJobSettlement, type PaidJobFacts } from "@/lib/paid-job-settlement";

const JOB_VALUE_PENNIES = 50_000; // £500 — well clear of the cap
const FULL_FEE = motkoFeePennies(JOB_VALUE_PENNIES, 0);

const facts = (over: Partial<PaidJobFacts> = {}): PaidJobFacts => ({
  jobId: "job_1",
  contractorId: "contractor_1",
  jobValuePennies: JOB_VALUE_PENNIES,
  freeJobsRemaining: 0,
  isFirstPaidJob: false,
  pendingReferral: null,
  ...over,
});

describe("the settlement records the fee Stripe took", () => {
  it("never books a debt for a payment Stripe took nothing from", () => {
    // The allowance was spent by another settlement while this customer was in
    // their banking app. Stripe had already been told to take nothing.
    const plan = planPaidJobSettlement(
      facts({ freeJobsRemaining: 0, feeCollectedAtSourcePennies: 0 }),
    );

    // The defect: FULL_FEE booked as `accrued` against a payment that carried
    // no application fee at all.
    expect(plan.fee.feeAmountPennies).toBe(0);
    expect(plan.fee.feeStatus).toBe("not_applicable");
    expect(plan.fee.feeStatus).not.toBe("accrued");
  });

  it("never records a waiver against a fee Stripe actually charged", () => {
    // The mirror case: a referral unlock landed after the intent was created,
    // so the allowance now reads 1 — but Stripe already took the fee.
    const plan = planPaidJobSettlement(
      facts({ freeJobsRemaining: 1, feeCollectedAtSourcePennies: FULL_FEE }),
    );

    expect(plan.fee.feeAmountPennies).toBe(FULL_FEE);
    expect(plan.fee.feeStatus).toBe("collected");
    // The half that matters. A trade reading "Waived" on a payment their
    // statement shows a deduction for is the failure with no good explanation.
    expect(plan.fee.feeWaivedReason).toBeNull();
    expect(plan.fee.feeWaivedAmountPennies).toBe(0);
  });

  it("records the exact amount taken, not a recomputation that agrees by luck", () => {
    // A fee from a schedule this build no longer computes. Recording rather
    // than recomputing is the whole claim, so the assertion has to use a value
    // `motkoFeePennies` would never return for this job.
    const ODD = 217;
    expect(ODD).not.toBe(FULL_FEE);

    const plan = planPaidJobSettlement(facts({ feeCollectedAtSourcePennies: ODD }));

    expect(plan.fee.feeAmountPennies).toBe(ODD);
    expect(plan.fee.feeNetPennies + plan.fee.feeVatPennies).toBe(ODD);
  });

  it("errs generous rather than negative when a credit was spent mid-flight", () => {
    // Jacob's accepted residual, pinned so it stays a choice rather than
    // drifting into a surprise: two customers pay inside the window, both
    // intents sized under the last free credit. The second settlement finds the
    // allowance already at zero.
    const plan = planPaidJobSettlement(
      facts({ freeJobsRemaining: 0, feeCollectedAtSourcePennies: 0 }),
    );

    // Nothing charged, and no second credit burned — the counter lands on zero
    // rather than going negative. A couple of pounds, in the trade's favour.
    expect(plan.fee.feeAmountPennies).toBe(0);
    expect(plan.ledger.filter((e) => e.reason === "job_consumed")).toHaveLength(0);
  });

  it("still waives, and still burns exactly one credit, in the ordinary free case", () => {
    // The allowance held across both reads: Stripe took nothing because the job
    // was free, and it is recorded as a waiver rather than a bare zero.
    const plan = planPaidJobSettlement(
      facts({ freeJobsRemaining: 2, feeCollectedAtSourcePennies: 0 }),
    );

    expect(plan.fee.feeWaivedReason).toBe("free_allowance");
    expect(plan.fee.feeWaivedAmountPennies).toBe(FULL_FEE);
    expect(plan.fee.feeAmountPennies).toBe(0);
    expect(plan.ledger.filter((e) => e.reason === "job_consumed")).toHaveLength(1);
  });

  it("leaves every caller that cannot know the amount on the recompute path", () => {
    // Manual "mark as paid" and the legacy callers pass nothing. Omitting the
    // field must mean "no information", never "Stripe took zero" — reading an
    // absent value as a zero would waive every off-rail and manual settlement.
    const withoutField = planPaidJobSettlement(facts({ freeJobsRemaining: 0 }));

    expect(withoutField.fee.feeAmountPennies).toBe(FULL_FEE);
    expect(withoutField.fee.feeStatus).toBe("accrued");
  });
});
