/**
 * @vitest-environment happy-dom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { SupabaseClient } from "@supabase/supabase-js";

afterEach(cleanup);

// Mock requireContractor
vi.mock("@/lib/require-contractor", () => ({
  requireContractor: vi.fn(async () => ({
    id: "contractor-123",
    vat_registered: false,
  })),
}));

// Mock throwIfQueryFailed - default is no-op, tests can override
vi.mock("@/lib/query-error", () => ({
  throwIfQueryFailed: vi.fn(async (error?: unknown) => {
    if (error) throw new Error("Query failed");
  }),
}));

// We'll mock createClient per-test
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

type SelectCall = {
  table: string;
  columns: string;
};

describe("DATA-4: Job P&L restoration", () => {
  const selectCalls: SelectCall[] = [];

  beforeEach(() => {
    selectCalls.length = 0;
  });

  function createRecordingSupabase(options?: {
    quotesData?: unknown;
    quotesError?: unknown;
    invoicesData?: unknown;
    invoicesError?: unknown;
    costsData?: unknown;
    costsError?: unknown;
    jobData?: unknown;
    jobError?: unknown;
    authUser?: unknown;
  }) {
    const mockAuth = {
      getUser: vi.fn(async () => ({
        data: { user: options?.authUser ?? { id: "user-123" } },
        error: null,
      })),
    };

    const mockFrom = (table?: string) => {
      const mockSelect = (columns?: string) => {
        if (table && columns) {
          selectCalls.push({ table, columns });
        }

        const mockEq = () => {
          // Return appropriate data based on table
          let data = null;
          let error = null;

          if (table === "jobs") {
            data = options?.jobData ?? null;
            error = options?.jobError ?? null;
          } else if (table === "invoices") {
            data = options?.invoicesData ?? null;
            error = options?.invoicesError ?? null;
          } else if (table === "job_costs") {
            data = options?.costsData ?? null;
            error = options?.costsError ?? null;
          } else if (table === "quotes") {
            data = options?.quotesData ?? null;
            error = options?.quotesError ?? null;
          }

          return {
            data,
            error,
            eq: mockEq,
            single: vi.fn(() => ({ data, error })),
            maybeSingle: vi.fn(() => ({ data, error })),
          };
        };

        return { eq: mockEq };
      };

      return { select: mockSelect };
    };

    return {
      from: mockFrom,
      auth: mockAuth,
    } as unknown as SupabaseClient;
  }

  describe("getJobPnL", () => {
    it("selects only columns that exist (no quote_id on jobs, no vat_amount on invoices)", async () => {
      const { createClient } = await import("@/lib/supabase/server");
      const mockClient = createRecordingSupabase({
        jobData: { id: "job-1" },
        quotesData: { job_id: "job-1" },
        invoicesData: [{ amount: 100 }],
        costsData: [{ amount_net: 5000, vat_amount: 0, paid: false }],
      });

      vi.mocked(createClient).mockResolvedValue(mockClient);

      const { getJobPnL } = await import("@/app/jobs/[id]/pnl-actions");
      await getJobPnL("job-1");

      // Check jobs select does not include quote_id
      const jobsSelects = selectCalls.filter((c) => c.table === "jobs");
      for (const call of jobsSelects) {
        expect(call.columns).not.toMatch(/quote_id/);
      }

      // Check invoices select does not include vat_amount
      const invoicesSelects = selectCalls.filter((c) => c.table === "invoices");
      for (const call of invoicesSelects) {
        expect(call.columns).not.toMatch(/vat_amount/);
      }
    });

    it("returns computed P&L data for a job with quote and invoices", async () => {
      const { createClient } = await import("@/lib/supabase/server");
      const mockClient = createRecordingSupabase({
        jobData: { id: "job-1" },
        quotesData: { job_id: "job-1" },
        invoicesData: [
          { amount: 100.0 }, // £100 = 10000 pence
          { amount: 50.0 }, // £50 = 5000 pence
        ],
        costsData: [
          { amount_net: 3000, vat_amount: 600, paid: false },
          { amount_net: 2000, vat_amount: 400, paid: true },
        ],
      });

      vi.mocked(createClient).mockResolvedValue(mockClient);

      const { getJobPnL } = await import("@/app/jobs/[id]/pnl-actions");
      const result = await getJobPnL("job-1");

      expect(result).not.toBeNull();
      expect(result?.invoicedNet).toBe(15000); // 100 + 50 = 150 pounds = 15000 pence
      expect(result?.costsNet).toBe(5000); // 3000 + 2000 pence
      expect(result?.grossProfit).toBe(10000); // 15000 - 5000
      expect(result?.unpaidCosts).toBe(3000); // only the unpaid cost
      expect(result?.hasInvoice).toBe(true);
      expect(result?.marginPct).toBeGreaterThan(0);
    });

    it("converts invoice amounts from pounds to pence but leaves cost amounts unchanged", async () => {
      const { createClient } = await import("@/lib/supabase/server");
      const mockClient = createRecordingSupabase({
        jobData: { id: "job-1" },
        quotesData: { job_id: "job-1" },
        invoicesData: [{ amount: 123.45 }], // £123.45 should become 12345 pence
        costsData: [{ amount_net: 6789, vat_amount: 0, paid: false }], // already in pence
      });

      vi.mocked(createClient).mockResolvedValue(mockClient);

      const { getJobPnL } = await import("@/app/jobs/[id]/pnl-actions");
      const result = await getJobPnL("job-1");

      expect(result).not.toBeNull();
      expect(result?.invoicedNet).toBe(12345); // converted from pounds
      expect(result?.costsNet).toBe(6789); // unchanged, already pence
    });

    it("returns null when job has no quote", async () => {
      const { createClient } = await import("@/lib/supabase/server");
      const mockClient = createRecordingSupabase({
        jobData: { id: "job-1" },
        quotesData: null, // no quote
      });

      vi.mocked(createClient).mockResolvedValue(mockClient);

      const { getJobPnL } = await import("@/app/jobs/[id]/pnl-actions");
      const result = await getJobPnL("job-1");

      expect(result).toBeNull();
    });

    it("throws when a query fails rather than returning null", async () => {
      const { createClient } = await import("@/lib/supabase/server");
      const mockClient = createRecordingSupabase({
        jobError: { message: "Database error", code: "500" },
      });

      vi.mocked(createClient).mockResolvedValue(mockClient);

      const { getJobPnL } = await import("@/app/jobs/[id]/pnl-actions");

      await expect(getJobPnL("job-1")).rejects.toThrow();
    });

    it("returns null when job belongs to another contractor", async () => {
      const { requireContractor } = await import("@/lib/require-contractor");

      // Mock requireContractor to return a different contractor
      vi.mocked(requireContractor).mockResolvedValueOnce({
        id: "other-contractor",
        vat_registered: false,
      });

      const { createClient } = await import("@/lib/supabase/server");
      const mockClient = createRecordingSupabase({
        jobData: null, // ownership check fails
      });

      vi.mocked(createClient).mockResolvedValue(mockClient);

      const { getJobPnL } = await import("@/app/jobs/[id]/pnl-actions");
      const result = await getJobPnL("job-1");

      expect(result).toBeNull();
    });
  });

  describe("PnLData type and component", () => {
    it("PnLData carries no VAT fields", async () => {
      // Import the type through the module
      const { createClient } = await import("@/lib/supabase/server");
      const mockClient = createRecordingSupabase({
        jobData: { id: "job-1" },
        quotesData: { job_id: "job-1" },
        invoicesData: [{ amount: 100 }],
        costsData: [{ amount_net: 5000, vat_amount: 0, paid: false }],
      });

      vi.mocked(createClient).mockResolvedValue(mockClient);

      const { getJobPnL } = await import("@/app/jobs/[id]/pnl-actions");
      const result = await getJobPnL("job-1");

      // Verify the returned data has no VAT fields
      expect(result).toBeDefined();
      if (result) {
        expect("vatCollected" in result).toBe(false);
        expect("vatOnCosts" in result).toBe(false);
        expect("vatPosition" in result).toBe(false);
      }
    });

    it("rendered panel shows no VAT position heading for VAT-registered contractor", async () => {
      const { JobPnL } = await import("@/app/jobs/[id]/job-pnl");

      const pnlData = {
        invoicedNet: 10000,
        costsNet: 5000,
        grossProfit: 5000,
        marginPct: 50,
        unpaidCosts: 0,
        hasInvoice: true,
      };

      render(<JobPnL data={pnlData} contractorVatRegistered={true} />);

      // Should NOT find "VAT position" heading
      expect(screen.queryByRole("heading", { name: /VAT position/i })).toBeNull();

      // Should find the main P&L elements
      expect(screen.getByRole("heading", { name: /Profit & Loss/i })).toBeDefined();
      expect(screen.getByText(/Invoiced \(net\)/i)).toBeDefined();
      expect(screen.getByText(/Costs \(net\)/i)).toBeDefined();
    });

    it("disclaimer is present for non-VAT-registered contractor", async () => {
      const { JobPnL } = await import("@/app/jobs/[id]/job-pnl");

      const pnlData = {
        invoicedNet: 10000,
        costsNet: 5000,
        grossProfit: 5000,
        marginPct: 50,
        unpaidCosts: 0,
        hasInvoice: true,
      };

      render(<JobPnL data={pnlData} contractorVatRegistered={false} />);

      // The disclaimer should be present
      expect(screen.getByText(/not tax advice/i)).toBeDefined();
      expect(screen.getByText(/accountant/i)).toBeDefined();
    });
  });
});
