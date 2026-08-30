// The voice ledger job lookup selected `jobs.description`, which does not
// exist in the database schema. PostgREST rejected the query, returning
// { data: null, error: {...} }, but the code destructured only `data` and
// treated the null result identically to "no matching job found". Every
// "how's the Henderson job doing?" resolved to nothing.
//
// These tests use a recording stub client to verify:
// (a) the select names no non-existent column
// (b) jobs are found by customer name
// (c) query errors propagate rather than reading as "no match"

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

type SelectCall = {
  table: string;
  selectString: string;
};

let selectCalls: SelectCall[];
let stubJobs: Array<{
  id: string;
  created_at: string;
  customer: { name: string } | null;
}>;
let stubError: { message: string } | null;

const makeQuery = (table: string) => {
  const query = {
    select: (selectString?: string) => {
      if (selectString) {
        selectCalls.push({ table, selectString });
      }
      return query;
    },
    eq: (_column?: string, _value?: unknown) => query,
    order: (_column?: string, _opts?: { ascending: boolean }) => query,
    single: async () => ({ data: null, error: null }),
    then: async (
      resolve?: (value: { data: unknown; error: unknown }) => unknown,
    ) => {
      if (resolve) {
        return resolve({ data: stubJobs, error: stubError });
      }
      return { data: stubJobs, error: stubError };
    },
  };
  return query;
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () =>
    ({
      auth: {
        getUser: async () => ({ data: { user: { id: "user-1" } } }),
      },
      from: (table: string) => makeQuery(table),
    }) as unknown as SupabaseClient,
}));

// Mock getJobPnL to return a valid PnL object when called with a valid job ID
vi.mock("@/app/jobs/[id]/pnl-actions", () => ({
  getJobPnL: async (_jobId?: string) => ({
    grossProfit: 1000,
    marginPct: 25,
    invoicedNet: 4000,
    costsNet: 3000,
    hasInvoice: true,
  }),
}));

beforeEach(() => {
  vi.resetModules();
  selectCalls = [];
  stubJobs = [];
  stubError = null;
});

describe("job lookup by customer name", () => {
  it("does not select a column that jobs does not have", async () => {
    stubJobs = [
      {
        id: "job-1",
        created_at: "2026-08-20T10:00:00Z",
        customer: { name: "Henderson Ltd" },
      },
    ];

    const { getJobProfit } = await import("@/app/ledger/query-actions");
    await getJobProfit("contractor-1", "Henderson");

    const jobsSelect = selectCalls.find((call) => call.table === "jobs");
    expect(
      jobsSelect?.selectString,
      "jobs.description does not exist — selecting it causes PostgREST to reject the query",
    ).toBeDefined();
    expect(jobsSelect!.selectString).not.toContain("description");
  });

  it("finds a job by its customer's name", async () => {
    stubJobs = [
      {
        id: "job-1",
        created_at: "2026-08-20T10:00:00Z",
        customer: { name: "Henderson Ltd" },
      },
      {
        id: "job-2",
        created_at: "2026-08-19T10:00:00Z",
        customer: { name: "Smith & Co" },
      },
    ];

    const { getJobProfit } = await import("@/app/ledger/query-actions");
    const result = await getJobProfit("contractor-1", "Henderson");

    expect(result).toBeDefined();
    expect(result.hasInvoice).toBe(true);
  });

  it("returns the most recent of two matches", async () => {
    stubJobs = [
      {
        id: "job-new",
        created_at: "2026-08-20T10:00:00Z",
        customer: { name: "Henderson Ltd" },
      },
      {
        id: "job-old",
        created_at: "2026-08-15T10:00:00Z",
        customer: { name: "Henderson & Co" },
      },
    ];

    // Mock getJobPnL to return different values based on job ID so we can
    // verify which job was selected
    vi.doMock("@/app/jobs/[id]/pnl-actions", () => ({
      getJobPnL: async (jobId?: string) => {
        if (jobId === "job-new") {
          return {
            grossProfit: 2000,
            marginPct: 30,
            invoicedNet: 5000,
            costsNet: 3000,
            hasInvoice: true,
          };
        }
        return {
          grossProfit: 1000,
          marginPct: 20,
          invoicedNet: 4000,
          costsNet: 3000,
          hasInvoice: true,
        };
      },
    }));

    vi.resetModules();
    const { getJobProfit } = await import("@/app/ledger/query-actions");
    const result = await getJobProfit("contractor-1", "Henderson");

    expect(
      result.grossProfit,
      "most recent match (job-new) should be selected, not job-old",
    ).toBe(2000);
  });

  it("propagates a query error rather than treating it as no match", async () => {
    stubError = { message: "column jobs.description does not exist" };
    stubJobs = [];

    const { getJobProfit } = await import("@/app/ledger/query-actions");

    await expect(
      getJobProfit("contractor-1", "Henderson"),
    ).rejects.toThrow();
  });

  it("throws Job not found for a genuine empty result", async () => {
    stubJobs = [];
    stubError = null;

    const { getJobProfit } = await import("@/app/ledger/query-actions");

    await expect(
      getJobProfit("contractor-1", "NonExistent"),
    ).rejects.toThrow("Job not found");
  });

  it("does not throw when a job has no customer", async () => {
    stubJobs = [
      {
        id: "job-orphan",
        created_at: "2026-08-20T10:00:00Z",
        customer: null,
      },
      {
        id: "job-valid",
        created_at: "2026-08-19T10:00:00Z",
        customer: { name: "Henderson Ltd" },
      },
    ];

    const { getJobProfit } = await import("@/app/ledger/query-actions");
    const result = await getJobProfit("contractor-1", "Henderson");

    expect(
      result,
      "job with null customer should be silently skipped, valid one should match",
    ).toBeDefined();
    expect(result.hasInvoice).toBe(true);
  });
});
