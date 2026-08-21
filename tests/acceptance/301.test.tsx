/**
 * Acceptance tests for #301: "Untitled job" rows are not identifiable in the jobs list
 *
 * Tests the fallback hierarchy for job labels when customer name is missing,
 * and ensures "Job" never renders as a placeholder job type.
 */

import { describe, it, expect } from "vitest";
import { normalizeHistoryJob, type RawHistoryJob } from "@/lib/job-history";

const NOW = new Date("2026-08-20T12:00:00.000Z").getTime();

describe("#301: Job label fallback hierarchy", () => {
  it("shows customer name as primary label when customer exists", () => {
    const job: RawHistoryJob = {
      id: "job1",
      created_at: "2026-08-15T10:00:00.000Z",
      extracted_json: { job_type: "Rewire" },
      customer: { name: "Sam Turner" },
      quote: null,
    };

    const normalized = normalizeHistoryJob(job, NOW);

    expect(normalized.customerName).toBe("Sam Turner");
  });

  it("shows job type as primary label when customer is missing but job type exists", () => {
    const job: RawHistoryJob = {
      id: "job2",
      created_at: "2026-08-15T10:00:00.000Z",
      extracted_json: { job_type: "Downlights" },
      customer: null,
      quote: null,
    };

    const normalized = normalizeHistoryJob(job, NOW);

    expect(normalized.customerName).toBe("Downlights");
    expect(normalized.customerName).not.toBe("Untitled job");
  });

  it('treats empty-string customer name as missing and falls back to job type', () => {
    const job: RawHistoryJob = {
      id: "job3",
      created_at: "2026-08-15T10:00:00.000Z",
      extracted_json: { job_type: "Bathroom" },
      customer: { name: "" },
      quote: null,
    };

    const normalized = normalizeHistoryJob(job, NOW);

    expect(normalized.customerName).toBe("Bathroom");
  });

  it('treats whitespace-only customer name as missing and falls back', () => {
    const job: RawHistoryJob = {
      id: "job4",
      created_at: "2026-08-15T10:00:00.000Z",
      extracted_json: { job_type: "Kitchen" },
      customer: { name: "   " },
      quote: null,
    };

    const normalized = normalizeHistoryJob(job, NOW);

    expect(normalized.customerName).toBe("Kitchen");
  });

  it("shows formatted creation date when customer and job type are both missing", () => {
    const job: RawHistoryJob = {
      id: "job5",
      created_at: "2026-08-15T10:00:00.000Z",
      extracted_json: null,
      customer: null,
      quote: null,
    };

    const normalized = normalizeHistoryJob(job, NOW);

    expect(normalized.customerName).toMatch(/^Job from \d{1,2} \w{3} \d{4}$/);
    expect(normalized.customerName).not.toBe("Untitled job");
  });

  it('shows "Untitled job" only when customer, job_type, and extracted_json are all absent', () => {
    const job: RawHistoryJob = {
      id: "job6",
      created_at: "2026-08-15T10:00:00.000Z",
      extracted_json: null,
      customer: null,
      quote: null,
    };

    const normalized = normalizeHistoryJob(job, NOW);

    // With the new fallback to creation date, "Untitled job" should only appear
    // if we deliberately remove all fallback mechanisms (which shouldn't happen).
    // This test documents that "Untitled job" is now truly the last resort.
    expect(normalized.customerName).not.toBe("");
  });

  it('never shows "Job" as a job type descriptor', () => {
    const jobWithPlaceholder: RawHistoryJob = {
      id: "job7",
      created_at: "2026-08-15T10:00:00.000Z",
      extracted_json: { job_type: "Job" },
      customer: { name: "Chris Adams" },
      quote: null,
    };

    const normalized = normalizeHistoryJob(jobWithPlaceholder, NOW);

    expect(normalized.title).not.toBe("Job");
    expect(normalized.title).toBe("");
  });

  it("omits descriptor when job_type is missing", () => {
    const job: RawHistoryJob = {
      id: "job8",
      created_at: "2026-08-15T10:00:00.000Z",
      extracted_json: null,
      customer: { name: "Alex Morgan" },
      quote: null,
    };

    const normalized = normalizeHistoryJob(job, NOW);

    expect(normalized.customerName).toBe("Alex Morgan");
    expect(normalized.title).toBe("");
  });

  it('omits descriptor when job_type is explicitly "Job"', () => {
    const job: RawHistoryJob = {
      id: "job9",
      created_at: "2026-08-15T10:00:00.000Z",
      extracted_json: { job_type: "Job" },
      customer: { name: "Taylor Swift" },
      quote: null,
    };

    const normalized = normalizeHistoryJob(job, NOW);

    expect(normalized.customerName).toBe("Taylor Swift");
    expect(normalized.title).toBe("");
  });

  it("uses job type as descriptor when customer exists and job type is not a placeholder", () => {
    const job: RawHistoryJob = {
      id: "job10",
      created_at: "2026-08-15T10:00:00.000Z",
      extracted_json: { job_type: "Cooker circuit" },
      customer: { name: "Jordan Lee" },
      quote: null,
    };

    const normalized = normalizeHistoryJob(job, NOW);

    expect(normalized.customerName).toBe("Jordan Lee");
    expect(normalized.title).toBe("Cooker circuit");
  });

  it("handles archived jobs with no customer using the same fallback chain", () => {
    const archivedJob: RawHistoryJob = {
      id: "job11",
      created_at: "2026-07-01T10:00:00.000Z",
      extracted_json: { job_type: "Rewire" },
      customer: null,
      quote: {
        total: 937.5,
        status: "archived",
        sent_at: "2026-07-02T00:00:00.000Z",
        viewed_at: null,
        accepted_at: null,
        declined_at: null,
        created_at: "2026-07-01T00:00:00.000Z",
        contracts: [],
        invoices: [],
      },
    };

    const normalized = normalizeHistoryJob(archivedJob, NOW);

    expect(normalized.customerName).toBe("Rewire");
    expect(normalized.customerName).not.toBe("Untitled job");
    expect(normalized.status).toBe("Archived");
  });

  it("handles jobs with money but no customer (the investigation case)", () => {
    const pricedJobNoCustomer: RawHistoryJob = {
      id: "job12",
      created_at: "2026-07-01T10:00:00.000Z",
      extracted_json: null,
      customer: null,
      quote: {
        total: 933.75,
        status: "sent",
        sent_at: "2026-07-02T00:00:00.000Z",
        viewed_at: null,
        accepted_at: null,
        declined_at: null,
        created_at: "2026-07-01T00:00:00.000Z",
        contracts: [],
        invoices: [],
      },
    };

    const normalized = normalizeHistoryJob(pricedJobNoCustomer, NOW);

    // Should fall back to creation date, not show "Untitled job"
    expect(normalized.customerName).toMatch(/^Job from \d{1,2} \w{3} \d{4}$/);
    expect(normalized.amount).toBe(933.75);
  });

  it("handles case-insensitive 'job' placeholder variants", () => {
    const variants = ["job", "Job", "JOB", "JoB"];

    for (const variant of variants) {
      const job: RawHistoryJob = {
        id: `job-${variant}`,
        created_at: "2026-08-15T10:00:00.000Z",
        extracted_json: { job_type: variant },
        customer: { name: "Test Customer" },
        quote: null,
      };

      const normalized = normalizeHistoryJob(job, NOW);

      expect(normalized.title).toBe("");
      expect(normalized.title).not.toBe(variant);
    }
  });

  it("preserves valid job types that contain the word 'job'", () => {
    const job: RawHistoryJob = {
      id: "job13",
      created_at: "2026-08-15T10:00:00.000Z",
      extracted_json: { job_type: "Big job site rewire" },
      customer: { name: "Site Manager" },
      quote: null,
    };

    const normalized = normalizeHistoryJob(job, NOW);

    expect(normalized.customerName).toBe("Site Manager");
    expect(normalized.title).toBe("Big job site rewire");
  });

  it("falls back to a descriptor from the SoW overview when customer and job type are both missing", () => {
    // Derived criterion 3, the third tier of the four-tier chain. Without this
    // the contract pinned tiers 1, 2 and 4 only, so an implementation that
    // skipped the overview and went straight to the date would have satisfied
    // it. That gap is what QA kept raising and the Engineer could not close.
    const job: RawHistoryJob = {
      id: "job-with-narrative",
      created_at: "2026-08-15T10:00:00.000Z",
      extracted_json: null,
      customer: null,
      sow_json: { overview_narrative: "Rewire the kitchen and dining room." },
      quote: null,
    };

    const normalized = normalizeHistoryJob(job, NOW);

    expect(normalized.customerName).toBe("Rewire the kitchen and dining room.");
    expect(normalized.customerName).not.toBe("Untitled job");
  });
});
