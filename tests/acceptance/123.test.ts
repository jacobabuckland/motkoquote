import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Issue #123: [BACKFILL] Correct duplicate referral_unlock credits
 *
 * These tests verify the detection and correction of duplicate referral_unlock
 * credit_events that occurred when a referee's first two jobs settled concurrently,
 * granting the referrer 10 free jobs instead of 5.
 */

// Type definitions matching the expected implementation
type CreditEvent = {
  id: string;
  contractor_id: string;
  delta: number;
  reason: string;
  related_job_id: string | null;
  related_referral_id: string | null;
  created_at: string; // ISO timestamp
};

type Contractor = {
  id: string;
  free_jobs_remaining: number;
};

type ContractorCorrection = {
  contractorId: string;
  surplusCredits: number; // Number of duplicate credits (e.g. 5 for one duplicate, 10 for two)
  currentBalance: number;
  resultingBalance: number;
  shortfall: number; // Credits already spent beyond entitlement
  eventIdsToDelete: string[];
};

type CorrectionPlan = {
  corrections: ContractorCorrection[];
};

import { computeReferralDuplicateCorrections } from "@/lib/correct-referral-duplicates";

describe("Issue #123: Correct duplicate referral_unlock credits", () => {
  describe("computeReferralDuplicateCorrections (pure analysis function)", () => {
    it("returns no corrections when there are no duplicates", () => {
      const events: CreditEvent[] = [
        {
          id: "evt-1",
          contractor_id: "contractor-a",
          delta: 5,
          reason: "referral_unlock",
          related_job_id: null,
          related_referral_id: "ref-1",
          created_at: "2026-01-01T10:00:00Z",
        },
        {
          id: "evt-2",
          contractor_id: "contractor-b",
          delta: 5,
          reason: "referral_unlock",
          related_job_id: null,
          related_referral_id: "ref-2",
          created_at: "2026-01-01T11:00:00Z",
        },
      ];
      const contractors: Contractor[] = [
        { id: "contractor-a", free_jobs_remaining: 5 },
        { id: "contractor-b", free_jobs_remaining: 5 },
      ];

      // Expected: no duplicates, so no corrections
      const plan = computeReferralDuplicateCorrections(events, contractors);
      expect(plan.corrections).toEqual([]);
    });

    it("detects and plans correction for a single duplicate (2 rows, same referral)", () => {
      const events: CreditEvent[] = [
        {
          id: "evt-1",
          contractor_id: "contractor-a",
          delta: 5,
          reason: "referral_unlock",
          related_job_id: null,
          related_referral_id: "ref-1",
          created_at: "2026-01-01T10:00:00Z", // Earlier
        },
        {
          id: "evt-2",
          contractor_id: "contractor-a",
          delta: 5,
          reason: "referral_unlock",
          related_job_id: null,
          related_referral_id: "ref-1",
          created_at: "2026-01-01T10:01:00Z", // Later
        },
      ];
      const contractors: Contractor[] = [
        { id: "contractor-a", free_jobs_remaining: 10 },
      ];

      const plan = computeReferralDuplicateCorrections(events, contractors);

      expect(plan.corrections).toHaveLength(1);
      expect(plan.corrections[0]).toEqual({
        contractorId: "contractor-a",
        surplusCredits: 5, // One duplicate = 5 surplus credits
        currentBalance: 10,
        resultingBalance: 5, // 10 - 5 = 5
        shortfall: 0,
        eventIdsToDelete: ["evt-2"], // Keep evt-1 (earlier), delete evt-2
      });
    });

    it("keeps the earliest created_at and deletes the later ones", () => {
      const events: CreditEvent[] = [
        {
          id: "evt-2",
          contractor_id: "contractor-a",
          delta: 5,
          reason: "referral_unlock",
          related_job_id: null,
          related_referral_id: "ref-1",
          created_at: "2026-01-01T10:01:00Z", // Middle
        },
        {
          id: "evt-1",
          contractor_id: "contractor-a",
          delta: 5,
          reason: "referral_unlock",
          related_job_id: null,
          related_referral_id: "ref-1",
          created_at: "2026-01-01T10:00:00Z", // Earliest
        },
        {
          id: "evt-3",
          contractor_id: "contractor-a",
          delta: 5,
          reason: "referral_unlock",
          related_job_id: null,
          related_referral_id: "ref-1",
          created_at: "2026-01-01T10:02:00Z", // Latest
        },
      ];
      const contractors: Contractor[] = [
        { id: "contractor-a", free_jobs_remaining: 15 },
      ];

      const plan = computeReferralDuplicateCorrections(events, contractors);

      expect(plan.corrections).toHaveLength(1);
      expect(plan.corrections[0]).toEqual({
        contractorId: "contractor-a",
        surplusCredits: 10, // Two duplicates = 10 surplus credits
        currentBalance: 15,
        resultingBalance: 5, // 15 - 10 = 5
        shortfall: 0,
        eventIdsToDelete: ["evt-2", "evt-3"], // Keep evt-1, delete the rest
      });
    });

    it("floors resulting balance at zero and records shortfall when balance is insufficient", () => {
      const events: CreditEvent[] = [
        {
          id: "evt-1",
          contractor_id: "contractor-a",
          delta: 5,
          reason: "referral_unlock",
          related_job_id: null,
          related_referral_id: "ref-1",
          created_at: "2026-01-01T10:00:00Z",
        },
        {
          id: "evt-2",
          contractor_id: "contractor-a",
          delta: 5,
          reason: "referral_unlock",
          related_job_id: null,
          related_referral_id: "ref-1",
          created_at: "2026-01-01T10:01:00Z",
        },
      ];
      const contractors: Contractor[] = [
        { id: "contractor-a", free_jobs_remaining: 2 }, // Only 2 remaining
      ];

      const plan = computeReferralDuplicateCorrections(events, contractors);

      expect(plan.corrections).toHaveLength(1);
      expect(plan.corrections[0]).toEqual({
        contractorId: "contractor-a",
        surplusCredits: 5,
        currentBalance: 2,
        resultingBalance: 0, // max(0, 2 - 5) = 0
        shortfall: 3, // 5 - 2 = 3 jobs already spent beyond entitlement
        eventIdsToDelete: ["evt-2"],
      });
    });

    it("handles multiple contractors with different duplicate counts", () => {
      const events: CreditEvent[] = [
        // Contractor A: one duplicate (2 rows)
        {
          id: "evt-a1",
          contractor_id: "contractor-a",
          delta: 5,
          reason: "referral_unlock",
          related_job_id: null,
          related_referral_id: "ref-a",
          created_at: "2026-01-01T10:00:00Z",
        },
        {
          id: "evt-a2",
          contractor_id: "contractor-a",
          delta: 5,
          reason: "referral_unlock",
          related_job_id: null,
          related_referral_id: "ref-a",
          created_at: "2026-01-01T10:01:00Z",
        },
        // Contractor B: no duplicates
        {
          id: "evt-b1",
          contractor_id: "contractor-b",
          delta: 5,
          reason: "referral_unlock",
          related_job_id: null,
          related_referral_id: "ref-b",
          created_at: "2026-01-01T11:00:00Z",
        },
        // Contractor C: two duplicates (3 rows)
        {
          id: "evt-c1",
          contractor_id: "contractor-c",
          delta: 5,
          reason: "referral_unlock",
          related_job_id: null,
          related_referral_id: "ref-c",
          created_at: "2026-01-01T12:00:00Z",
        },
        {
          id: "evt-c2",
          contractor_id: "contractor-c",
          delta: 5,
          reason: "referral_unlock",
          related_job_id: null,
          related_referral_id: "ref-c",
          created_at: "2026-01-01T12:01:00Z",
        },
        {
          id: "evt-c3",
          contractor_id: "contractor-c",
          delta: 5,
          reason: "referral_unlock",
          related_job_id: null,
          related_referral_id: "ref-c",
          created_at: "2026-01-01T12:02:00Z",
        },
      ];
      const contractors: Contractor[] = [
        { id: "contractor-a", free_jobs_remaining: 10 },
        { id: "contractor-b", free_jobs_remaining: 5 },
        { id: "contractor-c", free_jobs_remaining: 15 },
      ];

      const plan = computeReferralDuplicateCorrections(events, contractors);

      expect(plan.corrections).toHaveLength(2); // A and C, not B
      expect(plan.corrections).toContainEqual({
        contractorId: "contractor-a",
        surplusCredits: 5,
        currentBalance: 10,
        resultingBalance: 5,
        shortfall: 0,
        eventIdsToDelete: ["evt-a2"],
      });
      expect(plan.corrections).toContainEqual({
        contractorId: "contractor-c",
        surplusCredits: 10,
        currentBalance: 15,
        resultingBalance: 5,
        shortfall: 0,
        eventIdsToDelete: ["evt-c2", "evt-c3"],
      });
    });

    it("ignores credit_events with reason other than referral_unlock", () => {
      const events: CreditEvent[] = [
        {
          id: "evt-1",
          contractor_id: "contractor-a",
          delta: 5,
          reason: "signup_grant",
          related_job_id: null,
          related_referral_id: null,
          created_at: "2026-01-01T10:00:00Z",
        },
        {
          id: "evt-2",
          contractor_id: "contractor-a",
          delta: -1,
          reason: "job_consumed",
          related_job_id: "job-1",
          related_referral_id: null,
          created_at: "2026-01-01T11:00:00Z",
        },
        {
          id: "evt-3",
          contractor_id: "contractor-a",
          delta: 5,
          reason: "referral_unlock",
          related_job_id: null,
          related_referral_id: "ref-1",
          created_at: "2026-01-01T12:00:00Z",
        },
      ];
      const contractors: Contractor[] = [
        { id: "contractor-a", free_jobs_remaining: 9 },
      ];

      const plan = computeReferralDuplicateCorrections(events, contractors);

      // Only evt-3 is referral_unlock, and it has no duplicates
      expect(plan.corrections).toEqual([]);
    });

    it("handles orphaned credit_events (no matching contractor)", () => {
      const events: CreditEvent[] = [
        {
          id: "evt-1",
          contractor_id: "deleted-contractor",
          delta: 5,
          reason: "referral_unlock",
          related_job_id: null,
          related_referral_id: "ref-1",
          created_at: "2026-01-01T10:00:00Z",
        },
        {
          id: "evt-2",
          contractor_id: "deleted-contractor",
          delta: 5,
          reason: "referral_unlock",
          related_job_id: null,
          related_referral_id: "ref-1",
          created_at: "2026-01-01T10:01:00Z",
        },
      ];
      const contractors: Contractor[] = []; // No matching contractor

      const plan = computeReferralDuplicateCorrections(events, contractors);

      // Orphaned events are not corrected (contractor doesn't exist to update)
      // The spec says to list these separately in the report, but they don't
      // result in a correction plan (no contractor to decrement).
      expect(plan.corrections).toEqual([]);
    });

    it("is deterministic when duplicate created_at timestamps are identical", () => {
      const events: CreditEvent[] = [
        {
          id: "evt-1",
          contractor_id: "contractor-a",
          delta: 5,
          reason: "referral_unlock",
          related_job_id: null,
          related_referral_id: "ref-1",
          created_at: "2026-01-01T10:00:00.000Z",
        },
        {
          id: "evt-2",
          contractor_id: "contractor-a",
          delta: 5,
          reason: "referral_unlock",
          related_job_id: null,
          related_referral_id: "ref-1",
          created_at: "2026-01-01T10:00:00.000Z", // Identical timestamp
        },
      ];
      const contractors: Contractor[] = [
        { id: "contractor-a", free_jobs_remaining: 10 },
      ];

      const plan = computeReferralDuplicateCorrections(events, contractors);

      // With identical timestamps, tie-break by event ID (lexicographic order)
      // Keep evt-1 (earlier ID), delete evt-2
      expect(plan.corrections).toHaveLength(1);
      expect(plan.corrections[0].eventIdsToDelete).toHaveLength(1);
      // The exact ID kept is deterministic (earliest by created_at, then by ID)
      const kept = ["evt-1", "evt-2"].find(
        (id) => !plan.corrections[0].eventIdsToDelete.includes(id)
      );
      expect(kept).toBe("evt-1");
    });
  });

  describe("correctReferralDuplicates (async runner with database)", () => {
    // A minimal stand-in for the service-role Supabase client, recording every
    // call so each test can assert on what actually reached the database.
    type Call = { op: string; args: unknown[] };

    // The runner chains .select(...).eq(...) on credit_events and plain
    // .select(...) on contractors, so the select result must be both awaitable
    // and chainable.
    const makeAdmin = (
      events: CreditEvent[],
      contractors: Contractor[],
      opts: { failDecrementFor?: string } = {},
    ) => {
      const calls: Call[] = [];
      const rows = (data: unknown) => {
        const p = Promise.resolve({ data, error: null });
        return Object.assign(p, { eq: () => p });
      };
      const client = {
        from(table: string) {
          return {
            select: () => {
              calls.push({ op: `select:${table}`, args: [] });
              return rows(table === "credit_events" ? events : contractors);
            },
            delete: () => ({
              in: (_col: string, ids: string[]) => {
                calls.push({ op: `delete:${table}`, args: [ids] });
                return Promise.resolve({ error: null });
              },
            }),
          };
        },
        rpc(fn: string, args: Record<string, unknown>) {
          calls.push({ op: `rpc:${fn}`, args: [args] });
          if (opts.failDecrementFor && args.p_id === opts.failDecrementFor) {
            return Promise.resolve({ error: { message: "connection lost" } });
          }
          return Promise.resolve({ error: null });
        },
      };
      return { admin: client as unknown as SupabaseClient, calls };
    };

    // One referral credited twice: two referral_unlock rows, +5 each.
    const duplicateFixture = () => ({
      events: [
        {
          id: "evt-1",
          contractor_id: "c-1",
          delta: 5,
          reason: "referral_unlock",
          related_referral_id: "ref-1",
          created_at: "2026-07-01T10:00:00Z",
        },
        {
          id: "evt-2",
          contractor_id: "c-1",
          delta: 5,
          reason: "referral_unlock",
          related_referral_id: "ref-1",
          created_at: "2026-07-01T10:00:01Z",
        },
      ] as CreditEvent[],
      contractors: [{ id: "c-1", free_jobs_remaining: 10 }] as Contractor[],
    });

    it("dry-run mode returns report without modifying the database", async () => {
      const mod = await import("@/lib/correct-referral-duplicates");
      const { events, contractors } = duplicateFixture();
      const { admin, calls } = makeAdmin(events, contractors);

      const report = await mod.correctReferralDuplicates(admin, {
        dryRun: true,
        applyCorrections: false,
      });

      expect(report.affectedContractors).toBe(1);
      expect(report.totalSurplusCredits).toBe(5);

      const ops = calls.map((c) => c.op);
      expect(ops.some((o) => o.startsWith("delete:"))).toBe(false);
      expect(ops.some((o) => o.startsWith("rpc:"))).toBe(false);
    });

    it("correcting write mode deletes surplus events and decrements balances", async () => {
      const mod = await import("@/lib/correct-referral-duplicates");
      const { events, contractors } = duplicateFixture();
      const { admin, calls } = makeAdmin(events, contractors);

      await mod.correctReferralDuplicates(admin, {
        dryRun: false,
        applyCorrections: true,
      });

      const del = calls.find((c) => c.op === "delete:credit_events");
      expect(del).toBeDefined();
      // The earliest event is kept; only the later duplicate is removed.
      expect(del!.args[0]).toEqual(["evt-2"]);

      const rpc = calls
        .find((c) => c.op === "rpc:increment_free_jobs_remaining");
      expect(rpc).toBeDefined();
      expect(rpc!.args[0]).toMatchObject({ p_id: "c-1", p_delta: -5 });
    });

    it("a failed decrement is reported as a partial correction, not rolled back", async () => {
      // Criterion 7: the delete and the decrement are sequential, not atomic.
      // Supabase has no client-side transaction control, so a failure after the
      // delete leaves the ledger corrected and the cache briefly stale. That
      // must be reported by contractor id rather than silently swallowed — the
      // nightly reconcile closes the gap, and a retry needs to know who to fix.
      const mod = await import("@/lib/correct-referral-duplicates");
      const { events, contractors } = duplicateFixture();
      const { admin, calls } = makeAdmin(events, contractors, {
        failDecrementFor: "c-1",
      });

      const report = await mod.correctReferralDuplicates(admin, {
        dryRun: false,
        applyCorrections: true,
      });

      // The delete still went through — there is no rollback to undo it.
      expect(
        calls.some((c) => c.op === "delete:credit_events"),
      ).toBe(true);

      const failed = report.failedContractors ?? [];
      expect(failed).toHaveLength(1);
      expect(failed[0].contractorId).toBe("c-1");
      expect(report.successfulContractors ?? []).not.toContain("c-1");
    });

    it("is idempotent: running correction twice makes no changes the second time", async () => {
      const mod = await import("@/lib/correct-referral-duplicates");

      // Second run sees the already-corrected state: one referral_unlock row.
      const { admin, calls } = makeAdmin(
        [
          {
            id: "evt-1",
            contractor_id: "c-1",
            delta: 5,
            reason: "referral_unlock",
            related_referral_id: "ref-1",
            created_at: "2026-07-01T10:00:00Z",
          },
        ] as CreditEvent[],
        [{ id: "c-1", free_jobs_remaining: 5 }] as Contractor[],
      );

      const report = await mod.correctReferralDuplicates(admin, {
        dryRun: false,
        applyCorrections: true,
      });

      expect(report.affectedContractors).toBe(0);
      expect(report.totalSurplusCredits).toBe(0);
      const ops = calls.map((c) => c.op);
      expect(ops.some((o) => o.startsWith("delete:"))).toBe(false);
      expect(ops.some((o) => o.startsWith("rpc:"))).toBe(false);
    });

    it("report structure includes all required fields", async () => {
      const mod = await import("@/lib/correct-referral-duplicates");
      const { events, contractors } = duplicateFixture();
      const { admin } = makeAdmin(events, contractors);

      const report = await mod.correctReferralDuplicates(admin, {
        dryRun: true,
      });

      expect(typeof report.affectedContractors).toBe("number");
      expect(typeof report.totalSurplusCredits).toBe("number");
      expect(Array.isArray(report.corrections)).toBe(true);
      expect(typeof report.timestamp).toBe("string");
      expect(Number.isNaN(Date.parse(report.timestamp))).toBe(false);
    });
  });
});

// Stub implementation for the pure function so the tests can run (will fail until implemented)
// The real implementation is imported at the top of this file. It previously
// carried a local stub here that always threw, which made these tests fail
// identically whatever the Engineer built — a test that cannot observe the
// implementation cannot be satisfied by one.
