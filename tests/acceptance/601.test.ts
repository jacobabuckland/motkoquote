import { describe, it, expect } from "vitest";
import { planPaidJobSettlement, type PaidJobFacts } from "@/lib/paid-job-settlement";
import { FREE_JOB_ALLOWANCE } from "@/lib/motko-fee";

const facts = (over: Partial<PaidJobFacts> = {}): PaidJobFacts => ({
  jobId: "job-1",
  contractorId: "trade-1",
  jobValuePennies: 100_000, // £1,000
  freeJobsRemaining: 3,
  isFirstPaidJob: false,
  pendingReferral: null,
  ...over,
});

describe("SUB-2: Three free jobs, waiving the transaction fee only", () => {
  describe("FREE_JOB_ALLOWANCE constant", () => {
    it("equals 3", () => {
      expect(FREE_JOB_ALLOWANCE).toBe(3);
    });
  });

  describe("First three jobs are free", () => {
    it("first on-rail job is free (no fee, burns one credit)", () => {
      const plan = planPaidJobSettlement(
        facts({ freeJobsRemaining: 3, isOffRail: false }),
      );

      // No fee charged
      expect(plan.fee.feeAmountPennies).toBe(0);
      expect(plan.fee.feeStatus).toBe("not_applicable");
      expect(plan.fee.feeWaivedReason).toBe("free_allowance");

      // One credit consumed
      const consumption = plan.ledger.filter((e) => e.reason === "job_consumed");
      expect(consumption).toHaveLength(1);
      expect(consumption[0]?.delta).toBe(-1);
    });

    it("first off-rail job is free (no fee, burns one credit)", () => {
      const plan = planPaidJobSettlement(
        facts({ freeJobsRemaining: 3, isOffRail: true }),
      );

      // No fee written (off-rail writes no fee record)
      expect(plan.fee.feeAmountPennies).toBe(0);
      expect(plan.fee.feeStatus).toBe("not_applicable");

      // One credit consumed
      const consumption = plan.ledger.filter((e) => e.reason === "job_consumed");
      expect(consumption).toHaveLength(1);
      expect(consumption[0]?.delta).toBe(-1);
    });

    it("second job is free", () => {
      const plan = planPaidJobSettlement(
        facts({ freeJobsRemaining: 2, isOffRail: false }),
      );

      expect(plan.fee.feeAmountPennies).toBe(0);
      expect(plan.fee.feeWaivedReason).toBe("free_allowance");

      const consumption = plan.ledger.filter((e) => e.reason === "job_consumed");
      expect(consumption).toHaveLength(1);
    });

    it("third job is free", () => {
      const plan = planPaidJobSettlement(
        facts({ freeJobsRemaining: 1, isOffRail: false }),
      );

      expect(plan.fee.feeAmountPennies).toBe(0);
      expect(plan.fee.feeWaivedReason).toBe("free_allowance");

      const consumption = plan.ledger.filter((e) => e.reason === "job_consumed");
      expect(consumption).toHaveLength(1);
    });
  });

  describe("Fourth job is not free", () => {
    it("fourth on-rail job accrues a fee", () => {
      const plan = planPaidJobSettlement(
        facts({
          freeJobsRemaining: 0,
          jobValuePennies: 100_000, // £1,000
          isOffRail: false,
          feeCollectedAtSource: false,
        }),
      );

      // Fee is charged
      expect(plan.fee.feeAmountPennies).toBeGreaterThan(0);
      expect(plan.fee.feeWaivedReason).toBeNull();
      expect(plan.fee.feeStatus).toBe("accrued");

      // No credit consumed (allowance exhausted)
      const consumption = plan.ledger.filter((e) => e.reason === "job_consumed");
      expect(consumption).toHaveLength(0);
    });

    it("fourth on-rail job with fee collected at source", () => {
      const plan = planPaidJobSettlement(
        facts({
          freeJobsRemaining: 0,
          jobValuePennies: 100_000,
          isOffRail: false,
          feeCollectedAtSource: true,
        }),
      );

      expect(plan.fee.feeAmountPennies).toBeGreaterThan(0);
      expect(plan.fee.feeStatus).toBe("collected");
      expect(plan.fee.feeWaivedReason).toBeNull();
    });

    it("fourth off-rail job writes no fee but also burns no credit", () => {
      const plan = planPaidJobSettlement(
        facts({ freeJobsRemaining: 0, isOffRail: true }),
      );

      // Off-rail with no allowance: no fee record, no credit consumed
      expect(plan.fee.feeAmountPennies).toBe(0);
      expect(plan.fee.feeStatus).toBe("not_applicable");

      const consumption = plan.ledger.filter((e) => e.reason === "job_consumed");
      expect(consumption).toHaveLength(0);
    });
  });

  describe("Edge case: three cash jobs, then a rail job", () => {
    it("burns credits on cash jobs, then charges fee on the fourth (rail) job", () => {
      // Simulate three cash jobs
      const job1 = planPaidJobSettlement(
        facts({ freeJobsRemaining: 3, isOffRail: true }),
      );
      expect(job1.ledger.filter((e) => e.reason === "job_consumed")).toHaveLength(1);

      const job2 = planPaidJobSettlement(
        facts({ freeJobsRemaining: 2, isOffRail: true }),
      );
      expect(job2.ledger.filter((e) => e.reason === "job_consumed")).toHaveLength(1);

      const job3 = planPaidJobSettlement(
        facts({ freeJobsRemaining: 1, isOffRail: true }),
      );
      expect(job3.ledger.filter((e) => e.reason === "job_consumed")).toHaveLength(1);

      // Fourth job is on-rail and pays a fee
      const job4 = planPaidJobSettlement(
        facts({
          freeJobsRemaining: 0,
          isOffRail: false,
          feeCollectedAtSource: true,
        }),
      );
      expect(job4.fee.feeAmountPennies).toBeGreaterThan(0);
      expect(job4.fee.feeStatus).toBe("collected");
      expect(job4.ledger.filter((e) => e.reason === "job_consumed")).toHaveLength(0);
    });
  });

  describe("Staged job consumes one credit", () => {
    it("a staged job (deposit then final) burns exactly one credit total", () => {
      // This is enforced by settlePaidJob's per-job idempotency guard:
      // jobs.paid_at IS NULL is checked atomically, so only the first
      // payment triggers the ledger burn. We test that planPaidJobSettlement
      // returns the correct outcome for a single settlement event.

      const plan = planPaidJobSettlement(
        facts({
          freeJobsRemaining: 3,
          jobValuePennies: 200_000, // £2,000 total job value
          isOffRail: false,
        }),
      );

      // One credit consumed for the job
      const consumption = plan.ledger.filter((e) => e.reason === "job_consumed");
      expect(consumption).toHaveLength(1);
      expect(consumption[0]?.delta).toBe(-1);
    });
  });

  describe("Database default for new contractors", () => {
    it("the migration sets free_jobs_remaining default to 3", async () => {
      // Read the latest migration file to verify the default
      const fs = await import("node:fs");
      const path = await import("node:path");

      const migrationsDir = path.join(
        process.cwd(),
        "supabase",
        "migrations",
      );
      const files = fs.readdirSync(migrationsDir).sort();

      // Find a migration that sets the default for free_jobs_remaining
      let foundCorrectDefault = false;

      for (const file of files.reverse()) {
        const content = fs.readFileSync(
          path.join(migrationsDir, file),
          "utf-8",
        );

        // SQL comments are stripped first. Without this the assertion matches
        // the migration's own "-- After this migration: ..." note rather than
        // its DDL, which inverts the test: deleting the comment fails it on a
        // correct schema, and breaking the DDL passes it on a wrong one.
        const sql = content.replace(/--[^\n]*/g, "");

        if (
          sql.includes("contractors") &&
          sql.includes("free_jobs_remaining") &&
          sql.includes("default")
        ) {
          // Both forms that can set the default: altering the existing column,
          // and defining it inline should the table ever be created afresh.
          const match =
            sql.match(
              /alter\s+column\s+free_jobs_remaining\s+set\s+default\s+(\d+)/i,
            ) ??
            sql.match(
              /free_jobs_remaining\s+int\s+not\s+null\s+default\s+(\d+)/i,
            );
          if (match?.[1] === "3") {
            foundCorrectDefault = true;
            break;
          }
        }
      }

      expect(
        foundCorrectDefault,
        "Migration must set contractors.free_jobs_remaining default to 3",
      ).toBe(true);
    });
  });

  // REMOVED at PM time, before this file was frozen: two describes that read
  // source under src/ — one grepping src/lib/referral-signup.ts for the wording
  // of a COMMENT, one grepping src/app/dashboard/page.tsx for the wording of
  // dashboard copy. Both violate AGENTS.md "Never assert on source text", and
  // check-acceptance-static.sh missed them through a gap in its path matcher:
  // a path built by joining separate segment literals was invisible to a rule
  // that wanted the directory and the filename inside one string. Now closed.
  //
  // Neither asserted behaviour. A comment's wording is documentation, and the
  // dashboard count is existing behaviour this item does not change — it is
  // not in the spec's Files list. Pinning the copy would have constrained that
  // page's wording permanently, which is the cost AGENTS.md records for #309.
  //
  // The fee behaviour these sat beside is untouched: three jobs free, the
  // fourth charged, staged jobs, cash-then-rail, and the migration default all
  // still assert above.
});
