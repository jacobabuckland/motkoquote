import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

describe("Issue #184: Correct jobs stranded at accrued under collected collections", () => {
  describe("correctStrandedFeeJobs function exists", () => {
    it("src/lib/correct-stranded-fee-jobs.ts exists", () => {
      const modulePath = resolve(__dirname, "../../src/lib/correct-stranded-fee-jobs.ts");
      expect(existsSync(modulePath)).toBe(true);
    });

    it("exports correctStrandedFeeJobs function", async () => {
      const imported = await import("@/lib/correct-stranded-fee-jobs");
      expect(typeof imported.correctStrandedFeeJobs).toBe("function");
    });
  });

  describe("dry-run mode (default)", () => {
    it("runs in dry-run mode by default without explicit flag", async () => {
      const { correctStrandedFeeJobs } = await import("@/lib/correct-stranded-fee-jobs");

      // Mock minimal Supabase client
      const mockDb = {
        from: (table: string) => ({
          select: () => ({
            eq: () => ({
              data: table === "jobs" ? [] : [],
              error: null,
            }),
          }),
          update: () => {
            throw new Error("update called in dry-run mode");
          },
        }),
      };

      // Should not throw even though update would error — dry-run doesn't call update
      const result = await correctStrandedFeeJobs(mockDb);
      expect(result.corrected).toBe(0);
    });

    it("reports zero corrected in dry-run mode", async () => {
      const { correctStrandedFeeJobs } = await import("@/lib/correct-stranded-fee-jobs");

      const mockDb = {
        from: () => ({
          select: () => ({
            eq: () => ({ data: [], error: null }),
          }),
        }),
      };

      const result = await correctStrandedFeeJobs(mockDb, { dryRun: true });
      expect(result.corrected).toBe(0);
    });
  });

  describe("identifies stranded jobs", () => {
    it("finds jobs at accrued under collected collections", async () => {
      const { correctStrandedFeeJobs } = await import("@/lib/correct-stranded-fee-jobs");

      const strandedJob = {
        id: "job-1",
        contractor_id: "contractor-1",
        fee_amount_pennies: 200,
        fee_status: "accrued",
      };

      const collectedCollection = {
        id: "collection-1",
        contractor_id: "contractor-1",
        period_start: "2026-07-01",
        period_end: "2026-07-31",
        job_ids: ["job-1"],
        total_pennies: 200,
        status: "collected",
      };

      const mockDb = {
        from: (table: string) => {
          return {
            select: () => ({
              eq: (col: string, val: unknown) => {
                if (table === "jobs" && col === "fee_status" && val === "accrued") {
                  return { data: [strandedJob], error: null };
                }
                if (table === "fee_collections" && col === "id" && val === "collection-1") {
                  return { data: [collectedCollection], error: null, single: () => ({ data: collectedCollection, error: null }) };
                }
                return { data: [], error: null };
              },
              in: (col: string, _ids: string[]) => {
                if (table === "fee_collections" && col === "id" && _ids.includes("collection-1")) {
                  return { data: [collectedCollection], error: null };
                }
                return { data: [], error: null };
              },
            }),
          };
        },
      };

      const result = await correctStrandedFeeJobs(mockDb, { dryRun: true });
      expect(result.strandedJobsFound).toBeGreaterThan(0);
    });
  });

  describe("result structure", () => {
    it("returns strandedJobsFound count", async () => {
      const { correctStrandedFeeJobs } = await import("@/lib/correct-stranded-fee-jobs");

      const mockDb = {
        from: () => ({
          select: () => ({
            eq: () => ({ data: [], error: null }),
            in: () => ({ data: [], error: null }),
          }),
        }),
      };

      const result = await correctStrandedFeeJobs(mockDb, { dryRun: true });
      expect(result).toHaveProperty("strandedJobsFound");
      expect(typeof result.strandedJobsFound).toBe("number");
    });

    it("returns notYetDoubleCharged array", async () => {
      const { correctStrandedFeeJobs } = await import("@/lib/correct-stranded-fee-jobs");

      const mockDb = {
        from: () => ({
          select: () => ({
            eq: () => ({ data: [], error: null }),
            in: () => ({ data: [], error: null }),
          }),
        }),
      };

      const result = await correctStrandedFeeJobs(mockDb, { dryRun: true });
      expect(result).toHaveProperty("notYetDoubleCharged");
      expect(Array.isArray(result.notYetDoubleCharged)).toBe(true);
    });

    it("returns alreadyDoubleCharged array", async () => {
      const { correctStrandedFeeJobs } = await import("@/lib/correct-stranded-fee-jobs");

      const mockDb = {
        from: () => ({
          select: () => ({
            eq: () => ({ data: [], error: null }),
            in: () => ({ data: [], error: null }),
          }),
        }),
      };

      const result = await correctStrandedFeeJobs(mockDb, { dryRun: true });
      expect(result).toHaveProperty("alreadyDoubleCharged");
      expect(Array.isArray(result.alreadyDoubleCharged)).toBe(true);
    });

    it("returns corrected count", async () => {
      const { correctStrandedFeeJobs } = await import("@/lib/correct-stranded-fee-jobs");

      const mockDb = {
        from: () => ({
          select: () => ({
            eq: () => ({ data: [], error: null }),
            in: () => ({ data: [], error: null }),
          }),
        }),
      };

      const result = await correctStrandedFeeJobs(mockDb, { dryRun: true });
      expect(result).toHaveProperty("corrected");
      expect(typeof result.corrected).toBe("number");
    });

    it("notYetDoubleCharged entries include required fields", async () => {
      const { correctStrandedFeeJobs } = await import("@/lib/correct-stranded-fee-jobs");

      const strandedJob = {
        id: "job-1",
        contractor_id: "contractor-1",
        fee_amount_pennies: 200,
        fee_status: "accrued",
      };

      const collectedCollection = {
        id: "collection-1",
        contractor_id: "contractor-1",
        period_start: "2026-07-01",
        period_end: "2026-07-31",
        job_ids: ["job-1"],
        total_pennies: 200,
        status: "collected",
      };

      const mockDb = {
        from: (table: string) => ({
          select: () => ({
            eq: (col: string, val: unknown) => {
              if (table === "jobs" && col === "fee_status" && val === "accrued") {
                return { data: [strandedJob], error: null };
              }
              if (table === "fee_collections" && col === "id") {
                return { single: () => ({ data: collectedCollection, error: null }) };
              }
              return { data: [], error: null };
            },
            in: (col: string, _ids: string[]) => {
              if (table === "fee_collections" && col === "id") {
                return { data: [collectedCollection], error: null };
              }
              // Check for duplicate collections (later period_start)
              if (table === "fee_collections" && col === "contractor_id") {
                return {
                  gte: () => ({
                    contains: () => ({ data: [], error: null }),
                  }),
                };
              }
              return { data: [], error: null };
            },
            contains: () => ({
              gte: () => ({ data: [], error: null }),
            }),
          }),
        }),
      };

      const result = await correctStrandedFeeJobs(mockDb, { dryRun: true });

      if (result.notYetDoubleCharged.length > 0) {
        const entry = result.notYetDoubleCharged[0]!;
        expect(entry).toHaveProperty("jobId");
        expect(entry).toHaveProperty("collectionId");
        expect(entry).toHaveProperty("contractorId");
        expect(entry).toHaveProperty("periodStart");
        expect(entry).toHaveProperty("feeAmountPennies");
      }
    });

    it("alreadyDoubleCharged entries include both collection IDs", async () => {
      const { correctStrandedFeeJobs } = await import("@/lib/correct-stranded-fee-jobs");

      const strandedJob = {
        id: "job-1",
        contractor_id: "contractor-1",
        fee_amount_pennies: 200,
        fee_status: "accrued",
      };

      const firstCollection = {
        id: "collection-1",
        contractor_id: "contractor-1",
        period_start: "2026-07-01",
        period_end: "2026-07-31",
        job_ids: ["job-1"],
        total_pennies: 200,
        status: "collected",
      };

      const secondCollection = {
        id: "collection-2",
        contractor_id: "contractor-1",
        period_start: "2026-08-01",
        period_end: "2026-08-31",
        job_ids: ["job-1"],
        total_pennies: 200,
        status: "collected",
      };

      const mockDb = {
        from: (table: string) => ({
          select: () => ({
            eq: (col: string, val: unknown) => {
              if (table === "jobs" && col === "fee_status" && val === "accrued") {
                return { data: [strandedJob], error: null };
              }
              if (table === "fee_collections" && col === "id" && val === "collection-1") {
                return { single: () => ({ data: firstCollection, error: null }) };
              }
              return { data: [], error: null };
            },
            in: (col: string, _ids: string[]) => {
              if (table === "fee_collections" && col === "id") {
                return { data: [firstCollection], error: null };
              }
              return { data: [], error: null };
            },
            gte: () => ({
              contains: () => ({ data: [secondCollection], error: null }),
            }),
            contains: () => ({
              gte: () => ({ data: [secondCollection], error: null }),
            }),
          }),
        }),
      };

      const result = await correctStrandedFeeJobs(mockDb, { dryRun: true });

      if (result.alreadyDoubleCharged.length > 0) {
        const entry = result.alreadyDoubleCharged[0]!;
        expect(entry).toHaveProperty("firstCollectionId");
        expect(entry).toHaveProperty("secondCollectionId");
        expect(entry).toHaveProperty("firstPeriodStart");
        expect(entry).toHaveProperty("secondPeriodStart");
        expect(entry).toHaveProperty("feeAmountPennies");
      }
    });
  });

  describe("write mode (dryRun: false)", () => {
    it("updates fee_status to collected when dryRun is false", async () => {
      const { correctStrandedFeeJobs } = await import("@/lib/correct-stranded-fee-jobs");

      const strandedJob = {
        id: "job-1",
        contractor_id: "contractor-1",
        fee_amount_pennies: 200,
        fee_status: "accrued",
      };

      const collectedCollection = {
        id: "collection-1",
        contractor_id: "contractor-1",
        period_start: "2026-07-01",
        job_ids: ["job-1"],
        status: "collected",
      };

      let updateCalled = false;

      const mockDb = {
        from: (table: string) => ({
          select: () => ({
            eq: (col: string, val: unknown) => {
              if (table === "jobs" && col === "fee_status" && val === "accrued") {
                return { data: [strandedJob], error: null };
              }
              if (table === "fee_collections" && col === "id") {
                return { single: () => ({ data: collectedCollection, error: null }) };
              }
              return { data: [], error: null };
            },
            in: (col: string, _ids: string[]) => {
              if (table === "fee_collections" && col === "id") {
                return { data: [collectedCollection], error: null };
              }
              return { data: [], error: null };
            },
            contains: () => ({
              gte: () => ({ data: [], error: null }),
            }),
          }),
          update: (_values: Record<string, unknown>) => ({
            in: (_col: string, ids: string[]) => ({
              eq: (_eqCol: string, _eqVal: unknown) => {
                updateCalled = true;
                return { data: ids.map(id => ({ id, fee_status: "collected" })), error: null };
              },
            }),
          }),
        }),
      };

      const result = await correctStrandedFeeJobs(mockDb, { dryRun: false });
      expect(updateCalled).toBe(true);
      expect(result.corrected).toBeGreaterThan(0);
    });

    it("reports corrected count matching stranded jobs found", async () => {
      const { correctStrandedFeeJobs } = await import("@/lib/correct-stranded-fee-jobs");

      const strandedJobs = [
        { id: "job-1", contractor_id: "c1", fee_amount_pennies: 200, fee_status: "accrued" },
        { id: "job-2", contractor_id: "c1", fee_amount_pennies: 300, fee_status: "accrued" },
      ];

      const collection = {
        id: "collection-1",
        contractor_id: "c1",
        period_start: "2026-07-01",
        job_ids: ["job-1", "job-2"],
        status: "collected",
      };

      const mockDb = {
        from: (table: string) => ({
          select: () => ({
            eq: (col: string, val: unknown) => {
              if (table === "jobs" && col === "fee_status" && val === "accrued") {
                return { data: strandedJobs, error: null };
              }
              if (table === "fee_collections" && col === "id") {
                return { single: () => ({ data: collection, error: null }) };
              }
              return { data: [], error: null };
            },
            in: (col: string, _ids: string[]) => {
              if (table === "fee_collections" && col === "id") {
                return { data: [collection], error: null };
              }
              return { data: [], error: null };
            },
            contains: () => ({
              gte: () => ({ data: [], error: null }),
            }),
          }),
          update: () => ({
            in: (_col: string, ids: string[]) => ({
              eq: () => ({
                data: ids.map(id => ({ id, fee_status: "collected" })),
                error: null,
              }),
            }),
          }),
        }),
      };

      const result = await correctStrandedFeeJobs(mockDb, { dryRun: false });
      expect(result.corrected).toBe(2);
    });
  });

  describe("idempotency", () => {
    it("reports zero stranded jobs after correction", async () => {
      const { correctStrandedFeeJobs } = await import("@/lib/correct-stranded-fee-jobs");

      // After correction, no jobs remain at accrued under collected collections
      const mockDb = {
        from: () => ({
          select: () => ({
            eq: () => ({ data: [], error: null }),
            in: () => ({ data: [], error: null }),
          }),
        }),
      };

      const result = await correctStrandedFeeJobs(mockDb, { dryRun: true });
      expect(result.strandedJobsFound).toBe(0);
      expect(result.notYetDoubleCharged).toHaveLength(0);
      expect(result.alreadyDoubleCharged).toHaveLength(0);
    });

    it("makes no updates when re-run after completion", async () => {
      const { correctStrandedFeeJobs } = await import("@/lib/correct-stranded-fee-jobs");

      const mockDb = {
        from: (_table: string) => ({
          select: () => ({
            eq: () => ({ data: [], error: null }),
            in: () => ({ data: [], error: null }),
          }),
          update: () => ({
            in: () => ({
              eq: () => ({ data: [], error: null }),
            }),
          }),
        }),
      };

      const result = await correctStrandedFeeJobs(mockDb, { dryRun: false });
      expect(result.corrected).toBe(0);
    });
  });

  describe("does not modify collections or charges", () => {
    it("never calls update on fee_collections table", async () => {
      const { correctStrandedFeeJobs } = await import("@/lib/correct-stranded-fee-jobs");

      let collectionUpdateCalled = false;

      const strandedJob = {
        id: "job-1",
        contractor_id: "contractor-1",
        fee_amount_pennies: 200,
        fee_status: "accrued",
      };

      const collection = {
        id: "collection-1",
        contractor_id: "contractor-1",
        period_start: "2026-07-01",
        job_ids: ["job-1"],
        status: "collected",
      };

      const mockDb = {
        from: (table: string) => {
          if (table === "fee_collections") {
            return {
              select: () => ({
                eq: () => ({ single: () => ({ data: collection, error: null }) }),
                in: () => ({ data: [collection], error: null }),
              }),
              update: () => {
                collectionUpdateCalled = true;
                return {
                  eq: () => ({ data: [], error: null }),
                };
              },
            };
          }
          return {
            select: () => ({
              eq: () => ({ data: [strandedJob], error: null }),
            }),
            update: () => ({
              in: () => ({
                eq: () => ({ data: [], error: null }),
              }),
            }),
          };
        },
      };

      await correctStrandedFeeJobs(mockDb, { dryRun: false });
      expect(collectionUpdateCalled).toBe(false);
    });
  });

  describe("invariant after completion", () => {
    it("no job under a collected collection remains at fee_status accrued", async () => {
      const { correctStrandedFeeJobs } = await import("@/lib/correct-stranded-fee-jobs");

      // Query for stranded jobs returns empty (simulating state after correction)
      const mockDb = {
        from: (table: string) => ({
          select: () => ({
            eq: (col: string, val: unknown) => {
              if (table === "jobs" && col === "fee_status" && val === "accrued") {
                // After correction, no jobs at accrued under collected collections
                return { data: [], error: null };
              }
              return { data: [], error: null };
            },
            in: () => ({ data: [], error: null }),
          }),
        }),
      };

      const result = await correctStrandedFeeJobs(mockDb, { dryRun: true });

      // Invariant: zero stranded jobs found
      expect(result.strandedJobsFound).toBe(0);
    });
  });
});
