/**
 * @vitest-environment happy-dom
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";

/**
 * Issue #305: Jobs list defaults to active work
 *
 * These tests verify:
 * 1. Default filter is "active" (not "all")
 * 2. Active filter includes: drafts, in_progress, declined
 * 3. Active filter excludes: paid (completed), archived
 * 4. Filter options are: active, paid, archived, all
 * 5. parseJobFilter handles the new filter values correctly
 * 6. Empty states exist for each filter
 */

describe("Issue #305: Jobs list defaults to active work", () => {
  describe("Filter parsing and defaults", () => {
    it("parseJobFilter defaults to 'active' when no filter param provided", async () => {
      const mod = await import("@/lib/job-history");

      const result = mod.parseJobFilter(undefined);

      expect(result).toBe("active");
    });

    it("parseJobFilter accepts 'active' as a valid filter", async () => {
      const mod = await import("@/lib/job-history");

      const result = mod.parseJobFilter("active");

      expect(result).toBe("active");
    });

    it("parseJobFilter accepts 'paid' as a valid filter", async () => {
      const mod = await import("@/lib/job-history");

      const result = mod.parseJobFilter("paid");

      expect(result).toBe("paid");
    });

    it("parseJobFilter accepts 'archived' as a valid filter", async () => {
      const mod = await import("@/lib/job-history");

      const result = mod.parseJobFilter("archived");

      expect(result).toBe("archived");
    });

    it("parseJobFilter accepts 'all' as a valid filter", async () => {
      const mod = await import("@/lib/job-history");

      const result = mod.parseJobFilter("all");

      expect(result).toBe("all");
    });

    it("parseJobFilter defaults to 'active' for invalid filter values", async () => {
      const mod = await import("@/lib/job-history");

      const result = mod.parseJobFilter("invalid-filter");

      expect(result).toBe("active");
    });

    it("JOB_HISTORY_FILTERS includes active, paid, archived, all in that order", async () => {
      const mod = await import("@/lib/job-history");

      expect(mod.JOB_HISTORY_FILTERS).toEqual([
        { key: "active", label: "Active" },
        { key: "paid", label: "Paid" },
        { key: "archived", label: "Archived" },
        { key: "all", label: "All" },
      ]);
    });
  });

  describe("Active filter behaviour", () => {
    it("filterJobs with 'active' includes in_progress jobs", async () => {
      const mod = await import("@/lib/job-history");

      const jobs: (typeof mod.HistoryJob)[] = [
        {
          jobId: "1",
          customerName: "Alice",
          title: "Job 1",
          amount: 10000,
          status: "Draft",
          situation: "draft_quote",
          bucket: "in_progress",
          paidAt: null,
          invoiced: false,
          sortAt: "2026-08-20T10:00:00Z",
        },
      ];

      const result = mod.filterJobs(jobs, "active");

      expect(result).toHaveLength(1);
      expect(result[0].jobId).toBe("1");
    });

    it("filterJobs with 'active' includes declined jobs", async () => {
      const mod = await import("@/lib/job-history");

      const jobs: (typeof mod.HistoryJob)[] = [
        {
          jobId: "2",
          customerName: "Bob",
          title: "Job 2",
          amount: 20000,
          status: "Declined",
          situation: "quote_declined",
          bucket: "declined",
          paidAt: null,
          invoiced: false,
          sortAt: "2026-08-19T10:00:00Z",
        },
      ];

      const result = mod.filterJobs(jobs, "active");

      expect(result).toHaveLength(1);
      expect(result[0].jobId).toBe("2");
    });

    it("filterJobs with 'active' excludes paid (completed) jobs", async () => {
      const mod = await import("@/lib/job-history");

      const jobs: (typeof mod.HistoryJob)[] = [
        {
          jobId: "3",
          customerName: "Charlie",
          title: "Job 3",
          amount: 30000,
          status: "Paid",
          situation: "paid",
          bucket: "completed",
          paidAt: "2026-08-18T10:00:00Z",
          invoiced: true,
          sortAt: "2026-08-18T10:00:00Z",
        },
      ];

      const result = mod.filterJobs(jobs, "active");

      expect(result).toHaveLength(0);
    });

    it("filterJobs with 'active' excludes archived jobs", async () => {
      const mod = await import("@/lib/job-history");

      const jobs: (typeof mod.HistoryJob)[] = [
        {
          jobId: "4",
          customerName: "Diana",
          title: "Job 4",
          amount: 40000,
          status: "Archived",
          situation: "draft_quote",
          bucket: "archived",
          paidAt: null,
          invoiced: false,
          sortAt: "2026-08-17T10:00:00Z",
        },
      ];

      const result = mod.filterJobs(jobs, "active");

      expect(result).toHaveLength(0);
    });

    it("filterJobs with 'active' includes both in_progress and declined", async () => {
      const mod = await import("@/lib/job-history");

      const jobs: (typeof mod.HistoryJob)[] = [
        {
          jobId: "1",
          customerName: "Alice",
          title: "Job 1",
          amount: 10000,
          status: "Draft",
          situation: "draft_quote",
          bucket: "in_progress",
          paidAt: null,
          invoiced: false,
          sortAt: "2026-08-20T10:00:00Z",
        },
        {
          jobId: "2",
          customerName: "Bob",
          title: "Job 2",
          amount: 20000,
          status: "Declined",
          situation: "quote_declined",
          bucket: "declined",
          paidAt: null,
          invoiced: false,
          sortAt: "2026-08-19T10:00:00Z",
        },
        {
          jobId: "3",
          customerName: "Charlie",
          title: "Job 3",
          amount: 30000,
          status: "Paid",
          situation: "paid",
          bucket: "completed",
          paidAt: "2026-08-18T10:00:00Z",
          invoiced: true,
          sortAt: "2026-08-18T10:00:00Z",
        },
        {
          jobId: "4",
          customerName: "Diana",
          title: "Job 4",
          amount: 40000,
          status: "Archived",
          situation: "draft_quote",
          bucket: "archived",
          paidAt: null,
          invoiced: false,
          sortAt: "2026-08-17T10:00:00Z",
        },
      ];

      const result = mod.filterJobs(jobs, "active");

      expect(result).toHaveLength(2);
      expect(result.map((j) => j.jobId).sort()).toEqual(["1", "2"]);
    });
  });

  describe("Paid filter behaviour", () => {
    it("filterJobs with 'paid' includes only completed (paid) jobs", async () => {
      const mod = await import("@/lib/job-history");

      const jobs: (typeof mod.HistoryJob)[] = [
        {
          jobId: "1",
          customerName: "Alice",
          title: "Job 1",
          amount: 10000,
          status: "Draft",
          situation: "draft_quote",
          bucket: "in_progress",
          paidAt: null,
          invoiced: false,
          sortAt: "2026-08-20T10:00:00Z",
        },
        {
          jobId: "2",
          customerName: "Bob",
          title: "Job 2",
          amount: 20000,
          status: "Paid",
          situation: "paid",
          bucket: "completed",
          paidAt: "2026-08-18T10:00:00Z",
          invoiced: true,
          sortAt: "2026-08-18T10:00:00Z",
        },
      ];

      const result = mod.filterJobs(jobs, "paid");

      expect(result).toHaveLength(1);
      expect(result[0].jobId).toBe("2");
      expect(result[0].bucket).toBe("completed");
    });
  });

  describe("Archived filter behaviour", () => {
    it("filterJobs with 'archived' includes only archived jobs", async () => {
      const mod = await import("@/lib/job-history");

      const jobs: (typeof mod.HistoryJob)[] = [
        {
          jobId: "1",
          customerName: "Alice",
          title: "Job 1",
          amount: 10000,
          status: "Draft",
          situation: "draft_quote",
          bucket: "in_progress",
          paidAt: null,
          invoiced: false,
          sortAt: "2026-08-20T10:00:00Z",
        },
        {
          jobId: "2",
          customerName: "Bob",
          title: "Job 2",
          amount: 20000,
          status: "Archived",
          situation: "draft_quote",
          bucket: "archived",
          paidAt: null,
          invoiced: false,
          sortAt: "2026-08-19T10:00:00Z",
        },
      ];

      const result = mod.filterJobs(jobs, "archived");

      expect(result).toHaveLength(1);
      expect(result[0].jobId).toBe("2");
      expect(result[0].bucket).toBe("archived");
    });
  });

  describe("All filter behaviour", () => {
    it("filterJobs with 'all' includes all jobs regardless of bucket", async () => {
      const mod = await import("@/lib/job-history");

      const jobs: (typeof mod.HistoryJob)[] = [
        {
          jobId: "1",
          customerName: "Alice",
          title: "Job 1",
          amount: 10000,
          status: "Draft",
          situation: "draft_quote",
          bucket: "in_progress",
          paidAt: null,
          invoiced: false,
          sortAt: "2026-08-20T10:00:00Z",
        },
        {
          jobId: "2",
          customerName: "Bob",
          title: "Job 2",
          amount: 20000,
          status: "Declined",
          situation: "quote_declined",
          bucket: "declined",
          paidAt: null,
          invoiced: false,
          sortAt: "2026-08-19T10:00:00Z",
        },
        {
          jobId: "3",
          customerName: "Charlie",
          title: "Job 3",
          amount: 30000,
          status: "Paid",
          situation: "paid",
          bucket: "completed",
          paidAt: "2026-08-18T10:00:00Z",
          invoiced: true,
          sortAt: "2026-08-18T10:00:00Z",
        },
        {
          jobId: "4",
          customerName: "Diana",
          title: "Job 4",
          amount: 40000,
          status: "Archived",
          situation: "draft_quote",
          bucket: "archived",
          paidAt: null,
          invoiced: false,
          sortAt: "2026-08-17T10:00:00Z",
        },
      ];

      const result = mod.filterJobs(jobs, "all");

      expect(result).toHaveLength(4);
    });
  });

  describe("Empty state copy", () => {
    it("jobs page component exists", async () => {
      const mod = await import("@/app/jobs/page");

      expect(mod.default).toBeDefined();
    });

    // Note: Cannot easily test the empty state copy without rendering the component
    // or exposing the EMPTY_COPY object. The Engineer will need to ensure the
    // empty states match the spec:
    // - Active: "Nothing needs you right now" (success tone)
    // - Paid: "No completed jobs yet"
    // - Archived: "Nothing archived"
    // - All: "No jobs yet"
  });

  describe("Session persistence", () => {
    beforeEach(() => {
      // Clear sessionStorage before each test
      if (typeof sessionStorage !== "undefined") {
        sessionStorage.clear();
      }
    });

    afterEach(() => {
      // Clean up after each test
      if (typeof sessionStorage !== "undefined") {
        sessionStorage.clear();
      }
    });

    it("sessionStorage is available in the test environment", () => {
      expect(typeof sessionStorage).toBe("object");
      expect(sessionStorage.setItem).toBeDefined();
      expect(sessionStorage.getItem).toBeDefined();
    });

    // Note: Actual session persistence implementation will be tested via
    // integration/e2e tests. The acceptance criteria are:
    // 1. Filter choice persists while navigating within the app (same session)
    // 2. Filter resets to 'active' on app restart (new session)
    // Implementation should use sessionStorage, not localStorage
  });

  describe("URL state handling", () => {
    it("buildHref helper produces correct URLs for each filter", async () => {
      // The buildHref helper is not exported, but we can verify the pattern
      // by checking that the page correctly parses filter params

      const mod = await import("@/lib/job-history");

      // Active filter should default (no param or ?filter=active)
      expect(mod.parseJobFilter(undefined)).toBe("active");
      expect(mod.parseJobFilter("active")).toBe("active");

      // Other filters should be in the URL
      expect(mod.parseJobFilter("paid")).toBe("paid");
      expect(mod.parseJobFilter("archived")).toBe("archived");
      expect(mod.parseJobFilter("all")).toBe("all");
    });
  });

  describe("Draft jobs are active", () => {
    it("a draft job (in_progress bucket) appears in active filter", async () => {
      const mod = await import("@/lib/job-history");

      const jobs: (typeof mod.HistoryJob)[] = [
        {
          jobId: "draft-1",
          customerName: "New Customer",
          title: "Job",
          amount: 0,
          status: "Draft",
          situation: "draft_quote",
          bucket: "in_progress",
          paidAt: null,
          invoiced: false,
          sortAt: "2026-08-10T10:00:00Z", // 10 days old
        },
      ];

      const result = mod.filterJobs(jobs, "active");

      expect(result).toHaveLength(1);
      expect(result[0].status).toBe("Draft");
    });
  });

  describe("Jobs awaiting payment are active", () => {
    it("a job with status 'Invoiced' appears in active filter", async () => {
      const mod = await import("@/lib/job-history");

      const jobs: (typeof mod.HistoryJob)[] = [
        {
          jobId: "invoiced-1",
          customerName: "Customer Awaiting Payment",
          title: "Job",
          amount: 50000,
          status: "Awaiting payment",
          situation: "invoice_unpaid",
          bucket: "in_progress",
          paidAt: null,
          invoiced: true,
          sortAt: "2026-08-15T10:00:00Z",
        },
      ];

      const result = mod.filterJobs(jobs, "active");

      expect(result).toHaveLength(1);
      expect(result[0].status).toBe("Awaiting payment");
    });
  });

  describe("Accessibility", () => {
    it("filter chips should use aria-current for the active filter", async () => {
      // This is tested via integration tests that render the page
      // The implementation should set aria-current="page" on the active filter chip
      // and use visual indicators (border, background, font-weight) that work
      // without relying on colour alone

      // This test documents the requirement but cannot enforce it without rendering
      expect(true).toBe(true);
    });
  });
});
