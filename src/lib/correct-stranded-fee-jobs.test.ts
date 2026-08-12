import { describe, expect, it } from "vitest";
import { correctStrandedFeeJobs } from "./correct-stranded-fee-jobs";

describe("correctStrandedFeeJobs", () => {
  describe("dry-run mode", () => {
    it("defaults to dry-run when no options provided", async () => {
      const mockDb = {
        from: () => ({
          select: () => ({
            eq: () => ({ data: [], error: null }),
          }),
        }),
      };

      const result = await correctStrandedFeeJobs(mockDb);
      expect(result.corrected).toBe(0);
    });

    it("returns corrected=0 in dry-run mode even when stranded jobs exist", async () => {
      const mockDb = {
        from: (table: string) => ({
          select: () => ({
            eq: () => {
              if (table === "jobs") {
                return { data: [{ id: "job-1", contractor_id: "c1", fee_amount_pennies: 200, fee_status: "accrued" }], error: null };
              }
              return { data: [], error: null };
            },
            in: () => ({ data: [{ id: "coll-1", contractor_id: "c1", period_start: "2026-07-01", job_ids: ["job-1"], status: "collected", total_pennies: 200 }], error: null }),
          }),
        }),
      };

      const result = await correctStrandedFeeJobs(mockDb, { dryRun: true });
      expect(result.corrected).toBe(0);
      expect(result.strandedJobsFound).toBeGreaterThan(0);
    });
  });

  describe("write mode", () => {
    it("updates jobs when dryRun is false", async () => {
      let updateCalled = false;

      const mockDb = {
        from: (table: string) => ({
          select: () => ({
            eq: () => {
              if (table === "jobs") {
                return { data: [{ id: "job-1", contractor_id: "c1", fee_amount_pennies: 200, fee_status: "accrued" }], error: null };
              }
              return { data: [], error: null };
            },
            in: () => ({ data: [{ id: "coll-1", contractor_id: "c1", period_start: "2026-07-01", job_ids: ["job-1"], status: "collected", total_pennies: 200 }], error: null }),
          }),
          update: () => ({
            in: () => ({
              eq: () => {
                updateCalled = true;
                return { data: [{ id: "job-1", fee_status: "collected" }], error: null };
              },
            }),
          }),
        }),
      };

      const result = await correctStrandedFeeJobs(mockDb, { dryRun: false });
      expect(updateCalled).toBe(true);
      expect(result.corrected).toBe(1);
    });

    it("does not update when no stranded jobs found", async () => {
      let updateCalled = false;

      const mockDb = {
        from: () => ({
          select: () => ({
            eq: () => ({ data: [], error: null }),
          }),
          update: () => {
            updateCalled = true;
            return {
              in: () => ({
                eq: () => ({ data: [], error: null }),
              }),
            };
          },
        }),
      };

      const result = await correctStrandedFeeJobs(mockDb, { dryRun: false });
      expect(updateCalled).toBe(false);
      expect(result.corrected).toBe(0);
    });
  });

  describe("double-charge detection", () => {
    it("categorizes job as not yet double-charged when no second collection exists", async () => {
      const mockDb = {
        from: (table: string) => ({
          select: () => ({
            eq: (col: string) => {
              if (table === "jobs" && col === "fee_status") {
                return { data: [{ id: "job-1", contractor_id: "c1", fee_amount_pennies: 200, fee_status: "accrued" }], error: null };
              }
              if (table === "fee_collections" && col === "contractor_id") {
                return {
                  contains: () => ({
                    gte: () => ({ data: [], error: null }),
                  }),
                };
              }
              return { data: [], error: null };
            },
            in: () => ({ data: [{ id: "coll-1", contractor_id: "c1", period_start: "2026-07-01", job_ids: ["job-1"], status: "collected", total_pennies: 200 }], error: null }),
          }),
        }),
      };

      const result = await correctStrandedFeeJobs(mockDb, { dryRun: true });
      expect(result.notYetDoubleCharged.length).toBe(1);
      expect(result.alreadyDoubleCharged.length).toBe(0);
    });

    it("categorizes job as already double-charged when second collection exists", async () => {
      const secondCollection = {
        id: "coll-2",
        contractor_id: "c1",
        period_start: "2026-08-01",
        job_ids: ["job-1"],
        status: "collected",
        total_pennies: 200,
      };

      const mockDb = {
        from: (table: string) => ({
          select: () => ({
            eq: (col: string) => {
              if (table === "jobs" && col === "fee_status") {
                return { data: [{ id: "job-1", contractor_id: "c1", fee_amount_pennies: 200, fee_status: "accrued" }], error: null };
              }
              if (table === "fee_collections" && col === "contractor_id") {
                return {
                  contains: () => ({
                    gte: () => ({ data: [secondCollection], error: null }),
                  }),
                };
              }
              return { data: [], error: null };
            },
            in: () => ({ data: [{ id: "coll-1", contractor_id: "c1", period_start: "2026-07-01", job_ids: ["job-1"], status: "collected", total_pennies: 200 }], error: null }),
          }),
        }),
      };

      const result = await correctStrandedFeeJobs(mockDb, { dryRun: true });
      expect(result.alreadyDoubleCharged.length).toBe(1);
      expect(result.notYetDoubleCharged.length).toBe(0);
    });
  });

  describe("idempotency", () => {
    it("returns zero results when re-run after completion", async () => {
      const mockDb = {
        from: () => ({
          select: () => ({
            eq: () => ({ data: [], error: null }),
          }),
        }),
      };

      const result = await correctStrandedFeeJobs(mockDb, { dryRun: true });
      expect(result.strandedJobsFound).toBe(0);
      expect(result.notYetDoubleCharged).toHaveLength(0);
      expect(result.alreadyDoubleCharged).toHaveLength(0);
      expect(result.corrected).toBe(0);
    });
  });

  describe("result structure", () => {
    it("includes all required fields in notYetDoubleCharged entries", async () => {
      const mockDb = {
        from: (table: string) => ({
          select: () => ({
            eq: (col: string) => {
              if (table === "jobs" && col === "fee_status") {
                return { data: [{ id: "job-1", contractor_id: "c1", fee_amount_pennies: 200, fee_status: "accrued" }], error: null };
              }
              if (table === "fee_collections" && col === "contractor_id") {
                return {
                  contains: () => ({
                    gte: () => ({ data: [], error: null }),
                  }),
                };
              }
              return { data: [], error: null };
            },
            in: () => ({ data: [{ id: "coll-1", contractor_id: "c1", period_start: "2026-07-01", job_ids: ["job-1"], status: "collected", total_pennies: 200 }], error: null }),
          }),
        }),
      };

      const result = await correctStrandedFeeJobs(mockDb, { dryRun: true });
      expect(result.notYetDoubleCharged.length).toBe(1);

      const entry = result.notYetDoubleCharged[0]!;
      expect(entry).toHaveProperty("jobId");
      expect(entry).toHaveProperty("collectionId");
      expect(entry).toHaveProperty("contractorId");
      expect(entry).toHaveProperty("periodStart");
      expect(entry).toHaveProperty("feeAmountPennies");
    });

    it("includes all required fields in alreadyDoubleCharged entries", async () => {
      const secondCollection = {
        id: "coll-2",
        contractor_id: "c1",
        period_start: "2026-08-01",
        job_ids: ["job-1"],
        status: "collected",
        total_pennies: 200,
      };

      const mockDb = {
        from: (table: string) => ({
          select: () => ({
            eq: (col: string) => {
              if (table === "jobs" && col === "fee_status") {
                return { data: [{ id: "job-1", contractor_id: "c1", fee_amount_pennies: 200, fee_status: "accrued" }], error: null };
              }
              if (table === "fee_collections" && col === "contractor_id") {
                return {
                  contains: () => ({
                    gte: () => ({ data: [secondCollection], error: null }),
                  }),
                };
              }
              return { data: [], error: null };
            },
            in: () => ({ data: [{ id: "coll-1", contractor_id: "c1", period_start: "2026-07-01", job_ids: ["job-1"], status: "collected", total_pennies: 200 }], error: null }),
          }),
        }),
      };

      const result = await correctStrandedFeeJobs(mockDb, { dryRun: true });
      expect(result.alreadyDoubleCharged.length).toBe(1);

      const entry = result.alreadyDoubleCharged[0]!;
      expect(entry).toHaveProperty("jobId");
      expect(entry).toHaveProperty("firstCollectionId");
      expect(entry).toHaveProperty("secondCollectionId");
      expect(entry).toHaveProperty("firstPeriodStart");
      expect(entry).toHaveProperty("secondPeriodStart");
      expect(entry).toHaveProperty("feeAmountPennies");
    });
  });
});
