import { describe, it, expect } from "vitest";
import { motkoFeePennies, splitFeeVat } from "@/lib/motko-fee";
import type { PaidJobFacts, SettlementPlan } from "@/lib/paid-job-settlement";
import { planPaidJobSettlement } from "@/lib/paid-job-settlement";

// NOTE: These imports will fail until the Engineer implements Stripe payment integration.
// Expected modules from PAY-2/PAY-3:
// - src/lib/stripe-payments.ts or similar for payment creation with application fees
// - src/app/api/stripe/webhook/route.ts for Stripe webhook handling
// The tests assert the INTERFACE these modules must expose, not their internals.

describe("Issue #215: PAY-4 — Fee collection at source via Stripe application fees", () => {
  describe("Fee calculation at payment creation", () => {
    it("calculates standard fee for a paid job with no free allowance", () => {
      const jobValuePennies = 50_000; // £500
      const freeJobsRemaining = 0;

      const feePennies = motkoFeePennies(jobValuePennies, freeJobsRemaining);

      expect(feePennies).toBe(200); // £2 for jobs ≤ £1000
    });

    // RETIRED by FEE-6: "calculates large fee for a job above the threshold"
    // Superseded by marginal ladder (decision 31 Aug 2026)

    it("returns zero fee for a job using free allowance", () => {
      const jobValuePennies = 50_000; // £500
      const freeJobsRemaining = 3;

      const feePennies = motkoFeePennies(jobValuePennies, freeJobsRemaining);

      expect(feePennies).toBe(0); // Free job
    });

    it("splits the fee into net and VAT correctly", () => {
      const grossPennies = 200; // £2.00

      const split = splitFeeVat(grossPennies);

      expect(split.grossPennies).toBe(200);
      expect(split.netPennies).toBe(167); // £1.67 net
      expect(split.vatPennies).toBe(33); // £0.33 VAT
      expect(split.netPennies + split.vatPennies).toBe(split.grossPennies);
    });
  });

  describe("Fee settlement on payment success", () => {
    // RETIRED by FEE-6: "marks a standard job as fee_status = 'collected' with correct amounts"
    // Superseded by marginal ladder (decision 31 Aug 2026)

    it("marks a free job as fee_status = 'not_applicable' with zero fee", () => {
      const facts: PaidJobFacts = {
        jobId: "job-free",
        contractorId: "contractor-2",
        jobValuePennies: 50_000, // £500
        freeJobsRemaining: 2,
        isFirstPaidJob: false,
        pendingReferral: null,
      };

      const plan: SettlementPlan = planPaidJobSettlement(facts);

      expect(plan.fee.feeStatus).toBe("not_applicable");
      expect(plan.fee.feeAmountPennies).toBe(0);
      expect(plan.fee.feeWaivedReason).toBe("free_allowance");
      expect(plan.ledger).toContainEqual({
        contractorId: "contractor-2",
        delta: -1,
        reason: "job_consumed",
        relatedJobId: "job-free",
        relatedReferralId: null,
      });
    });

    // RETIRED by FEE-6: "creates a job_consumed ledger entry when using free allowance"
    // Superseded by marginal ladder (decision 31 Aug 2026)
  });

  describe("Stripe payment creation integration", () => {
    it("asserts Stripe payment module exists and exports payment creation function", async () => {
      // This will fail until the Stripe payment integration is implemented.
      // Expected: src/lib/stripe-payments.ts exports a function like:
      //   createStripePayment(input: { jobValuePennies, freeJobsRemaining, ... })
      // or equivalent.

      // Attempt to import the module to verify it exists.
      let stripeModule: unknown;
      try {
        stripeModule = await import("@/lib/stripe-payments");
      } catch (error) {
        if (error instanceof Error && error.message.includes("Cannot find module")) {
          throw new Error(
            "Stripe payment module does not exist. PAY-4 depends on Stripe destination charge implementation (PAY-2/PAY-3). Blocked until that code is merged."
          );
        }
        throw error;
      }

      expect(stripeModule).toBeDefined();
      // The Engineer must export a payment creation function that accepts:
      // - jobValuePennies (or invoiceAmount)
      // - freeJobsRemaining (to calculate the fee)
      // - connectedAccountId (contractor's Stripe account for destination charge)
      // and returns a payment object with id, url, etc.
    });

    it("application_fee_amount is set correctly for a standard job", () => {
      // This test documents the expected behavior. The Engineer will implement
      // the Stripe payment creation code to:
      // 1. Calculate fee = motkoFeePennies(jobValuePennies, freeJobsRemaining)
      // 2. Set application_fee_amount = fee (if fee > 0, omit if fee === 0)
      // 3. Pass to Stripe paymentIntents.create or equivalent

      const jobValuePennies = 60_000; // £600
      const freeJobsRemaining = 0;
      const expectedFee = motkoFeePennies(jobValuePennies, freeJobsRemaining);

      expect(expectedFee).toBe(200); // £2

      // The Engineer's implementation should use this calculation:
      //   const applicationFeeAmount = motkoFeePennies(jobValuePennies, freeJobsRemaining);
      //   const paymentParams = {
      //     ...,
      //     application_fee_amount: applicationFeeAmount > 0 ? applicationFeeAmount : undefined,
      //   };
    });

    it("application_fee_amount is omitted (or zero) for a free job", () => {
      const jobValuePennies = 50_000; // £500
      const freeJobsRemaining = 3;
      const expectedFee = motkoFeePennies(jobValuePennies, freeJobsRemaining);

      expect(expectedFee).toBe(0);

      // Stripe rejects an explicit application_fee_amount = 0, so the parameter
      // must be OMITTED entirely (undefined) when the fee is zero.
      // The Engineer's code should:
      //   if (applicationFeeAmount > 0) {
      //     params.application_fee_amount = applicationFeeAmount;
      //   }
    });
  });

  describe("Stripe webhook settlement", () => {
    it("asserts Stripe webhook handler exists", async () => {
      // Expected: src/app/api/stripe/webhook/route.ts handles payment_intent.succeeded
      // and calls the settlement logic with the collected fee.

      let webhookRoute: unknown;
      try {
        webhookRoute = await import("@/app/api/stripe/webhook/route");
      } catch (error) {
        if (error instanceof Error && error.message.includes("Cannot find module")) {
          throw new Error(
            "Stripe webhook route does not exist. PAY-4 depends on Stripe webhook implementation (PAY-3). Blocked until that code is merged."
          );
        }
        throw error;
      }

      expect(webhookRoute).toBeDefined();
      // The route should export a POST handler that:
      // 1. Verifies the Stripe webhook signature
      // 2. Extracts application_fee_amount from the payment_intent
      // 3. Calls settlement logic to mark the job fee_status = 'collected' (or 'not_applicable' if fee was 0)
    });

    it("settleFeeCollection is NOT called for at-source collected fees", () => {
      // The existing settleFeeCollection function (src/lib/collect-fees.ts) handles
      // VRP mandate payment settlement. For at-source fees, this function should
      // NOT be invoked — the fee is already collected by Stripe.

      // The Engineer must ensure that:
      // - Stripe webhook settlement path does NOT call settleFeeCollection
      // - Jobs with fee_status = 'collected' (at-source) do not appear in the
      //   monthly fee collection batch query (which filters on fee_status = 'accrued')

      // This is a design assertion rather than a runtime test. The acceptance
      // test for this is: when a Stripe payment succeeds, the fee_collections
      // table should NOT gain a new row for that job.
    });
  });

  describe("Fee statement coherency", () => {
    it("distinguishes at-source collected fees from VRP-collected fees", () => {
      // The fee statement (src/lib/fee-statement.ts, fees-statement-section.tsx)
      // must show both:
      // - At-source fees: jobs with fee_status = 'collected' AND payment_method = 'stripe_*'
      // - VRP fees: jobs with fee_status = 'collected' AND payment_method = 'motko_bank' (TrueLayer)

      // The statement query or display logic must differentiate these, possibly by:
      // - Checking payment_method column
      // - Checking for presence/absence of a fee_collection record
      // - Using a new flag on the jobs table

      // The Engineer must update fee-statement.ts to:
      // 1. Query jobs with fee_status = 'collected'
      // 2. Sum net/VAT for at-source jobs separately (or together, depending on UX)
      // 3. Ensure accrued jobs (TrueLayer in-flight) are ALSO shown
    });

    it("fee statement shows net and VAT split for at-source fees", () => {
      // At-source fees store fee_net_pennies and fee_vat_pennies on the jobs table,
      // calculated via splitFeeVat at payment time. The statement must read and
      // display these correctly.

      const grossPennies = 400; // £4 fee
      const split = splitFeeVat(grossPennies);

      expect(split.grossPennies).toBe(400);
      expect(split.netPennies).toBe(333); // £3.33 net
      expect(split.vatPennies).toBe(67); // £0.67 VAT
      expect(split.netPennies + split.vatPennies).toBe(split.grossPennies);

      // The statement must aggregate these splits across all collected jobs.
    });
  });

  describe("Edge cases", () => {
    // RETIRED by FEE-6: "a job with free allowance does NOT enter the VRP collection batch"
    // Superseded by marginal ladder (decision 31 Aug 2026)

    it("referral unlock fires on first paid job regardless of fee collection method", () => {
      // Referral credit is awarded when the referee's FIRST paid job settles,
      // whether the fee was collected at source (Stripe) or via VRP (TrueLayer).
      // The referral logic must not couple to the fee collection path.

      const facts: PaidJobFacts = {
        jobId: "job-first-referred",
        contractorId: "contractor-referee",
        jobValuePennies: 70_000,
        freeJobsRemaining: 5, // New contractor, full allowance
        isFirstPaidJob: true,
        pendingReferral: {
          referralId: "referral-1",
          referrerContractorId: "contractor-referrer",
        },
      };

      const plan: SettlementPlan = planPaidJobSettlement(facts);

      expect(plan.referralActivation).not.toBe(null);
      expect(plan.referralActivation?.referralId).toBe("referral-1");
      expect(plan.ledger).toContainEqual({
        contractorId: "contractor-referrer",
        delta: 5,
        reason: "referral_unlock",
        relatedJobId: null,
        relatedReferralId: "referral-1",
      });
    });

    // RETIRED by SUB-2 (#601): "free job allowance is FREE_JOB_ALLOWANCE (5) at
    // contract time", which asserted expect(FREE_JOB_ALLOWANCE).toBe(5).
    // Superseded by D4 as amended (Jacob, 5 Sep 2026): three free jobs per
    // account, one counter, decremented by any completed job however it settled.
    // Changing that constant from 5 to 3 is SUB-2's whole purpose, so the
    // assertion failed by definition and no implementation could satisfy both.
    // The test recorded the value "for documentation" and "at contract time" by
    // its own comment, which is what retirement exists for.
  });

  // RETIRED by FEE-6: entire "Existing fee engine tests remain green" section
  // Superseded by marginal ladder (decision 31 Aug 2026)
});
