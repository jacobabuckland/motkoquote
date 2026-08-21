import { describe, expect, it } from "vitest";

describe("Sort the active jobs list by urgency, not recency", () => {
  it("exists: the sortByUrgency function is exported from job-history", async () => {
    const mod = await import("@/lib/job-history");
    expect(mod.sortByUrgency).toBeDefined();
    expect(typeof mod.sortByUrgency).toBe("function");
  });

  it("tiers jobs by urgency: overdue → unpaid → sent quotes → sent contracts → drafts → other", async () => {
    const { sortByUrgency } = await import("@/lib/job-history");
    const { normalizeHistoryJob } = await import("@/lib/job-history");
    const NOW = new Date("2026-08-21T12:00:00.000Z").getTime();

    // Build a fixture with one job per tier, in reverse order of priority so
    // the input is not already sorted correctly.
    const draft = normalizeHistoryJob(
      {
        id: "job-draft",
        created_at: "2026-08-01T00:00:00.000Z",
        extracted_json: { job_type: "Draft job" },
        customer: { name: "Customer A" },
        quote: {
          total: 100,
          status: "draft",
          sent_at: null,
          viewed_at: null,
          accepted_at: null,
          declined_at: null,
          created_at: "2026-08-01T00:00:00.000Z",
          contracts: [],
          invoices: [],
        },
      },
      NOW,
    );

    const sentContract = normalizeHistoryJob(
      {
        id: "job-contract",
        created_at: "2026-08-02T00:00:00.000Z",
        extracted_json: { job_type: "Contract job" },
        customer: { name: "Customer B" },
        quote: {
          total: 200,
          status: "accepted",
          sent_at: "2026-08-02T00:00:00.000Z",
          viewed_at: null,
          accepted_at: "2026-08-03T00:00:00.000Z",
          declined_at: null,
          created_at: "2026-08-02T00:00:00.000Z",
          contracts: [
            {
              id: "contract-1",
              status: "sent",
              sent_at: "2026-08-04T00:00:00.000Z",
              signed_at: null,
              deposit_pct: null,
            },
          ],
          invoices: [],
        },
      },
      NOW,
    );

    const sentQuote = normalizeHistoryJob(
      {
        id: "job-quote",
        created_at: "2026-08-03T00:00:00.000Z",
        extracted_json: { job_type: "Quote job" },
        customer: { name: "Customer C" },
        quote: {
          total: 300,
          status: "sent",
          sent_at: "2026-08-03T00:00:00.000Z",
          viewed_at: null,
          accepted_at: null,
          declined_at: null,
          created_at: "2026-08-03T00:00:00.000Z",
          contracts: [],
          invoices: [],
        },
      },
      NOW,
    );

    const unpaidInvoice = normalizeHistoryJob(
      {
        id: "job-unpaid",
        created_at: "2026-08-04T00:00:00.000Z",
        extracted_json: { job_type: "Unpaid job" },
        customer: { name: "Customer D" },
        quote: {
          total: 400,
          status: "accepted",
          sent_at: "2026-08-04T00:00:00.000Z",
          viewed_at: null,
          accepted_at: "2026-08-05T00:00:00.000Z",
          declined_at: null,
          created_at: "2026-08-04T00:00:00.000Z",
          contracts: [
            {
              id: "contract-2",
              status: "signed",
              sent_at: "2026-08-05T00:00:00.000Z",
              signed_at: "2026-08-06T00:00:00.000Z",
              deposit_pct: null,
            },
          ],
          invoices: [
            {
              id: "invoice-unpaid",
              status: "sent",
              invoice_type: "final",
              due_date: "2026-09-01T00:00:00.000Z",
              created_at: "2026-08-07T00:00:00.000Z",
              paid_at: null,
            },
          ],
        },
      },
      NOW,
    );

    const overdueInvoice = normalizeHistoryJob(
      {
        id: "job-overdue",
        created_at: "2026-08-05T00:00:00.000Z",
        extracted_json: { job_type: "Overdue job" },
        customer: { name: "Customer E" },
        quote: {
          total: 500,
          status: "accepted",
          sent_at: "2026-08-05T00:00:00.000Z",
          viewed_at: null,
          accepted_at: "2026-08-06T00:00:00.000Z",
          declined_at: null,
          created_at: "2026-08-05T00:00:00.000Z",
          contracts: [
            {
              id: "contract-3",
              status: "signed",
              sent_at: "2026-08-06T00:00:00.000Z",
              signed_at: "2026-08-07T00:00:00.000Z",
              deposit_pct: null,
            },
          ],
          invoices: [
            {
              id: "invoice-overdue",
              status: "sent",
              invoice_type: "final",
              due_date: "2026-08-10T00:00:00.000Z",
              created_at: "2026-08-08T00:00:00.000Z",
              paid_at: null,
            },
          ],
        },
      },
      NOW,
    );

    // Input is shuffled relative to the expected urgency order.
    const input = [draft, sentContract, sentQuote, unpaidInvoice, overdueInvoice];
    const sorted = sortByUrgency(input);

    // Expected order: overdue → unpaid → sent quote → sent contract → draft
    expect(sorted.map((j) => j.jobId)).toEqual([
      "job-overdue",
      "job-unpaid",
      "job-quote",
      "job-contract",
      "job-draft",
    ]);
  });

  it("sorts oldest-first within each tier, with job ID as tie-break", async () => {
    const { sortByUrgency } = await import("@/lib/job-history");
    const { normalizeHistoryJob } = await import("@/lib/job-history");
    const NOW = new Date("2026-08-21T12:00:00.000Z").getTime();

    // Two sent quotes, different ages.
    const quoteOlder = normalizeHistoryJob(
      {
        id: "job-quote-older",
        created_at: "2026-07-01T00:00:00.000Z",
        extracted_json: null,
        customer: { name: "Customer A" },
        quote: {
          total: 100,
          status: "sent",
          sent_at: "2026-07-01T00:00:00.000Z",
          viewed_at: null,
          accepted_at: null,
          declined_at: null,
          created_at: "2026-07-01T00:00:00.000Z",
          contracts: [],
          invoices: [],
        },
      },
      NOW,
    );

    const quoteNewer = normalizeHistoryJob(
      {
        id: "job-quote-newer",
        created_at: "2026-08-01T00:00:00.000Z",
        extracted_json: null,
        customer: { name: "Customer B" },
        quote: {
          total: 200,
          status: "sent",
          sent_at: "2026-08-01T00:00:00.000Z",
          viewed_at: null,
          accepted_at: null,
          declined_at: null,
          created_at: "2026-08-01T00:00:00.000Z",
          contracts: [],
          invoices: [],
        },
      },
      NOW,
    );

    // Two sent quotes with identical sortAt, different job IDs.
    const quoteSameTimeA = normalizeHistoryJob(
      {
        id: "job-quote-same-b",
        created_at: "2026-08-10T12:00:00.000Z",
        extracted_json: null,
        customer: { name: "Customer C" },
        quote: {
          total: 300,
          status: "sent",
          sent_at: "2026-08-10T12:00:00.000Z",
          viewed_at: null,
          accepted_at: null,
          declined_at: null,
          created_at: "2026-08-10T12:00:00.000Z",
          contracts: [],
          invoices: [],
        },
      },
      NOW,
    );

    const quoteSameTimeB = normalizeHistoryJob(
      {
        id: "job-quote-same-a",
        created_at: "2026-08-10T12:00:00.000Z",
        extracted_json: null,
        customer: { name: "Customer D" },
        quote: {
          total: 400,
          status: "sent",
          sent_at: "2026-08-10T12:00:00.000Z",
          viewed_at: null,
          accepted_at: null,
          declined_at: null,
          created_at: "2026-08-10T12:00:00.000Z",
          contracts: [],
          invoices: [],
        },
      },
      NOW,
    );

    const input = [quoteNewer, quoteSameTimeA, quoteOlder, quoteSameTimeB];
    const sorted = sortByUrgency(input);

    // Expected: oldest first, then alphabetical job ID when timestamps match.
    expect(sorted.map((j) => j.jobId)).toEqual([
      "job-quote-older",
      "job-quote-newer",
      "job-quote-same-a",
      "job-quote-same-b",
    ]);
  });

  it("provides tier labels for rendering sections", async () => {
    const mod = await import("@/lib/job-history");
    expect(mod.URGENCY_TIER_LABELS).toBeDefined();
    expect(Array.isArray(mod.URGENCY_TIER_LABELS)).toBe(true);
    expect(mod.URGENCY_TIER_LABELS.length).toBeGreaterThan(0);

    // Check that the labels are human-readable, not situation keys.
    const labels = mod.URGENCY_TIER_LABELS;
    const hasOverdueLabel = labels.some((entry) =>
      entry.label.toLowerCase().includes("overdue"),
    );
    expect(hasOverdueLabel).toBe(true);
  });

  it("groups jobs by tier for section rendering", async () => {
    const mod = await import("@/lib/job-history");
    expect(mod.groupByUrgencyTier).toBeDefined();
    expect(typeof mod.groupByUrgencyTier).toBe("function");

    const { groupByUrgencyTier, normalizeHistoryJob } = mod;
    const NOW = new Date("2026-08-21T12:00:00.000Z").getTime();

    // One overdue, one sent quote.
    const overdue = normalizeHistoryJob(
      {
        id: "job-overdue",
        created_at: "2026-08-01T00:00:00.000Z",
        extracted_json: null,
        customer: { name: "Customer A" },
        quote: {
          total: 500,
          status: "accepted",
          sent_at: "2026-08-01T00:00:00.000Z",
          viewed_at: null,
          accepted_at: "2026-08-02T00:00:00.000Z",
          declined_at: null,
          created_at: "2026-08-01T00:00:00.000Z",
          contracts: [
            {
              id: "contract-1",
              status: "signed",
              sent_at: "2026-08-02T00:00:00.000Z",
              signed_at: "2026-08-03T00:00:00.000Z",
              deposit_pct: null,
            },
          ],
          invoices: [
            {
              id: "invoice-overdue",
              status: "sent",
              invoice_type: "final",
              due_date: "2026-08-10T00:00:00.000Z",
              created_at: "2026-08-04T00:00:00.000Z",
              paid_at: null,
            },
          ],
        },
      },
      NOW,
    );

    const sentQuote = normalizeHistoryJob(
      {
        id: "job-quote",
        created_at: "2026-08-05T00:00:00.000Z",
        extracted_json: null,
        customer: { name: "Customer B" },
        quote: {
          total: 300,
          status: "sent",
          sent_at: "2026-08-05T00:00:00.000Z",
          viewed_at: null,
          accepted_at: null,
          declined_at: null,
          created_at: "2026-08-05T00:00:00.000Z",
          contracts: [],
          invoices: [],
        },
      },
      NOW,
    );

    const grouped = groupByUrgencyTier([overdue, sentQuote]);

    // The result is an array of {tier, label, jobs} objects.
    expect(Array.isArray(grouped)).toBe(true);
    expect(grouped.length).toBe(2);

    // First group is overdue.
    expect(grouped[0].jobs).toContain(overdue);
    expect(grouped[0].label.toLowerCase()).toContain("overdue");

    // Second group is sent quotes.
    expect(grouped[1].jobs).toContain(sentQuote);
  });

  it("omits empty tiers from the grouped output", async () => {
    const { groupByUrgencyTier, normalizeHistoryJob } = await import("@/lib/job-history");
    const NOW = new Date("2026-08-21T12:00:00.000Z").getTime();

    // One sent quote, no overdue invoices.
    const sentQuote = normalizeHistoryJob(
      {
        id: "job-quote",
        created_at: "2026-08-05T00:00:00.000Z",
        extracted_json: null,
        customer: { name: "Customer A" },
        quote: {
          total: 300,
          status: "sent",
          sent_at: "2026-08-05T00:00:00.000Z",
          viewed_at: null,
          accepted_at: null,
          declined_at: null,
          created_at: "2026-08-05T00:00:00.000Z",
          contracts: [],
          invoices: [],
        },
      },
      NOW,
    );

    const grouped = groupByUrgencyTier([sentQuote]);

    // Only one tier should appear.
    expect(grouped.length).toBe(1);
    expect(grouped[0].jobs).toContain(sentQuote);
  });

  it("the jobs page uses sortByUrgency for in_progress filter", async () => {
    // This test imports the jobs page module to verify it references sortByUrgency.
    // We cannot run the page as a React component here (no server context), but
    // we can confirm the sort function is imported and used.
    const mod = await import("@/app/jobs/page");
    expect(mod.default).toBeDefined();

    // The source should reference sortByUrgency when filter is in_progress.
    // Read the source as a string to confirm.
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("src/app/jobs/page.tsx", "utf-8");
    expect(source).toContain("sortByUrgency");
  });

  it("the jobs page uses sortByRecency for non-in-progress filters", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("src/app/jobs/page.tsx", "utf-8");

    // The page should still reference sortByRecency for other buckets.
    expect(source).toContain("sortByRecency");
  });

  it("HistoryJob type includes situation field", async () => {
    const { normalizeHistoryJob } = await import("@/lib/job-history");
    const NOW = new Date("2026-08-21T12:00:00.000Z").getTime();

    const draft = normalizeHistoryJob(
      {
        id: "job-draft",
        created_at: "2026-08-01T00:00:00.000Z",
        extracted_json: null,
        customer: null,
        quote: {
          total: 100,
          status: "draft",
          sent_at: null,
          viewed_at: null,
          accepted_at: null,
          declined_at: null,
          created_at: "2026-08-01T00:00:00.000Z",
          contracts: [],
          invoices: [],
        },
      },
      NOW,
    );

    expect(draft.situation).toBeDefined();
    expect(typeof draft.situation).toBe("string");
    expect(draft.situation).toBe("draft_quote");
  });
});
