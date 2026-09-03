import { describe, expect, it } from "vitest";
import type { InvoiceState } from "@/lib/job-stages";
import {
  normalizeHistoryJob,
  filterJobs,
  searchJobs,
  summariseJobs,
  sortByRecency,
  parseJobFilter,
  type RawHistoryJob,
  type HistoryJob,
} from "@/lib/job-history";

// A fixed "now" keeps overdue derivation deterministic.
const NOW = new Date("2026-07-31T12:00:00.000Z").getTime();

const invoice = (over: Partial<InvoiceState> = {}): InvoiceState => ({
  id: "inv1",
  status: "sent",
  invoice_type: "final",
  due_date: "2026-08-14",
  created_at: "2026-07-01T00:00:00.000Z",
  paid_at: null,
  ...over,
});

const job = (over: Partial<RawHistoryJob> = {}): RawHistoryJob => ({
  id: "job1",
  created_at: "2026-07-01T00:00:00.000Z",
  extracted_json: { job_type: "Rewire" },
  customer: { name: "Daniel Reeve" },
  quote: {
    total: 1200,
    status: "sent",
    sent_at: "2026-07-02T00:00:00.000Z",
    viewed_at: null,
    accepted_at: null,
    declined_at: null,
    created_at: "2026-07-01T00:00:00.000Z",
    contracts: [],
    invoices: [],
    ...over.quote,
  },
  ...(over.id ? { id: over.id } : {}),
  ...(over.customer !== undefined ? { customer: over.customer } : {}),
  ...(over.extracted_json !== undefined ? { extracted_json: over.extracted_json } : {}),
  ...(over.created_at ? { created_at: over.created_at } : {}),
});

describe("parseJobFilter", () => {
  it("accepts known filters", () => {
    expect(parseJobFilter("active")).toBe("active");
    expect(parseJobFilter("paid")).toBe("paid");
    expect(parseJobFilter("archived")).toBe("archived");
    expect(parseJobFilter("all")).toBe("all");
  });
  it("defaults unknown / missing to active", () => {
    expect(parseJobFilter(undefined)).toBe("active");
    expect(parseJobFilter("nonsense")).toBe("active");
  });
});

describe("normalizeHistoryJob — bucket + canonical status vocabulary", () => {
  it("maps a sent quote to in_progress / Sent", () => {
    const h = normalizeHistoryJob(job(), NOW);
    expect(h.bucket).toBe("in_progress");
    expect(h.status).toBe("Sent");
  });

  it("maps a viewed quote to Viewed (still in_progress)", () => {
    const h = normalizeHistoryJob(
      job({ quote: { ...job().quote!, viewed_at: "2026-07-03T00:00:00.000Z" } }),
      NOW,
    );
    expect(h.bucket).toBe("in_progress");
    expect(h.status).toBe("Viewed");
  });

  it("maps a paid job to completed / Paid with a paidAt", () => {
    const h = normalizeHistoryJob(
      job({
        quote: {
          ...job().quote!,
          status: "accepted",
          accepted_at: "2026-07-03T00:00:00.000Z",
          contracts: [
            { id: "c1", status: "signed", sent_at: "2026-07-03T00:00:00.000Z", signed_at: "2026-07-04T00:00:00.000Z", deposit_pct: null },
          ],
          invoices: [invoice({ status: "paid", paid_at: "2026-07-10T00:00:00.000Z" })],
        },
      }),
      NOW,
    );
    expect(h.bucket).toBe("completed");
    expect(h.status).toBe("Paid");
    expect(h.paidAt).toBe("2026-07-10T00:00:00.000Z");
    expect(h.invoiced).toBe(true);
  });

  it("maps a declined quote to declined / Declined", () => {
    const h = normalizeHistoryJob(
      job({ quote: { ...job().quote!, status: "declined", declined_at: "2026-07-05T00:00:00.000Z" } }),
      NOW,
    );
    expect(h.bucket).toBe("declined");
    expect(h.status).toBe("Declined");
    expect(h.paidAt).toBeNull();
  });

  it("maps a declined contract to declined", () => {
    const h = normalizeHistoryJob(
      job({
        quote: {
          ...job().quote!,
          status: "accepted",
          accepted_at: "2026-07-03T00:00:00.000Z",
          contracts: [
            { id: "c1", status: "declined", sent_at: "2026-07-03T00:00:00.000Z", signed_at: null, deposit_pct: null },
          ],
        },
      }),
      NOW,
    );
    expect(h.bucket).toBe("declined");
  });

  it("treats an archived quote as archived, bypassing derivation", () => {
    const h = normalizeHistoryJob(
      job({ quote: { ...job().quote!, status: "archived" } }),
      NOW,
    );
    expect(h.bucket).toBe("archived");
    expect(h.status).toBe("Archived");
  });

  it("treats a job with no quote as an in_progress Draft", () => {
    const h = normalizeHistoryJob({ ...job(), quote: null }, NOW);
    expect(h.bucket).toBe("in_progress");
    expect(h.status).toBe("Draft");
    expect(h.amount).toBe(0);
  });

  it("flags an overdue unpaid invoice as in_progress / Overdue", () => {
    const h = normalizeHistoryJob(
      job({
        quote: {
          ...job().quote!,
          status: "accepted",
          accepted_at: "2026-07-01T00:00:00.000Z",
          contracts: [
            { id: "c1", status: "signed", sent_at: "2026-06-20T00:00:00.000Z", signed_at: "2026-06-21T00:00:00.000Z", deposit_pct: null },
          ],
          invoices: [invoice({ due_date: "2026-07-01" })],
        },
      }),
      NOW,
    );
    expect(h.bucket).toBe("in_progress");
    expect(h.status).toBe("Overdue");
  });
});

describe("filterJobs", () => {
  const jobs: HistoryJob[] = [
    { jobId: "a", customerName: "A", title: "x", amount: 1, status: "Sent", bucket: "in_progress", paidAt: null, invoiced: false, sortAt: "2026-07-01", situation: "quote_sent", forcedStages: [] },
    { jobId: "b", customerName: "B", title: "y", amount: 2, status: "Paid", bucket: "completed", paidAt: "2026-07-02", invoiced: true, sortAt: "2026-07-02", situation: "paid", forcedStages: [] },
    { jobId: "c", customerName: "C", title: "z", amount: 3, status: "Declined", bucket: "declined", paidAt: null, invoiced: false, sortAt: "2026-07-03", situation: "quote_declined", forcedStages: [] },
    { jobId: "d", customerName: "D", title: "w", amount: 4, status: "Archived", bucket: "archived", paidAt: null, invoiced: false, sortAt: "2026-07-04", situation: "draft_quote", forcedStages: [] },
  ];

  it("returns everything for all", () => {
    expect(filterJobs(jobs, "all")).toHaveLength(4);
  });
  it("returns only paid (completed bucket) jobs", () => {
    expect(filterJobs(jobs, "paid").map((j) => j.jobId)).toEqual(["b"]);
  });
  it("returns only archived jobs", () => {
    expect(filterJobs(jobs, "archived").map((j) => j.jobId)).toEqual(["d"]);
  });
  it("returns active jobs (in_progress + declined)", () => {
    expect(filterJobs(jobs, "active").map((j) => j.jobId).sort()).toEqual(["a", "c"]);
  });
});

describe("searchJobs", () => {
  const jobs: HistoryJob[] = [
    { jobId: "a", customerName: "Daniel Reeve", title: "Full rewire", amount: 1, status: "Sent", bucket: "in_progress", paidAt: null, invoiced: false, sortAt: "1", situation: "quote_sent", forcedStages: [] },
    { jobId: "b", customerName: "Sarah Whitlock", title: "Ceiling skim", amount: 2, status: "Paid", bucket: "completed", paidAt: "x", invoiced: true, sortAt: "2", situation: "paid", forcedStages: [] },
  ];

  it("matches on customer name, case-insensitively", () => {
    expect(searchJobs(jobs, "daniel").map((j) => j.jobId)).toEqual(["a"]);
    expect(searchJobs(jobs, "WHITLOCK").map((j) => j.jobId)).toEqual(["b"]);
  });
  it("matches on job title", () => {
    expect(searchJobs(jobs, "rewire").map((j) => j.jobId)).toEqual(["a"]);
    expect(searchJobs(jobs, "skim").map((j) => j.jobId)).toEqual(["b"]);
  });
  it("returns all on a blank query", () => {
    expect(searchJobs(jobs, "   ")).toHaveLength(2);
  });
  it("returns none when nothing matches", () => {
    expect(searchJobs(jobs, "boiler")).toHaveLength(0);
  });
});

describe("summariseJobs", () => {
  const jobs: HistoryJob[] = [
    { jobId: "a", customerName: "A", title: "x", amount: 1000, status: "Awaiting payment", bucket: "in_progress", paidAt: null, invoiced: true, sortAt: "1", situation: "invoice_unpaid", forcedStages: [] },
    { jobId: "b", customerName: "B", title: "y", amount: 500, status: "Paid", bucket: "completed", paidAt: "2026-07-10", invoiced: true, sortAt: "2", situation: "paid", forcedStages: [] },
    { jobId: "c", customerName: "C", title: "z", amount: 250, status: "Paid", bucket: "completed", paidAt: "2026-07-02", invoiced: true, sortAt: "3", situation: "paid", forcedStages: [] },
    { jobId: "d", customerName: "D", title: "w", amount: 999, status: "Sent", bucket: "in_progress", paidAt: null, invoiced: false, sortAt: "4", situation: "quote_sent", forcedStages: [] },
  ];

  it("counts the filtered set", () => {
    expect(summariseJobs(jobs).count).toBe(4);
  });
  it("bills only invoiced jobs (excludes the un-invoiced draft)", () => {
    expect(summariseJobs(jobs).totalBilled).toBe(1750);
  });
  it("collects only paid jobs", () => {
    expect(summariseJobs(jobs).totalCollected).toBe(750);
  });
  it("spans the earliest to latest payment dates", () => {
    const s = summariseJobs(jobs);
    expect(s.paidFrom).toBe("2026-07-02");
    expect(s.paidTo).toBe("2026-07-10");
  });
  it("has null date range when nothing is paid", () => {
    const s = summariseJobs(jobs.filter((j) => j.bucket !== "completed"));
    expect(s.paidFrom).toBeNull();
    expect(s.paidTo).toBeNull();
  });
});

describe("scale — 1,000 jobs (pagination + full-set totals)", () => {
  // A mixed 1,000-job history: repeating paid / sent / declined / archived so
  // every bucket is populated at volume.
  const buildMany = (n: number): RawHistoryJob[] =>
    Array.from({ length: n }, (_, i) => {
      const day = String((i % 27) + 1).padStart(2, "0");
      const created = `2026-06-${day}T00:00:00.000Z`;
      const q = job().quote!;
      switch (i % 4) {
        case 0:
          return job({
            id: `job${i}`,
            created_at: created,
            quote: {
              ...q,
              status: "accepted",
              accepted_at: created,
              contracts: [
                { id: `c${i}`, status: "signed", sent_at: created, signed_at: created, deposit_pct: null },
              ],
              invoices: [invoice({ id: `inv${i}`, status: "paid", paid_at: `2026-07-${day}T00:00:00.000Z` })],
            },
          });
        case 1:
          return job({ id: `job${i}`, created_at: created });
        case 2:
          return job({ id: `job${i}`, created_at: created, quote: { ...q, status: "declined", declined_at: created } });
        default:
          return job({ id: `job${i}`, created_at: created, quote: { ...q, status: "archived" } });
      }
    });

  const jobs = buildMany(1000).map((r) => normalizeHistoryJob(r, NOW));

  it("buckets all 1,000 without loss", () => {
    expect(jobs).toHaveLength(1000);
    expect(filterJobs(jobs, "paid")).toHaveLength(250);
    expect(filterJobs(jobs, "active")).toHaveLength(500); // in_progress (250) + declined (250)
    expect(filterJobs(jobs, "archived")).toHaveLength(250);
  });

  it("paginates in 25s while totals cover the whole filtered set", () => {
    const paid = sortByRecency(filterJobs(jobs, "paid"));
    const firstPage = paid.slice(0, 25);
    expect(firstPage).toHaveLength(25);
    expect(paid.length > firstPage.length).toBe(true);
    const summary = summariseJobs(paid);
    expect(summary.count).toBe(250);
    expect(summary.totalCollected).toBe(250 * 1200);
  });
});

describe("sortByRecency", () => {
  it("orders most-recent activity first", () => {
    const jobs: HistoryJob[] = [
      { jobId: "old", customerName: "A", title: "x", amount: 1, status: "Sent", bucket: "in_progress", paidAt: null, invoiced: false, sortAt: "2026-07-01T00:00:00.000Z", situation: "quote_sent", forcedStages: [] },
      { jobId: "new", customerName: "B", title: "y", amount: 2, status: "Sent", bucket: "in_progress", paidAt: null, invoiced: false, sortAt: "2026-07-20T00:00:00.000Z", situation: "quote_sent", forcedStages: [] },
    ];
    expect(sortByRecency(jobs).map((j) => j.jobId)).toEqual(["new", "old"]);
  });
});

describe("normalizeHistoryJob — fallback hierarchy (#301)", () => {
  it("uses overview_narrative snippet when customer and job_type are missing", () => {
    const jobWithOverview: RawHistoryJob = {
      id: "job1",
      created_at: "2026-07-15T00:00:00.000Z",
      extracted_json: null,
      customer: null,
      sow_json: {
        overview_narrative: "Install downlights in kitchen and living room. Customer wants dimmable LED fixtures.",
      },
      quote: null,
    };

    const h = normalizeHistoryJob(jobWithOverview, NOW);

    expect(h.customerName).toBe("Install downlights in kitchen and living room.");
    expect(h.customerName).not.toBe("Untitled job");
  });

  it("uses overview_narrative snippet even with placeholder job_type", () => {
    const jobWithOverviewAndPlaceholder: RawHistoryJob = {
      id: "job2",
      created_at: "2026-07-15T00:00:00.000Z",
      extracted_json: { job_type: "Job" },
      customer: null,
      sow_json: {
        overview_narrative: "Replace consumer unit and install new circuits throughout property.",
      },
      quote: null,
    };

    const h = normalizeHistoryJob(jobWithOverviewAndPlaceholder, NOW);

    // Overview is longer than 50 chars, so it gets truncated
    expect(h.customerName).toBe("Replace consumer unit and install new circuits thr...");
    expect(h.title).toBe("");
  });

  it("truncates long overview_narrative to ~50 chars", () => {
    const jobWithLongOverview: RawHistoryJob = {
      id: "job3",
      created_at: "2026-07-15T00:00:00.000Z",
      extracted_json: null,
      customer: null,
      sow_json: {
        overview_narrative:
          "This is a very long overview narrative that goes on and on and should be truncated because it exceeds the character limit we want to display in the job list.",
      },
      quote: null,
    };

    const h = normalizeHistoryJob(jobWithLongOverview, NOW);

    expect(h.customerName.length).toBeLessThanOrEqual(54); // 50 chars + "..."
    expect(h.customerName).toContain("...");
  });

  it("extracts first sentence from overview_narrative when it fits", () => {
    const jobWithSentence: RawHistoryJob = {
      id: "job4",
      created_at: "2026-07-15T00:00:00.000Z",
      extracted_json: null,
      customer: null,
      sow_json: {
        overview_narrative: "Replace old fuse box. Install new RCDs and MCBs.",
      },
      quote: null,
    };

    const h = normalizeHistoryJob(jobWithSentence, NOW);

    expect(h.customerName).toBe("Replace old fuse box.");
  });

  it("handles null or empty overview_narrative gracefully", () => {
    const jobWithNullOverview: RawHistoryJob = {
      id: "job5",
      created_at: "2026-07-15T00:00:00.000Z",
      extracted_json: null,
      customer: null,
      sow_json: { overview_narrative: null },
      quote: null,
    };

    const h = normalizeHistoryJob(jobWithNullOverview, NOW);

    expect(h.customerName).toMatch(/^Job from \d{1,2} \w{3} \d{4}$/);
  });

  it("handles missing sow_json gracefully", () => {
    const jobWithoutSow: RawHistoryJob = {
      id: "job6",
      created_at: "2026-07-15T00:00:00.000Z",
      extracted_json: null,
      customer: null,
      sow_json: null,
      quote: null,
    };

    const h = normalizeHistoryJob(jobWithoutSow, NOW);

    expect(h.customerName).toMatch(/^Job from \d{1,2} \w{3} \d{4}$/);
  });

  it('falls back to "Untitled job" when created_at is missing', () => {
    const jobWithNoCreatedAt: RawHistoryJob = {
      id: "job7",
      created_at: "",
      extracted_json: null,
      customer: null,
      sow_json: null,
      quote: null,
    };

    const h = normalizeHistoryJob(jobWithNoCreatedAt, NOW);

    expect(h.customerName).toBe("Untitled job");
  });

  it('falls back to "Untitled job" when formatDate would throw', () => {
    const jobWithInvalidDate: RawHistoryJob = {
      id: "job8",
      created_at: "not-a-valid-date",
      extracted_json: null,
      customer: null,
      sow_json: null,
      quote: null,
    };

    const h = normalizeHistoryJob(jobWithInvalidDate, NOW);

    expect(h.customerName).toBe("Untitled job");
  });
});
