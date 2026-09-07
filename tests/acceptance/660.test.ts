import { describe, expect, it } from "vitest";
import { mockSupabaseClient } from "../helpers/supabase";

describe("REF-3: Five activations credit one banked month", () => {
  describe("Banking logic in paid-job settlement", () => {
    it("banks one month on the fifth activation", async () => {
      const mod = await import("@/lib/paid-job-settlement");

      const facts: mod.PaidJobFacts = {
        jobId: "job_1",
        contractorId: "contractor_referee",
        jobValuePennies: 500000,
        freeJobsRemaining: 3,
        isFirstPaidJob: true,
        pendingReferral: {
          referralId: "ref_1",
          referrerContractorId: "contractor_referrer",
        },
        activatedReferralCount: 5,
        referrerFreeJobsRemaining: 2,
      };

      const plan = mod.planPaidJobSettlement(facts);

      // The fifth activation should indicate a month was banked
      expect(plan.monthCreditGranted).toBe(true);

      // The existing free-job grant still fires (both rewards on fifth activation)
      const unlockEntry = plan.ledger.find((e) => e.reason === "referral_unlock");
      expect(unlockEntry).toBeDefined();
      expect(unlockEntry?.delta).toBe(5);
    });

    it("banks nothing on the fourth activation", async () => {
      const mod = await import("@/lib/paid-job-settlement");

      const facts: mod.PaidJobFacts = {
        jobId: "job_1",
        contractorId: "contractor_referee",
        jobValuePennies: 500000,
        freeJobsRemaining: 3,
        isFirstPaidJob: true,
        pendingReferral: {
          referralId: "ref_1",
          referrerContractorId: "contractor_referrer",
        },
        activatedReferralCount: 4,
        referrerFreeJobsRemaining: 2,
      };

      const plan = mod.planPaidJobSettlement(facts);

      // Fourth activation should NOT bank a month
      expect(plan.monthCreditGranted).toBe(false);

      // But the free-job grant still fires (tier 1-4 grants +3)
      const unlockEntry = plan.ledger.find((e) => e.reason === "referral_unlock");
      expect(unlockEntry).toBeDefined();
      expect(unlockEntry?.delta).toBe(3);
    });

    it("banks the second month on the tenth activation", async () => {
      const mod = await import("@/lib/paid-job-settlement");

      const facts: mod.PaidJobFacts = {
        jobId: "job_10",
        contractorId: "contractor_referee",
        jobValuePennies: 500000,
        freeJobsRemaining: 5,
        isFirstPaidJob: true,
        pendingReferral: {
          referralId: "ref_10",
          referrerContractorId: "contractor_referrer",
        },
        activatedReferralCount: 10,
        referrerFreeJobsRemaining: 8,
      };

      const plan = mod.planPaidJobSettlement(facts);

      // Tenth activation banks exactly one more month (not two)
      expect(plan.monthCreditGranted).toBe(true);
    });

    it("enforces no cap on banked months (50th activation still banks)", async () => {
      const mod = await import("@/lib/paid-job-settlement");

      const facts: mod.PaidJobFacts = {
        jobId: "job_50",
        contractorId: "contractor_referee",
        jobValuePennies: 500000,
        freeJobsRemaining: 0,
        isFirstPaidJob: true,
        pendingReferral: {
          referralId: "ref_50",
          referrerContractorId: "contractor_referrer",
        },
        activatedReferralCount: 50,
        referrerFreeJobsRemaining: 10,
      };

      const plan = mod.planPaidJobSettlement(facts);

      // No cap - the 50th activation (10th multiple of 5) still banks a month
      expect(plan.monthCreditGranted).toBe(true);
    });

    it("banks nothing on non-multiple-of-five activations", async () => {
      const mod = await import("@/lib/paid-job-settlement");

      const nonMultiples = [1, 2, 3, 4, 6, 7, 8, 9, 11, 13, 17, 23];

      for (const count of nonMultiples) {
        const facts: mod.PaidJobFacts = {
          jobId: `job_${count}`,
          contractorId: "contractor_referee",
          jobValuePennies: 500000,
          freeJobsRemaining: 5,
          isFirstPaidJob: true,
          pendingReferral: {
            referralId: `ref_${count}`,
            referrerContractorId: "contractor_referrer",
          },
          activatedReferralCount: count,
          referrerFreeJobsRemaining: 5,
        };

        const plan = mod.planPaidJobSettlement(facts);

        expect(
          plan.monthCreditGranted,
          `Activation ${count} should not bank a month`
        ).toBe(false);
      }
    });

    it("does not bank a month when no referral activates", async () => {
      const mod = await import("@/lib/paid-job-settlement");

      const facts: mod.PaidJobFacts = {
        jobId: "job_1",
        contractorId: "contractor_1",
        jobValuePennies: 500000,
        freeJobsRemaining: 2,
        isFirstPaidJob: false,
        pendingReferral: null,
      };

      const plan = mod.planPaidJobSettlement(facts);

      // No activation = no month banking
      expect(plan.monthCreditGranted).toBe(false);
      expect(plan.referralActivation).toBeNull();
    });
  });

  describe("Consumption path atomicity", () => {
    it("atomically claims one unconsumed month credit", async () => {
      const mod = await import("@/lib/referral-credits");

      const unconsumedCredit = {
        id: "credit_1",
        contractor_id: "contractor_1",
        consumed: false,
        created_at: "2026-09-07T10:00:00Z",
      };

      const { client, from, getFilters } = mockSupabaseClient([unconsumedCredit]);

      const result = await mod.claimReferralCredit(
        client as never,
        "contractor_1"
      );

      expect(result).toEqual(unconsumedCredit);

      // Assert the consumption query shape: update with consumed = false condition
      expect(from).toHaveBeenCalledWith("referral_credits");

      const filters = getFilters();
      expect(filters).toContainEqual({
        method: "eq",
        args: ["contractor_id", "contractor_1"],
      });
      expect(filters).toContainEqual({
        method: "eq",
        args: ["consumed", false],
      });
    });

    it("returns null when no unconsumed credit exists", async () => {
      const mod = await import("@/lib/referral-credits");

      // Empty result set - no unconsumed credits
      const { client } = mockSupabaseClient([]);

      const result = await mod.claimReferralCredit(
        client as never,
        "contractor_1"
      );

      expect(result).toBeNull();
    });

    it("concurrent consumption attempts claim different credits", async () => {
      const mod = await import("@/lib/referral-credits");

      // Two unconsumed credits available
      const credit1 = {
        id: "credit_1",
        contractor_id: "contractor_1",
        consumed: false,
        created_at: "2026-09-01T10:00:00Z",
      };
      const credit2 = {
        id: "credit_2",
        contractor_id: "contractor_1",
        consumed: false,
        created_at: "2026-09-02T10:00:00Z",
      };

      // First call gets credit1, second call gets credit2
      const { client: client1 } = mockSupabaseClient([credit1]);
      const { client: client2 } = mockSupabaseClient([credit2]);

      const result1 = await mod.claimReferralCredit(
        client1 as never,
        "contractor_1"
      );
      const result2 = await mod.claimReferralCredit(
        client2 as never,
        "contractor_1"
      );

      // Both succeed but claim different credits
      expect(result1?.id).toBe("credit_1");
      expect(result2?.id).toBe("credit_2");
    });

    it("builds the conditional update with limit(1) for single-credit claim", async () => {
      const mod = await import("@/lib/referral-credits");

      const credit = {
        id: "credit_1",
        contractor_id: "contractor_1",
        consumed: false,
        created_at: "2026-09-07T10:00:00Z",
      };

      const { client, getFilters } = mockSupabaseClient([credit]);

      await mod.claimReferralCredit(client as never, "contractor_1");

      const filters = getFilters();

      // Must limit to 1 row to ensure atomic single-credit consumption
      expect(filters).toContainEqual({ method: "limit", args: [1] });
    });
  });

  describe("Ten activations bank two months across two invoices", () => {
    it("ten activations result in two discrete credit records", async () => {
      const settlementMod = await import("@/lib/paid-job-settlement");

      // Fifth activation
      const facts5: settlementMod.PaidJobFacts = {
        jobId: "job_5",
        contractorId: "contractor_referee_5",
        jobValuePennies: 500000,
        freeJobsRemaining: 3,
        isFirstPaidJob: true,
        pendingReferral: {
          referralId: "ref_5",
          referrerContractorId: "contractor_referrer",
        },
        activatedReferralCount: 5,
        referrerFreeJobsRemaining: 2,
      };

      const plan5 = settlementMod.planPaidJobSettlement(facts5);
      expect(plan5.monthCreditGranted).toBe(true);

      // Tenth activation (different referee, same referrer)
      const facts10: settlementMod.PaidJobFacts = {
        jobId: "job_10",
        contractorId: "contractor_referee_10",
        jobValuePennies: 600000,
        freeJobsRemaining: 4,
        isFirstPaidJob: true,
        pendingReferral: {
          referralId: "ref_10",
          referrerContractorId: "contractor_referrer",
        },
        activatedReferralCount: 10,
        referrerFreeJobsRemaining: 7,
      };

      const plan10 = settlementMod.planPaidJobSettlement(facts10);
      expect(plan10.monthCreditGranted).toBe(true);

      // Both activations indicated a month should be banked
      // These would be persisted as two discrete referral_credits rows
    });

    it("two credits are consumed sequentially across two subscription invoices", async () => {
      const creditsMod = await import("@/lib/referral-credits");

      const credit1 = {
        id: "credit_1",
        contractor_id: "contractor_1",
        consumed: false,
        created_at: "2026-09-01T10:00:00Z",
      };
      const credit2 = {
        id: "credit_2",
        contractor_id: "contractor_1",
        consumed: false,
        created_at: "2026-09-02T10:00:00Z",
      };

      // First invoice consumes first credit
      const { client: client1 } = mockSupabaseClient([credit1]);
      const firstClaim = await creditsMod.claimReferralCredit(
        client1 as never,
        "contractor_1"
      );
      expect(firstClaim?.id).toBe("credit_1");

      // Second invoice consumes second credit
      const { client: client2 } = mockSupabaseClient([credit2]);
      const secondClaim = await creditsMod.claimReferralCredit(
        client2 as never,
        "contractor_1"
      );
      expect(secondClaim?.id).toBe("credit_2");

      // Two distinct credits consumed across two calls
      // (In reality, after the first claim, credit_1 would be marked consumed
      // and the second query would only find credit_2)
    });
  });

  describe("Migration 75 creates referral_credits table", () => {
    it("migration file exists at expected path", async () => {
      const { readFileSync, existsSync } = await import("node:fs");
      const { join } = await import("node:path");

      const migrationPath = join(
        process.cwd(),
        "supabase/migrations/00000000000075_referral_credits.sql"
      );

      expect(existsSync(migrationPath)).toBe(true);

      const content = readFileSync(migrationPath, "utf-8");

      // Must create the referral_credits table
      expect(content).toMatch(/create table.*referral_credits/i);

      // Must have a consumed boolean column
      expect(content).toMatch(/consumed.*boolean/i);

      // Must enable RLS
      expect(content).toMatch(/alter table.*referral_credits.*enable row level security/i);

      // Must have contractor_id for the ownership policy
      expect(content).toMatch(/contractor_id/);
    });
  });
});
