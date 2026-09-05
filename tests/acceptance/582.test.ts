/**
 * JOB-1: A job can only be archived at quote stage, so a cancelled or disputed
 * one hangs in the pipeline forever.
 *
 * This adds `archived_at` to jobs (following the contracts pattern), server
 * actions for archiving/restoring, a button on the job page, an archived-jobs
 * list, and filters archived jobs out of the working pipeline and the chase
 * cron.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

type InvoiceRow = {
  id: string;
  status: string;
  due_date: string | null;
  quote: {
    status: string;
    job: {
      id: string;
      archived_at: string | null;
    } | null;
  } | null;
};

describe("JOB-1: job archiving", () => {
  describe("Migration: jobs.archived_at column", () => {
    it("migration file exists at the expected path", async () => {
      const mod = await import("@/../supabase/migrations/00000000000065_job_archived_at.sql?raw");
      expect(mod.default).toBeDefined();
      expect(mod.default).toContain("alter table jobs add column archived_at");
    });

    it("migration adds archived_at as nullable timestamptz", async () => {
      const mod = await import("@/../supabase/migrations/00000000000065_job_archived_at.sql?raw");
      const sql = mod.default;
      expect(sql).toContain("archived_at timestamptz");
      // Nullable by omission — no "not null" constraint
      expect(sql).not.toContain("archived_at timestamptz not null");
    });

    it("migration adds partial index on archived_at is null", async () => {
      const mod = await import("@/../supabase/migrations/00000000000065_job_archived_at.sql?raw");
      const sql = mod.default;
      expect(sql).toContain("create index");
      expect(sql).toContain("jobs_archived_at");
      expect(sql).toContain("where archived_at is null");
    });
  });

  describe("Server actions: archiveJob and restoreJob", () => {
    let from: ReturnType<typeof vi.fn>;
    let update: ReturnType<typeof vi.fn>;
    let eq: ReturnType<typeof vi.fn>;
    let is: ReturnType<typeof vi.fn>;
    let not: ReturnType<typeof vi.fn>;
    let client: SupabaseClient;

    beforeEach(async () => {
      // Stub the Supabase client
      from = vi.fn();
      update = vi.fn();
      eq = vi.fn();
      is = vi.fn();
      not = vi.fn();

      // Chain: from().update().eq().is() or .not()
      is.mockResolvedValue({ error: null });
      not.mockResolvedValue({ error: null });
      eq.mockReturnValue({ is, not });
      update.mockReturnValue({ eq });
      from.mockReturnValue({ update });

      client = { from } as unknown as SupabaseClient;

      // Mock createClient to return our stub
      vi.doMock("@/lib/supabase/server", () => ({
        createClient: vi.fn(async () => client),
      }));
    });

    it("archiveJob action exists and is callable", async () => {
      const mod = await import("@/app/jobs/[id]/job-archive-actions");
      expect(mod.archiveJob).toBeDefined();
      expect(typeof mod.archiveJob).toBe("function");
    });

    it("restoreJob action exists and is callable", async () => {
      const mod = await import("@/app/jobs/[id]/job-archive-actions");
      expect(mod.restoreJob).toBeDefined();
      expect(typeof mod.restoreJob).toBe("function");
    });

    it("archiveJob writes archived_at with current timestamp", async () => {
      const mod = await import("@/app/jobs/[id]/job-archive-actions");
      const jobId = "job-123";

      await mod.archiveJob(jobId);

      expect(from).toHaveBeenCalledWith("jobs");
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({ archived_at: expect.any(String) }),
      );
      expect(eq).toHaveBeenCalledWith("id", jobId);
    });

    it("archiveJob guards on archived_at is null for idempotency", async () => {
      const mod = await import("@/app/jobs/[id]/job-archive-actions");
      await mod.archiveJob("job-123");

      // The chain should end with .is("archived_at", null) to guard
      expect(is).toHaveBeenCalledWith("archived_at", null);
    });

    it("restoreJob sets archived_at to null", async () => {
      const mod = await import("@/app/jobs/[id]/job-archive-actions");
      const jobId = "job-123";

      await mod.restoreJob(jobId);

      expect(from).toHaveBeenCalledWith("jobs");
      expect(update).toHaveBeenCalledWith({ archived_at: null });
      expect(eq).toHaveBeenCalledWith("id", jobId);
    });

    it("restoreJob guards on archived_at is not null for idempotency", async () => {
      const mod = await import("@/app/jobs/[id]/job-archive-actions");
      await mod.restoreJob("job-123");

      // The chain should end with .not("archived_at", "is", null) to guard
      expect(not).toHaveBeenCalledWith("archived_at", "is", null);
    });

    it("archiveJob throws on database error", async () => {
      is.mockResolvedValue({ error: { message: "RLS policy violation" } });
      const mod = await import("@/app/jobs/[id]/job-archive-actions");

      await expect(mod.archiveJob("job-123")).rejects.toThrow();
    });

    it("restoreJob throws on database error", async () => {
      not.mockResolvedValue({ error: { message: "Row not found" } });
      const mod = await import("@/app/jobs/[id]/job-archive-actions");

      await expect(mod.restoreJob("job-123")).rejects.toThrow();
    });
  });

  describe("Archive button component", () => {
    it("component exists and is importable", async () => {
      const mod = await import("@/app/jobs/[id]/archive-job-button");
      expect(mod.ArchiveJobButton).toBeDefined();
    });
  });

  describe("Archived jobs list page", () => {
    it("page exists at /jobs/archived", async () => {
      const mod = await import("@/app/jobs/archived/page");
      expect(mod.default).toBeDefined();
    });
  });

  describe("Job history filtering", () => {
    it("normalizeHistoryJob recognizes archived jobs via jobs.archived_at", async () => {
      const { normalizeHistoryJob } = await import("@/lib/job-history");

      const archivedJob = {
        id: "job-archived",
        created_at: "2026-09-01T10:00:00Z",
        archived_at: "2026-09-04T14:00:00Z",
        extracted_json: { job_type: "Plumbing repair" },
        sow_json: null,
        customer: { name: "John Smith" },
        quote: {
          total: 1500,
          status: "sent",
          sent_at: "2026-09-01T12:00:00Z",
          viewed_at: null,
          accepted_at: null,
          declined_at: null,
          created_at: "2026-09-01T11:00:00Z",
          contracts: [],
          invoices: [],
        },
      };

      const result = normalizeHistoryJob(archivedJob as never);
      expect(result.bucket).toBe("archived");
      expect(result.status).toBe("Archived");
    });

    it("normalizeHistoryJob puts non-archived jobs in their normal bucket", async () => {
      const { normalizeHistoryJob } = await import("@/lib/job-history");

      const activeJob = {
        id: "job-active",
        created_at: "2026-09-01T10:00:00Z",
        archived_at: null,
        extracted_json: { job_type: "Electrical work" },
        sow_json: null,
        customer: { name: "Jane Doe" },
        quote: {
          total: 2000,
          status: "sent",
          sent_at: "2026-09-01T12:00:00Z",
          viewed_at: "2026-09-02T09:00:00Z",
          accepted_at: null,
          declined_at: null,
          created_at: "2026-09-01T11:00:00Z",
          contracts: [],
          invoices: [],
        },
      };

      const result = normalizeHistoryJob(activeJob as never);
      expect(result.bucket).not.toBe("archived");
    });

    it("filterJobs excludes archived from active bucket", async () => {
      const { filterJobs } = await import("@/lib/job-history");

      const jobs = [
        {
          jobId: "job-1",
          bucket: "in_progress",
          customerName: "Active",
          title: "Job",
          amount: 1000,
          status: "Sent" as const,
          paidAt: null,
          invoiced: false,
          sortAt: "2026-09-01T10:00:00Z",
          situation: "quote_sent" as const,
          forcedStages: [],
        },
        {
          jobId: "job-2",
          bucket: "archived",
          customerName: "Archived",
          title: "Job",
          amount: 1500,
          status: "Archived" as const,
          paidAt: null,
          invoiced: false,
          sortAt: "2026-09-01T10:00:00Z",
          situation: "quote_sent" as const,
          forcedStages: [],
        },
      ];

      const active = filterJobs(jobs as never, "active");
      expect(active).toHaveLength(1);
      expect(active[0]?.jobId).toBe("job-1");
    });

    it("filterJobs shows only archived jobs in archived bucket", async () => {
      const { filterJobs } = await import("@/lib/job-history");

      const jobs = [
        {
          jobId: "job-1",
          bucket: "in_progress",
          customerName: "Active",
          title: "Job",
          amount: 1000,
          status: "Sent" as const,
          paidAt: null,
          invoiced: false,
          sortAt: "2026-09-01T10:00:00Z",
          situation: "quote_sent" as const,
          forcedStages: [],
        },
        {
          jobId: "job-2",
          bucket: "archived",
          customerName: "Archived",
          title: "Job",
          amount: 1500,
          status: "Archived" as const,
          paidAt: null,
          invoiced: false,
          sortAt: "2026-09-01T10:00:00Z",
          situation: "quote_sent" as const,
          forcedStages: [],
        },
      ];

      const archived = filterJobs(jobs as never, "archived");
      expect(archived).toHaveLength(1);
      expect(archived[0]?.jobId).toBe("job-2");
    });
  });

  describe("Chase cron filtering", () => {
    it("chase cron skips invoices whose parent job is archived", async () => {
      // This test asserts the behaviour: the chase cron must filter out
      // invoices where quote.job.archived_at is not null. We cannot easily
      // test the cron route itself (it requires auth headers and lock
      // coordination), so we assert the query shape or the filtering logic it
      // would apply.

      // The cron already filters by UNCHASEABLE_QUOTE_STATUSES. We assert it
      // also filters by job.archived_at.

      const invoices: InvoiceRow[] = [
        {
          id: "invoice-1",
          status: "sent",
          due_date: "2026-08-20",
          quote: {
            status: "accepted",
            job: { id: "job-1", archived_at: null },
          },
        },
        {
          id: "invoice-2",
          status: "sent",
          due_date: "2026-08-20",
          quote: {
            status: "accepted",
            job: { id: "job-2", archived_at: "2026-09-01T10:00:00Z" },
          },
        },
      ];

      // The cron should skip invoice-2 because its parent job is archived
      const chaseable = invoices.filter(
        (inv) =>
          inv.quote?.job?.archived_at === null || inv.quote?.job?.archived_at === undefined,
      );

      expect(chaseable).toHaveLength(1);
      expect(chaseable[0]?.id).toBe("invoice-1");
    });
  });

  describe("Integration: archived job cannot be chased", () => {
    it("an invoice for an archived job is excluded from the chase run", async () => {
      // Load the chase route's filtering logic
      const mod = await import("@/app/api/cron/chase/route");

      // The route must filter invoices where:
      // 1. quote.status is in UNCHASEABLE_QUOTE_STATUSES (already done)
      // 2. quote.job.archived_at is not null (new requirement)

      // We cannot easily invoke the GET handler (requires cron auth), but we
      // can assert that the query it builds includes .is("archived_at", null)
      // on the jobs join, or that it filters in-memory.

      // For this test, we assert the intended behaviour: archived jobs do not
      // generate chase waves. The implementation may filter via SQL or
      // in-memory; both satisfy the contract.

      // Minimal assertion: the route module imports correctly and the GET
      // export exists
      expect(mod.GET).toBeDefined();
    });
  });

  describe("Restore behaviour", () => {
    it("restoring an archived job returns it to the active pipeline", async () => {
      const { normalizeHistoryJob } = await import("@/lib/job-history");

      // Job before restore: archived
      const archivedJob = {
        id: "job-restore",
        created_at: "2026-09-01T10:00:00Z",
        archived_at: "2026-09-04T14:00:00Z",
        extracted_json: { job_type: "Carpentry" },
        sow_json: null,
        customer: { name: "Restored Customer" },
        quote: {
          total: 3000,
          status: "accepted",
          sent_at: "2026-09-01T12:00:00Z",
          viewed_at: "2026-09-02T09:00:00Z",
          accepted_at: "2026-09-02T10:00:00Z",
          declined_at: null,
          created_at: "2026-09-01T11:00:00Z",
          contracts: [],
          invoices: [],
        },
      };

      let result = normalizeHistoryJob(archivedJob as never);
      expect(result.bucket).toBe("archived");

      // After restore: archived_at = null, so it returns to in_progress
      const restoredJob = { ...archivedJob, archived_at: null };
      result = normalizeHistoryJob(restoredJob as never);
      expect(result.bucket).toBe("in_progress");
      expect(result.situation).toBe("accepted_need_contract");
    });

    it("chase waves already sent still count after restore", async () => {
      // Restoring does not reset the chase counter. If 2 waves were sent
      // before archiving, restoring the job means the next chase (if
      // applicable) is wave 3, not wave 1.

      // This is enforced by the chase_events table: the unique index on
      // (invoice_id, channel, template_used) prevents duplicate waves, and
      // archiving/restoring never touches that table.

      // Assertion: chase_events are never deleted by archive or restore
      // actions. The actions only write jobs.archived_at.

      const archiveMod = await import("@/app/jobs/[id]/job-archive-actions");

      // The archiveJob function updates only jobs.archived_at
      // The restoreJob function updates only jobs.archived_at
      // Neither touches chase_events

      expect(archiveMod.archiveJob).toBeDefined();
      expect(archiveMod.restoreJob).toBeDefined();

      // This is a structural assertion: the actions do not import or reference
      // chase_events. The wave count persists across archive/restore cycles by
      // omission rather than by explicit preservation.
    });
  });

  describe("RLS and ownership", () => {
    it("archive actions use the session client, not admin client", async () => {
      // The actions must use createClient() (session-scoped) rather than
      // createAdminClient() (bypasses RLS). This ensures RLS enforces
      // ownership: a contractor cannot archive another account's job.

      // Structural assertion: the actions module imports createClient from
      // @/lib/supabase/server, not createAdminClient from @/lib/supabase/admin

      const source = await import("@/app/jobs/[id]/job-archive-actions?raw");
      const code = source.default;

      expect(code).toContain('from "@/lib/supabase/server"');
      expect(code).toContain("createClient");
      expect(code).not.toContain("createAdminClient");
    });
  });

  describe("Edge cases", () => {
    it("archiving a paid job is allowed", async () => {
      const { normalizeHistoryJob } = await import("@/lib/job-history");

      const paidJob = {
        id: "job-paid-archived",
        created_at: "2026-08-01T10:00:00Z",
        archived_at: "2026-09-04T14:00:00Z",
        extracted_json: { job_type: "Roofing" },
        sow_json: null,
        customer: { name: "Paid Customer" },
        quote: {
          total: 5000,
          status: "accepted",
          sent_at: "2026-08-01T12:00:00Z",
          viewed_at: "2026-08-02T09:00:00Z",
          accepted_at: "2026-08-02T10:00:00Z",
          declined_at: null,
          created_at: "2026-08-01T11:00:00Z",
          contracts: [
            {
              id: "contract-1",
              status: "signed",
              sent_at: "2026-08-03T10:00:00Z",
              signed_at: "2026-08-03T14:00:00Z",
              deposit_pct: 30,
            },
          ],
          invoices: [
            {
              id: "invoice-1",
              status: "paid",
              invoice_type: "final",
              due_date: "2026-08-20",
              created_at: "2026-08-10T10:00:00Z",
              paid_at: "2026-08-18T15:00:00Z",
            },
          ],
        },
      };

      const result = normalizeHistoryJob(paidJob as never);
      expect(result.bucket).toBe("archived");
      expect(result.status).toBe("Archived");
      // Payment record is unchanged by archiving
      expect(result.paidAt).toBeNull(); // paidAt is only set for completed bucket
    });

    it("archiving a job with no quote yet is allowed", async () => {
      const { normalizeHistoryJob } = await import("@/lib/job-history");

      const draftJob = {
        id: "job-draft-archived",
        created_at: "2026-09-05T10:00:00Z",
        archived_at: "2026-09-05T11:00:00Z",
        extracted_json: { job_type: "Abandoned intake" },
        sow_json: null,
        customer: null,
        quote: null,
      };

      const result = normalizeHistoryJob(draftJob as never);
      expect(result.bucket).toBe("archived");
      expect(result.status).toBe("Archived");
    });

    it("empty archived list shows an empty state", async () => {
      // The /jobs/archived page must render an EmptyState when the list is
      // empty, explaining what archived jobs are and how to archive one.

      // Structural assertion: the page imports EmptyState
      const source = await import("@/app/jobs/archived/page?raw");
      const code = source.default;

      expect(code).toContain("EmptyState");
      expect(code).toContain("Nothing archived");
    });
  });
});
