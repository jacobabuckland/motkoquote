import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Issue #330: FEE-1: Free-job grants — trial 3, referral 3, champion tier of 5 after five activated referrals
 *
 * These tests verify that:
 * 1. A migration adds activated_referral_count to contractors table
 * 2. The trial grant is reduced from 5 to 3
 * 3. Referral rewards are tiered: +3 for activations 1-4, +5 for activations 5+
 * 4. The counter increments before tier evaluation (5th activation grants 5)
 * 5. Spending credits doesn't change activated_referral_count
 * 6. Referral grants stack without limit
 * 7. Non-activated referrals don't increment the counter
 */

const MIGRATIONS_DIR = join(process.cwd(), "supabase/migrations");

const findMigrationFile = (pattern: string): string | null => {
  const match = readdirSync(MIGRATIONS_DIR)
    .sort()
    .filter((f) => f.includes(pattern))
    .pop();
  return match ? join(MIGRATIONS_DIR, match) : null;
};

const readMigration = (pattern: string): string => {
  const path = findMigrationFile(pattern);
  if (!path || !existsSync(path)) {
    throw new Error(`Migration file matching '${pattern}' not found`);
  }
  return readFileSync(path, "utf-8");
};

describe("Issue #330: Free-job grants — trial 3, referral 3, champion tier", () => {
  describe("Migration — activated_referral_count column", () => {
    it("exists with a name matching 'activated_referral' or 'referral_count'", () => {
      const path = findMigrationFile("activated_referral");
      expect(path).toBeTruthy();
      expect(path).toMatch(/activated.*referral|referral.*count/i);
    });

    it("adds activated_referral_count column to contractors table", () => {
      const content = readMigration("activated_referral");

      // Must add column to contractors
      expect(content).toMatch(/alter\s+table\s+contractors/i);
      expect(content).toMatch(/add\s+column\s+activated_referral_count/i);

      // Must be integer type
      expect(content).toMatch(/activated_referral_count\s+(int|integer)/i);

      // Must have default 0
      expect(content).toMatch(/default\s+0/i);

      // Must be not null
      expect(content).toMatch(/not\s+null/i);
    });

    it("backfills activated_referral_count from historical activated referrals", () => {
      const content = readMigration("activated_referral");

      // Must query referrals table
      expect(content).toContain("referrals");

      // Must filter by status = 'activated'
      expect(content).toMatch(/status\s*=\s*'activated'/i);

      // Must count or aggregate by referrer_contractor_id
      expect(content).toContain("referrer_contractor_id");

      // Must update contractors table with the count
      expect(content).toMatch(/update\s+contractors/i);
    });

    it("does not adjust free_jobs_remaining balances during migration", () => {
      const content = readMigration("activated_referral");

      // Must NOT touch free_jobs_remaining in the migration
      const lines = content.split("\n");
      const freeJobsLines = lines.filter((line) =>
        line.toLowerCase().includes("free_jobs_remaining")
      );

      // free_jobs_remaining should not appear in UPDATE or SET statements
      const touchesFreeJobs = freeJobsLines.some(
        (line) =>
          line.match(/update.*free_jobs_remaining/i) ||
          line.match(/set.*free_jobs_remaining/i)
      );

      expect(
        touchesFreeJobs,
        "Migration must not adjust free_jobs_remaining balances"
      ).toBe(false);
    });
  });

  describe("Trial grant reduced to 3", () => {
    it("grants exactly 3 free jobs on new contractor signup", async () => {
      const mod = await import("@/lib/referral-signup");
      expect(mod.provisionNewContractor).toBeDefined();

      // Read the source to verify the constant
      const sourcePath = join(
        process.cwd(),
        "src/lib/referral-signup.ts"
      );
      const source = readFileSync(sourcePath, "utf-8");

      // The signup_grant insert must use delta: 3
      // The insert structure is: { contractor_id, delta, reason: "signup_grant" }
      const signupGrantMatch = source.match(
        /delta:\s*(\d+)[^}]*reason:\s*["']signup_grant["']/
      );
      expect(
        signupGrantMatch,
        "signup_grant credit_event insert must exist"
      ).toBeTruthy();
      expect(
        signupGrantMatch?.[1],
        "Trial grant must be 3, not 5"
      ).toBe("3");
    });

    it("does not grant 5 free jobs anywhere in referral-signup.ts", async () => {
      const sourcePath = join(
        process.cwd(),
        "src/lib/referral-signup.ts"
      );
      const source = readFileSync(sourcePath, "utf-8");

      // The signup_grant delta should be 3
      const signupGrantSection = source.match(
        /delta:\s*(\d+)[^}]*reason:\s*["']signup_grant["']/
      );
      expect(signupGrantSection?.[1]).toBe("3");

      // No delta: 5 should exist in the signup grant section
      const hasFiveInSignup = source.match(
        /delta:\s*5[^}]*reason:\s*["']signup_grant["']/
      );
      expect(
        hasFiveInSignup,
        "referral-signup.ts must not contain delta: 5 for trial grant"
      ).toBeNull();
    });
  });

  describe("Tiered referral reward", () => {
    it("grants +3 for the first activated referral", async () => {
      const mod = await import("@/lib/paid-job-settlement");

      const plan = mod.planPaidJobSettlement({
        jobId: "job-1",
        contractorId: "referee-1",
        jobValuePennies: 50_000,
        freeJobsRemaining: 3,
        isFirstPaidJob: true,
        pendingReferral: {
          referralId: "ref-1",
          referrerContractorId: "referrer-1",
        },
        // Simulating activated_referral_count = 1 after increment
        activatedReferralCount: 1,
      });

      const referralUnlock = plan.ledger.find(
        (entry) => entry.reason === "referral_unlock"
      );
      expect(referralUnlock).toBeDefined();
      expect(referralUnlock?.delta).toBe(3);
    });

    it("grants +3 for the fourth activated referral", async () => {
      const mod = await import("@/lib/paid-job-settlement");

      const plan = mod.planPaidJobSettlement({
        jobId: "job-4",
        contractorId: "referee-4",
        jobValuePennies: 50_000,
        freeJobsRemaining: 3,
        isFirstPaidJob: true,
        pendingReferral: {
          referralId: "ref-4",
          referrerContractorId: "referrer-1",
        },
        activatedReferralCount: 4,
      });

      const referralUnlock = plan.ledger.find(
        (entry) => entry.reason === "referral_unlock"
      );
      expect(referralUnlock).toBeDefined();
      expect(referralUnlock?.delta).toBe(3);
    });

    it("grants +5 for the fifth activated referral", async () => {
      const mod = await import("@/lib/paid-job-settlement");

      const plan = mod.planPaidJobSettlement({
        jobId: "job-5",
        contractorId: "referee-5",
        jobValuePennies: 50_000,
        freeJobsRemaining: 3,
        isFirstPaidJob: true,
        pendingReferral: {
          referralId: "ref-5",
          referrerContractorId: "referrer-1",
        },
        activatedReferralCount: 5,
      });

      const referralUnlock = plan.ledger.find(
        (entry) => entry.reason === "referral_unlock"
      );
      expect(referralUnlock).toBeDefined();
      expect(referralUnlock?.delta).toBe(5);
    });

    it("grants +5 for the eighth activated referral", async () => {
      const mod = await import("@/lib/paid-job-settlement");

      const plan = mod.planPaidJobSettlement({
        jobId: "job-8",
        contractorId: "referee-8",
        jobValuePennies: 50_000,
        freeJobsRemaining: 3,
        isFirstPaidJob: true,
        pendingReferral: {
          referralId: "ref-8",
          referrerContractorId: "referrer-1",
        },
        activatedReferralCount: 8,
      });

      const referralUnlock = plan.ledger.find(
        (entry) => entry.reason === "referral_unlock"
      );
      expect(referralUnlock).toBeDefined();
      expect(referralUnlock?.delta).toBe(5);
    });
  });

  describe("Counter increment timing", () => {
    it("increments activated_referral_count before evaluating tier", async () => {
      // This tests that settlePaidJob increments the counter BEFORE calling
      // planPaidJobSettlement, so the 5th activation sees count=5 and grants 5

      const settlePaidJobPath = join(
        process.cwd(),
        "src/lib/settle-paid-job.ts"
      );
      const source = readFileSync(settlePaidJobPath, "utf-8");

      // Must read activated_referral_count from contractors
      expect(source).toContain("activated_referral_count");

      // Must increment it before planning
      // Look for an update that increments the counter
      const hasIncrement =
        source.includes("activated_referral_count") &&
        (source.includes("+ 1") ||
          source.includes("increment") ||
          source.includes("activated_referral_count + 1"));

      expect(
        hasIncrement,
        "settlePaidJob must increment activated_referral_count"
      ).toBe(true);
    });

    it("passes the post-increment count to planPaidJobSettlement", async () => {
      // The planner must receive activatedReferralCount as input
      const plannerPath = join(
        process.cwd(),
        "src/lib/paid-job-settlement.ts"
      );
      const source = readFileSync(plannerPath, "utf-8");

      // PaidJobFacts type must include activatedReferralCount
      const hasField =
        source.includes("activatedReferralCount") ||
        source.includes("activated_referral_count");

      expect(
        hasField,
        "PaidJobFacts must include activatedReferralCount or equivalent"
      ).toBe(true);
    });
  });

  describe("Counter independence from balance", () => {
    it("does not decrement activated_referral_count when spending free jobs", async () => {
      const mod = await import("@/lib/paid-job-settlement");

      // A contractor with count=7 spends a free job
      const plan = mod.planPaidJobSettlement({
        jobId: "job-spend",
        contractorId: "trade-1",
        jobValuePennies: 50_000,
        freeJobsRemaining: 10,
        isFirstPaidJob: false,
        pendingReferral: null,
        activatedReferralCount: 7,
      });

      // The ledger burns a free job
      const consumed = plan.ledger.find(
        (entry) => entry.reason === "job_consumed"
      );
      expect(consumed).toBeDefined();
      expect(consumed?.delta).toBe(-1);

      // But no ledger entry touches activated_referral_count
      // (this is a persistence concern, not a planning concern, so we verify
      // the planner doesn't emit anything that would decrement it)
      const hasCounterChange = plan.ledger.some(
        (entry) => entry.reason === "referral_unlock" && entry.delta < 0
      );
      expect(hasCounterChange).toBe(false);
    });

    it("grants +5 on next activation even after balance drops to 0", async () => {
      const mod = await import("@/lib/paid-job-settlement");

      // A contractor with count=5 and balance=0 (spent everything)
      const plan = mod.planPaidJobSettlement({
        jobId: "job-after-spent",
        contractorId: "referee-9",
        jobValuePennies: 50_000,
        freeJobsRemaining: 0,
        isFirstPaidJob: true,
        pendingReferral: {
          referralId: "ref-9",
          referrerContractorId: "referrer-1",
        },
        activatedReferralCount: 6,
      });

      const referralUnlock = plan.ledger.find(
        (entry) => entry.reason === "referral_unlock"
      );
      expect(referralUnlock).toBeDefined();
      expect(referralUnlock?.delta).toBe(5);
    });
  });

  describe("Stacking without limit", () => {
    it("allows a contractor to bank 35 free jobs from trial + 8 activations", async () => {
      const mod = await import("@/lib/paid-job-settlement");

      // Trial: 3
      // Activations 1-4: 3 each = 12
      // Activations 5-8: 5 each = 20
      // Total: 3 + 12 + 20 = 35

      // This is not a runtime assertion, but a test that the planner
      // never caps or limits the grants. We simulate 8 activations
      // and verify each grants the correct amount without hitting a ceiling.

      const grants = [3, 3, 3, 3, 5, 5, 5, 5];

      for (let i = 0; i < grants.length; i += 1) {
        const plan = mod.planPaidJobSettlement({
          jobId: `job-stack-${i}`,
          contractorId: `referee-stack-${i}`,
          jobValuePennies: 50_000,
          freeJobsRemaining: 3,
          isFirstPaidJob: true,
          pendingReferral: {
            referralId: `ref-stack-${i}`,
            referrerContractorId: "referrer-stack",
          },
          activatedReferralCount: i + 1,
        });

        const referralUnlock = plan.ledger.find(
          (entry) => entry.reason === "referral_unlock"
        );
        expect(referralUnlock).toBeDefined();
        expect(referralUnlock?.delta).toBe(grants[i]);
      }
    });
  });

  describe("Non-activated referrals", () => {
    it("does not grant credits for a pending referral", async () => {
      const mod = await import("@/lib/paid-job-settlement");

      // A job that is NOT the referee's first paid job
      const plan = mod.planPaidJobSettlement({
        jobId: "job-not-first",
        contractorId: "referee-pending",
        jobValuePennies: 50_000,
        freeJobsRemaining: 3,
        isFirstPaidJob: false,
        pendingReferral: {
          referralId: "ref-pending",
          referrerContractorId: "referrer-pending",
        },
        activatedReferralCount: 0,
      });

      const referralUnlock = plan.ledger.find(
        (entry) => entry.reason === "referral_unlock"
      );
      expect(referralUnlock).toBeUndefined();
    });

    it("does not increment counter for a referee who never completes a paid job", async () => {
      // This is a migration concern: only status='activated' referrals
      // should count toward the backfill

      const content = readMigration("activated_referral");

      // Must filter by status = 'activated', not 'pending'
      expect(content).toMatch(/status\s*=\s*'activated'/i);

      // Must NOT count pending referrals
      const countsPending = content.match(/status\s*=\s*'pending'/i);
      expect(
        countsPending,
        "Migration must not count pending referrals"
      ).toBeNull();
    });
  });

  describe("Existing contractors retain current balance", () => {
    it("does not adjust free_jobs_remaining for legacy accounts", async () => {
      // This was already tested in the migration section, but we verify again
      // that the migration does NOT touch free_jobs_remaining

      const content = readMigration("activated_referral");

      // free_jobs_remaining should not be updated
      const updatesFreeJobs = content.match(
        /update.*free_jobs_remaining|set.*free_jobs_remaining/i
      );
      expect(
        updatesFreeJobs,
        "Migration must not touch free_jobs_remaining"
      ).toBeNull();
    });
  });
});
