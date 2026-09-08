import { describe, it, expect } from "vitest";
import type { PaidJobFacts } from "@/lib/paid-job-settlement";

describe("REF-3: Five activations credit one banked month", () => {
  describe("Banking credits — arithmetic", () => {
    it("earns zero credits for four activations", async () => {
      const mod = await import("@/lib/referral-credits");
      expect(mod.computeCreditsEarned(4)).toBe(0);
    });

    it("earns one credit on fifth activation", async () => {
      const mod = await import("@/lib/referral-credits");
      expect(mod.computeCreditsEarned(5)).toBe(1);
    });

    it("earns one credit total for nine activations, not two", async () => {
      const mod = await import("@/lib/referral-credits");
      expect(mod.computeCreditsEarned(9)).toBe(1);
    });

    it("earns two credits on tenth activation", async () => {
      const mod = await import("@/lib/referral-credits");
      expect(mod.computeCreditsEarned(10)).toBe(2);
    });

    it("does not cap credit accumulation (unlike free jobs which cap at 10)", async () => {
      const mod = await import("@/lib/referral-credits");
      expect(mod.computeCreditsEarned(50)).toBe(10);
      expect(mod.computeCreditsEarned(100)).toBe(20);
    });
  });

  describe("Banking credits — integration with settlement", () => {
    it("does not replace referral_unlock on fifth activation", async () => {
      const settlement = await import("@/lib/paid-job-settlement");

      const facts: PaidJobFacts = {
        jobId: "job_1",
        contractorId: "contractor_1",
        jobValuePennies: 50000,
        freeJobsRemaining: 5,
        isFirstPaidJob: true,
        pendingReferral: {
          referralId: "referral_1",
          referrerContractorId: "referrer_1",
        },
        activatedReferralCount: 5,
      };

      const plan = settlement.planPaidJobSettlement(facts);

      // The existing referral_unlock behavior must be preserved
      const unlockEntries = plan.ledger.filter((e) => e.reason === "referral_unlock");
      expect(unlockEntries.length).toBeGreaterThan(0);
    });
  });

  describe("Claiming credits", () => {
    it("claims one unconsumed credit atomically", async () => {
      const { mockSupabaseClient } = await import("@/tests/helpers/supabase");
      const mod = await import("@/lib/referral-credits");

      const creditRow = {
        id: "credit_1",
        contractor_id: "contractor_1",
        consumed: false,
        created_at: "2026-01-01T00:00:00Z",
      };

      const { client, getFilters, update } = mockSupabaseClient([creditRow]);

      const result = await mod.claimReferralCredit("contractor_1", client);

      expect(result).toBeDefined();
      expect(result?.id).toBe("credit_1");

      // Assert the query included both required filters for atomicity
      const filters = getFilters();
      expect(filters).toContainEqual({
        method: "eq",
        args: ["contractor_id", "contractor_1"],
      });
      expect(filters).toContainEqual({ method: "eq", args: ["consumed", false] });

      // Assert update was called to mark consumed
      expect(update).toHaveBeenCalled();
    });

    it("returns null when no unconsumed credits exist", async () => {
      const { mockSupabaseClient } = await import("@/tests/helpers/supabase");
      const mod = await import("@/lib/referral-credits");

      const { client } = mockSupabaseClient([]); // Empty result

      const result = await mod.claimReferralCredit("contractor_1", client);

      expect(result).toBeNull();
    });
  });

  describe("Cancellation play-out", () => {
    it("extends access by N months when N credits unconsumed", async () => {
      const mod = await import("@/lib/referral-credits");

      const paidUntil = new Date("2026-10-01T00:00:00Z");

      // 0 credits: no extension
      expect(mod.computeExtendedAccess(0, paidUntil)).toEqual(
        new Date("2026-10-01T00:00:00Z")
      );

      // 1 credit: 1 month extension
      expect(mod.computeExtendedAccess(1, paidUntil)).toEqual(
        new Date("2026-11-01T00:00:00Z")
      );

      // 3 credits: 3 months extension (Oct → Jan)
      expect(mod.computeExtendedAccess(3, paidUntil)).toEqual(
        new Date("2027-01-01T00:00:00Z")
      );
    });

    it("returns paid period end when zero credits unconsumed", async () => {
      const mod = await import("@/lib/referral-credits");

      const paidUntil = new Date("2026-10-01T00:00:00Z");
      const extended = mod.computeExtendedAccess(0, paidUntil);

      expect(extended).toEqual(paidUntil);
    });
  });

  describe("Migration 75: referral_credits table", () => {
    it("exists at expected path", async () => {
      const fs = await import("node:fs/promises");
      const path = await import("node:path");

      const migrationPath = path.join(
        process.cwd(),
        "supabase/migrations/00000000000075_referral_credits.sql"
      );

      await expect(fs.access(migrationPath)).resolves.not.toThrow();
    });

    it("creates referral_credits table with required columns", async () => {
      const fs = await import("node:fs/promises");
      const path = await import("node:path");

      const migrationPath = path.join(
        process.cwd(),
        "supabase/migrations/00000000000075_referral_credits.sql"
      );

      const content = await fs.readFile(migrationPath, "utf-8");

      expect(content).toMatch(/create table.*referral_credits/i);
      expect(content).toMatch(/contractor_id.*uuid/i);
      expect(content).toMatch(/consumed.*boolean/i);
      expect(content).toMatch(/created_at/i);
    });

    it("enables RLS on referral_credits", async () => {
      const fs = await import("node:fs/promises");
      const path = await import("node:path");

      const migrationPath = path.join(
        process.cwd(),
        "supabase/migrations/00000000000075_referral_credits.sql"
      );

      const content = await fs.readFile(migrationPath, "utf-8");

      expect(content).toMatch(/alter table.*referral_credits.*enable row level security/i);
    });

    it("creates contractor ownership policy", async () => {
      const fs = await import("node:fs/promises");
      const path = await import("node:path");

      const migrationPath = path.join(
        process.cwd(),
        "supabase/migrations/00000000000075_referral_credits.sql"
      );

      const content = await fs.readFile(migrationPath, "utf-8");

      expect(content).toMatch(/create policy.*referral_credits/i);
      expect(content).toMatch(
        /contractor_id in [\s\S]*select id from contractors where owner_user_id = auth\.uid\(\)/i
      );
    });

    it("does not grant insert, update, or delete to anon or authenticated", async () => {
      const fs = await import("node:fs/promises");
      const path = await import("node:path");

      const migrationPath = path.join(
        process.cwd(),
        "supabase/migrations/00000000000075_referral_credits.sql"
      );

      const content = await fs.readFile(migrationPath, "utf-8");

      // Should NOT have grants for insert/update/delete to anon/authenticated
      const dangerousGrants = [
        /grant[\s\S]*insert[\s\S]*referral_credits[\s\S]*to[\s\S]*(anon|authenticated)/i,
        /grant[\s\S]*update[\s\S]*referral_credits[\s\S]*to[\s\S]*(anon|authenticated)/i,
        /grant[\s\S]*delete[\s\S]*referral_credits[\s\S]*to[\s\S]*(anon|authenticated)/i,
      ];

      for (const pattern of dangerousGrants) {
        expect(content).not.toMatch(pattern);
      }
    });
  });
});
