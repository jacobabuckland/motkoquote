import { describe, expect, it } from "vitest";

/**
 * Issue #188: [BACKFILL] Recover fees lost to concurrent over-waiving of free jobs
 *
 * These tests verify that the backfill correctly detects jobs that were waived
 * when no free credit was actually available (due to concurrent settlement race),
 * produces a dry-run report, and can correct the affected jobs by accruing the
 * fee and returning the credit.
 */

describe("Issue #188: Recover fees lost to concurrent over-waiving", () => {
  describe("Detection logic exists and is pure", () => {
    it("exports a detectOverWaivedJobs function from the detection module", async () => {
      const mod = await import("@/lib/detect-over-waived-jobs");
      expect(mod.detectOverWaivedJobs).toBeDefined();
      expect(typeof mod.detectOverWaivedJobs).toBe("function");
    });

    it("accepts credit events ordered by created_at and returns detected issues", async () => {
      const { detectOverWaivedJobs } = await import("@/lib/detect-over-waived-jobs");

      // Minimal test case: contractor starts with 5 free jobs (signup grant),
      // then two jobs consume them. Neither is invalid in this case because
      // balance starts at 5.
      const events = [
        {
          contractor_id: "c1",
          delta: 5,
          reason: "signup_grant",
          related_job_id: null,
          created_at: "2026-01-01T10:00:00Z",
        },
        {
          contractor_id: "c1",
          delta: -1,
          reason: "job_consumed",
          related_job_id: "job1",
          created_at: "2026-01-01T10:05:00Z",
        },
        {
          contractor_id: "c1",
          delta: -1,
          reason: "job_consumed",
          related_job_id: "job2",
          created_at: "2026-01-01T10:05:01Z",
        },
      ];

      const result = detectOverWaivedJobs(events);

      // Balance progression: +5 → 5, -1 → 4, -1 → 3
      // No over-waives detected (both jobs consumed when balance > 0)
      expect(result.overWaivedJobs).toHaveLength(0);
    });

    it("detects jobs consumed when balance was zero", async () => {
      const { detectOverWaivedJobs } = await import("@/lib/detect-over-waived-jobs");

      const events = [
        {
          contractor_id: "c1",
          delta: 1,
          reason: "signup_grant",
          related_job_id: null,
          created_at: "2026-01-01T10:00:00Z",
        },
        {
          contractor_id: "c1",
          delta: -1,
          reason: "job_consumed",
          related_job_id: "job1",
          created_at: "2026-01-01T11:00:00Z",
        },
        {
          contractor_id: "c1",
          delta: -1,
          reason: "job_consumed",
          related_job_id: "job2",
          created_at: "2026-01-01T11:00:01Z",
        },
      ];

      const result = detectOverWaivedJobs(events);

      expect(result.overWaivedJobs).toHaveLength(1);
      expect(result.overWaivedJobs[0].jobId).toBe("job2");
      expect(result.overWaivedJobs[0].balanceAtConsumption).toBe(0);
      expect(result.overWaivedJobs[0].timestamp).toBe("2026-01-01T11:00:01Z");
    });

    it("detects jobs consumed when balance was negative", async () => {
      const { detectOverWaivedJobs } = await import("@/lib/detect-over-waived-jobs");

      const events = [
        {
          contractor_id: "c1",
          delta: 1,
          reason: "signup_grant",
          related_job_id: null,
          created_at: "2026-01-01T10:00:00Z",
        },
        {
          contractor_id: "c1",
          delta: -1,
          reason: "job_consumed",
          related_job_id: "job1",
          created_at: "2026-01-01T11:00:00Z",
        },
        {
          contractor_id: "c1",
          delta: -1,
          reason: "job_consumed",
          related_job_id: "job2",
          created_at: "2026-01-01T11:00:01Z",
        },
        {
          contractor_id: "c1",
          delta: -1,
          reason: "job_consumed",
          related_job_id: "job3",
          created_at: "2026-01-01T11:00:02Z",
        },
      ];

      const result = detectOverWaivedJobs(events);

      // job1: balance before = 1, consumes → balance after = 0 (VALID)
      // job2: balance before = 0, consumes → balance after = -1 (INVALID)
      // job3: balance before = -1, consumes → balance after = -2 (INVALID)
      expect(result.overWaivedJobs).toHaveLength(2);
      expect(result.overWaivedJobs[0].jobId).toBe("job2");
      expect(result.overWaivedJobs[0].balanceAtConsumption).toBe(0);
      expect(result.overWaivedJobs[1].jobId).toBe("job3");
      expect(result.overWaivedJobs[1].balanceAtConsumption).toBe(-1);
    });

    it("handles contractors with no credit events (balance always zero)", async () => {
      const { detectOverWaivedJobs } = await import("@/lib/detect-over-waived-jobs");

      const events: unknown[] = [];

      const result = detectOverWaivedJobs(events);

      expect(result.overWaivedJobs).toHaveLength(0);
      expect(result.earliestReliableTimestamp).toBeNull();
    });

    it("correctly orders events by created_at for reconstruction", async () => {
      const { detectOverWaivedJobs } = await import("@/lib/detect-over-waived-jobs");

      // Events provided out of order; detection should sort by created_at
      const events = [
        {
          contractor_id: "c1",
          delta: -1,
          reason: "job_consumed",
          related_job_id: "job2",
          created_at: "2026-01-01T11:00:01Z",
        },
        {
          contractor_id: "c1",
          delta: 1,
          reason: "signup_grant",
          related_job_id: null,
          created_at: "2026-01-01T10:00:00Z",
        },
        {
          contractor_id: "c1",
          delta: -1,
          reason: "job_consumed",
          related_job_id: "job1",
          created_at: "2026-01-01T11:00:00Z",
        },
      ];

      const result = detectOverWaivedJobs(events);

      // After sorting: signup (+1), job1 (-1), job2 (-1)
      // job2 is invalid (balance was 0)
      expect(result.overWaivedJobs).toHaveLength(1);
      expect(result.overWaivedJobs[0].jobId).toBe("job2");
    });
  });

  describe("Edge case: identical timestamps", () => {
    it("flags job pairs with identical created_at as ambiguous", async () => {
      const { detectOverWaivedJobs } = await import("@/lib/detect-over-waived-jobs");

      const events = [
        {
          contractor_id: "c1",
          delta: 1,
          reason: "signup_grant",
          related_job_id: null,
          created_at: "2026-01-01T10:00:00Z",
        },
        {
          contractor_id: "c1",
          delta: -1,
          reason: "job_consumed",
          related_job_id: "job1",
          created_at: "2026-01-01T11:00:00.000Z",
        },
        {
          contractor_id: "c1",
          delta: -1,
          reason: "job_consumed",
          related_job_id: "job2",
          created_at: "2026-01-01T11:00:00.000Z", // Identical to job1
        },
      ];

      const result = detectOverWaivedJobs(events);

      // Should flag both job1 and job2 as ambiguous (cannot determine order)
      expect(result.ambiguousJobs).toBeDefined();
      expect(result.ambiguousJobs.length).toBeGreaterThan(0);
      expect(result.ambiguousJobs).toContain("job1");
      expect(result.ambiguousJobs).toContain("job2");

      // Ambiguous jobs should NOT appear in overWaivedJobs
      const overWaivedJobIds = result.overWaivedJobs.map((j: { jobId: string }) => j.jobId);
      expect(overWaivedJobIds).not.toContain("job1");
      expect(overWaivedJobIds).not.toContain("job2");
    });
  });

  describe("Edge case: incomplete event history", () => {
    it("computes earliestReliableTimestamp from minimum created_at", async () => {
      const { detectOverWaivedJobs } = await import("@/lib/detect-over-waived-jobs");

      const events = [
        {
          contractor_id: "c1",
          delta: 5,
          reason: "signup_grant",
          related_job_id: null,
          created_at: "2026-01-01T10:00:00Z",
        },
        {
          contractor_id: "c1",
          delta: -1,
          reason: "job_consumed",
          related_job_id: "job1",
          created_at: "2026-01-01T11:00:00Z",
        },
      ];

      const result = detectOverWaivedJobs(events);

      expect(result.earliestReliableTimestamp).toBe("2026-01-01T10:00:00Z");
    });

    it("returns null earliestReliableTimestamp when no events exist", async () => {
      const { detectOverWaivedJobs } = await import("@/lib/detect-over-waived-jobs");

      const result = detectOverWaivedJobs([]);

      expect(result.earliestReliableTimestamp).toBeNull();
    });
  });

  describe("Edge case: jobs with no job_value_pennies", () => {
    it("marks jobs with null job_value_pennies as skipped in detection result", async () => {
      const { detectOverWaivedJobs } = await import("@/lib/detect-over-waived-jobs");

      // This test verifies the detection result structure, but the actual
      // job_value_pennies lookup would happen in the correction phase, not
      // in the pure detection function (which only sees credit_events).
      // So this test may need to be adjusted based on the actual API design.

      // For now, assume detection only identifies over-waived job IDs, and
      // the correction phase (not tested here) handles the job_value lookup
      // and skips jobs with null values. This test is a placeholder.

      const events = [
        {
          contractor_id: "c1",
          delta: 1,
          reason: "signup_grant",
          related_job_id: null,
          created_at: "2026-01-01T10:00:00Z",
        },
        {
          contractor_id: "c1",
          delta: -1,
          reason: "job_consumed",
          related_job_id: "job-no-value",
          created_at: "2026-01-01T11:00:00Z",
        },
        {
          contractor_id: "c1",
          delta: -1,
          reason: "job_consumed",
          related_job_id: "job-with-value",
          created_at: "2026-01-01T11:00:01Z",
        },
      ];

      const result = detectOverWaivedJobs(events);

      // job-with-value is over-waived (balance was 0)
      expect(result.overWaivedJobs).toHaveLength(1);
      expect(result.overWaivedJobs[0].jobId).toBe("job-with-value");
    });
  });

  describe("Dry-run mode", () => {
    it("exports a runBackfillDryRun function from the script module", async () => {
      const mod = await import("@/scripts/backfill/recover-over-waived-fees");
      expect(mod.runBackfillDryRun).toBeDefined();
      expect(typeof mod.runBackfillDryRun).toBe("function");
    });

    it("produces a report structure with contractors, jobs, and totals", async () => {
      const { runBackfillDryRun } = await import("@/scripts/backfill/recover-over-waived-fees");

      // Mock Supabase client (the real test would use a test database or mocks)
      const mockSupabase = {
        from: () => ({
          select: () => ({
            data: [
              {
                contractor_id: "c1",
                delta: 1,
                reason: "signup_grant",
                related_job_id: null,
                created_at: "2026-01-01T10:00:00Z",
              },
              {
                contractor_id: "c1",
                delta: -1,
                reason: "job_consumed",
                related_job_id: "job1",
                created_at: "2026-01-01T11:00:00Z",
              },
              {
                contractor_id: "c1",
                delta: -1,
                reason: "job_consumed",
                related_job_id: "job2",
                created_at: "2026-01-01T11:00:01Z",
              },
            ],
            error: null,
          }),
        }),
      };

      const report = await runBackfillDryRun(mockSupabase as never);

      expect(report).toHaveProperty("earliestReliableDate");
      expect(report).toHaveProperty("contractorsAffected");
      expect(report).toHaveProperty("totalJobsAffected");
      expect(report).toHaveProperty("totalFeesToRecoverPennies");
      expect(report).toHaveProperty("contractors");
      expect(Array.isArray(report.contractors)).toBe(true);
    });

    it("reports zero affected when no over-waives are detected", async () => {
      const { runBackfillDryRun } = await import("@/scripts/backfill/recover-over-waived-fees");

      const mockSupabase = {
        from: () => ({
          select: () => ({
            data: [
              {
                contractor_id: "c1",
                delta: 5,
                reason: "signup_grant",
                related_job_id: null,
                created_at: "2026-01-01T10:00:00Z",
              },
              {
                contractor_id: "c1",
                delta: -1,
                reason: "job_consumed",
                related_job_id: "job1",
                created_at: "2026-01-01T11:00:00Z",
              },
            ],
            error: null,
          }),
        }),
      };

      const report = await runBackfillDryRun(mockSupabase as never);

      expect(report.contractorsAffected).toBe(0);
      expect(report.totalJobsAffected).toBe(0);
      expect(report.totalFeesToRecoverPennies).toBe(0);
    });
  });

  describe("Correction mode", () => {
    it("exports a runBackfillCorrection function that requires contractor ID", async () => {
      const mod = await import("@/scripts/backfill/recover-over-waived-fees");
      expect(mod.runBackfillCorrection).toBeDefined();
      expect(typeof mod.runBackfillCorrection).toBe("function");
    });

    it("errors if no contractor ID is provided", async () => {
      const { runBackfillCorrection } = await import("@/scripts/backfill/recover-over-waived-fees");

      const mockSupabase = {} as never;

      await expect(runBackfillCorrection(mockSupabase, { contractorId: null as never })).rejects.toThrow(
        /contractor.*required/i
      );
    });

    it("changes fee_status from not_applicable to accrued for over-waived jobs", async () => {
      const { runBackfillCorrection } = await import("@/scripts/backfill/recover-over-waived-fees");

      // This test would verify that the correction SQL updates jobs.fee_status.
      // Since it requires a real or heavily mocked database, this is a structural
      // assertion: the function should return a summary including jobsCorrected.

      const mockSupabase = {
        from: () => ({
          select: () => ({
            data: [
              {
                contractor_id: "c1",
                delta: 1,
                reason: "signup_grant",
                related_job_id: null,
                created_at: "2026-01-01T10:00:00Z",
              },
              {
                contractor_id: "c1",
                delta: -1,
                reason: "job_consumed",
                related_job_id: "job1",
                created_at: "2026-01-01T11:00:00Z",
              },
              {
                contractor_id: "c1",
                delta: -1,
                reason: "job_consumed",
                related_job_id: "job2",
                created_at: "2026-01-01T11:00:01Z",
              },
            ],
            error: null,
          }),
          update: () => ({
            eq: () => ({
              select: () => ({ data: [{ id: "job2" }], error: null }),
            }),
          }),
          delete: () => ({
            eq: () => ({ error: null }),
          }),
          insert: () => ({ data: [{ id: "coll1" }], error: null }),
        }),
        rpc: () => Promise.resolve({ error: null }),
      };

      const result = await runBackfillCorrection(mockSupabase as never, { contractorId: "c1" });

      expect(result).toHaveProperty("contractorId", "c1");
      expect(result).toHaveProperty("jobsCorrected");
      expect(result.jobsCorrected).toBeGreaterThan(0);
    });

    it("deletes the invalid job_consumed credit event", async () => {
      const { runBackfillCorrection } = await import("@/scripts/backfill/recover-over-waived-fees");

      // Verify that the correction deletes the credit_events row with
      // reason = 'job_consumed' and related_job_id = <over-waived job>.

      // This is an integration-style assertion that would check the SQL
      // generated or the mock call log. For acceptance, we assert that
      // the function's return value includes eventsDeleted > 0.

      const mockSupabase = {
        from: () => ({
          select: () => ({
            data: [
              {
                contractor_id: "c1",
                delta: 1,
                reason: "signup_grant",
                related_job_id: null,
                created_at: "2026-01-01T10:00:00Z",
              },
              {
                contractor_id: "c1",
                delta: -1,
                reason: "job_consumed",
                related_job_id: "job1",
                created_at: "2026-01-01T11:00:00Z",
              },
              {
                contractor_id: "c1",
                delta: -1,
                reason: "job_consumed",
                related_job_id: "job2",
                created_at: "2026-01-01T11:00:01Z",
              },
            ],
            error: null,
          }),
          update: () => ({
            eq: () => ({
              select: () => ({ data: [{ id: "job2" }], error: null }),
            }),
          }),
          delete: () => ({
            eq: () => ({ error: null }),
          }),
          insert: () => ({ data: [{ id: "coll1" }], error: null }),
        }),
        rpc: () => Promise.resolve({ error: null }),
      };

      const result = await runBackfillCorrection(mockSupabase as never, { contractorId: "c1" });

      expect(result).toHaveProperty("eventsDeleted");
      expect(result.eventsDeleted).toBeGreaterThan(0);
    });

    it("returns credit to contractor balance via increment_free_jobs_remaining", async () => {
      const { runBackfillCorrection } = await import("@/scripts/backfill/recover-over-waived-fees");

      const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];

      const mockSupabase = {
        from: () => ({
          select: () => ({
            data: [
              {
                contractor_id: "c1",
                delta: 1,
                reason: "signup_grant",
                related_job_id: null,
                created_at: "2026-01-01T10:00:00Z",
              },
              {
                contractor_id: "c1",
                delta: -1,
                reason: "job_consumed",
                related_job_id: "job1",
                created_at: "2026-01-01T11:00:00Z",
              },
              {
                contractor_id: "c1",
                delta: -1,
                reason: "job_consumed",
                related_job_id: "job2",
                created_at: "2026-01-01T11:00:01Z",
              },
            ],
            error: null,
          }),
          update: () => ({
            eq: () => ({
              select: () => ({ data: [{ id: "job2" }], error: null }),
            }),
          }),
          delete: () => ({
            eq: () => ({ error: null }),
          }),
          insert: () => ({ data: [{ id: "coll1" }], error: null }),
        }),
        rpc: (name: string, args: Record<string, unknown>) => {
          rpcCalls.push({ name, args });
          return Promise.resolve({ error: null });
        },
      };

      await runBackfillCorrection(mockSupabase as never, { contractorId: "c1" });

      const incrementCalls = rpcCalls.filter((c) => c.name === "increment_free_jobs_remaining");
      expect(incrementCalls.length).toBeGreaterThan(0);
      expect(incrementCalls[0].args).toHaveProperty("p_id", "c1");
      expect(incrementCalls[0].args).toHaveProperty("p_delta", 1);
    });

    it("creates a one-off fee_collection with period_start = period_end", async () => {
      const { runBackfillCorrection } = await import("@/scripts/backfill/recover-over-waived-fees");

      const insertCalls: Array<{ table: string; data: Record<string, unknown> }> = [];

      const mockSupabase = {
        from: (table: string) => {
          if (table === "credit_events") {
            return {
              select: () => ({
                data: [
                  {
                    contractor_id: "c1",
                    delta: 1,
                    reason: "signup_grant",
                    related_job_id: null,
                    created_at: "2026-01-01T10:00:00Z",
                  },
                  {
                    contractor_id: "c1",
                    delta: -1,
                    reason: "job_consumed",
                    related_job_id: "job1",
                    created_at: "2026-01-01T11:00:00Z",
                  },
                  {
                    contractor_id: "c1",
                    delta: -1,
                    reason: "job_consumed",
                    related_job_id: "job2",
                    created_at: "2026-01-01T11:00:01Z",
                  },
                ],
                error: null,
              }),
              delete: () => ({
                eq: () => ({ error: null }),
              }),
            };
          } else if (table === "jobs") {
            return {
              update: () => ({
                eq: () => ({
                  select: () => ({ data: [{ id: "job2" }], error: null }),
                }),
              }),
            };
          } else if (table === "fee_collections") {
            return {
              insert: (data: Record<string, unknown>) => {
                insertCalls.push({ table, data });
                return { data: [{ id: "coll1" }], error: null };
              },
            };
          }
          return {};
        },
        rpc: () => Promise.resolve({ error: null }),
      };

      await runBackfillCorrection(mockSupabase as never, { contractorId: "c1" });

      expect(insertCalls.length).toBeGreaterThan(0);
      const collectionInsert = insertCalls.find((c) => c.table === "fee_collections");
      expect(collectionInsert).toBeDefined();
      expect(collectionInsert?.data).toHaveProperty("contractor_id", "c1");
      expect(collectionInsert?.data).toHaveProperty("status", "pending");
      // period_start and period_end should be the same (one-off collection)
      expect(collectionInsert?.data).toHaveProperty("period_start");
      expect(collectionInsert?.data).toHaveProperty("period_end");
      expect(collectionInsert?.data.period_start).toBe(collectionInsert?.data.period_end);
    });
  });

  describe("Idempotency", () => {
    it("reports zero rows affected when re-running correction for an already-corrected contractor", async () => {
      const { runBackfillCorrection } = await import("@/scripts/backfill/recover-over-waived-fees");

      // After correction, the invalid job_consumed event is deleted, so
      // re-running detection for the same contractor finds no over-waived jobs.

      const mockSupabase = {
        from: () => ({
          select: () => ({
            data: [
              {
                contractor_id: "c1",
                delta: 1,
                reason: "signup_grant",
                related_job_id: null,
                created_at: "2026-01-01T10:00:00Z",
              },
              {
                contractor_id: "c1",
                delta: -1,
                reason: "job_consumed",
                related_job_id: "job1",
                created_at: "2026-01-01T11:00:00Z",
              },
              // job2's event was deleted in the first correction run, so it's absent here
            ],
            error: null,
          }),
          update: () => ({
            eq: () => ({
              select: () => ({ data: [], error: null }), // No jobs to update
            }),
          }),
          delete: () => ({
            eq: () => ({ error: null }),
          }),
          insert: () => ({ data: [], error: null }),
        }),
        rpc: () => Promise.resolve({ error: null }),
      };

      const result = await runBackfillCorrection(mockSupabase as never, { contractorId: "c1" });

      expect(result.jobsCorrected).toBe(0);
      expect(result.eventsDeleted).toBe(0);
    });
  });
});
