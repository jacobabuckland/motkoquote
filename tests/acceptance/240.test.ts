import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

describe("PAY-8: off-rails invoice reporting", () => {
  describe("reportOffRailsInvoices", () => {
    it("exists as an importable function", async () => {
      const mod = await import("@/lib/report-off-rails-invoices");
      expect(mod.reportOffRailsInvoices).toBeDefined();
      expect(typeof mod.reportOffRailsInvoices).toBe("function");
    });

    it("identifies invoices paid with no Stripe payment", async () => {
      const { reportOffRailsInvoices } = await import(
        "@/lib/report-off-rails-invoices"
      );

      const mockSupabase = createMockSupabase([
        {
          id: "inv-1",
          amount: 5000,
          status: "paid",
          payment_method: "bank_transfer",
          paid_at: "2026-08-16T10:00:00Z",
          quote: { job: { payment_provider_ref: null } },
        },
      ]);

      const report = await reportOffRailsInvoices(mockSupabase);

      expect(report.totalCount).toBe(1);
      expect(report.totalValue).toBe(5000);
    });

    it("excludes invoices paid via Stripe", async () => {
      const { reportOffRailsInvoices } = await import(
        "@/lib/report-off-rails-invoices"
      );

      const mockSupabase = createMockSupabase([
        {
          id: "inv-1",
          amount: 5000,
          status: "paid",
          payment_method: "stripe_bank",
          paid_at: "2026-08-16T10:00:00Z",
          quote: { job: { payment_provider_ref: "pi_abc123" } },
        },
      ]);

      const report = await reportOffRailsInvoices(mockSupabase);

      expect(report.totalCount).toBe(0);
      expect(report.totalValue).toBe(0);
    });

    it("excludes legacy TrueLayer invoices by payment_method", async () => {
      const { reportOffRailsInvoices } = await import(
        "@/lib/report-off-rails-invoices"
      );

      const mockSupabase = createMockSupabase([
        {
          id: "inv-1",
          amount: 5000,
          status: "paid",
          payment_method: "motko_bank",
          paid_at: "2026-08-10T10:00:00Z",
          quote: { job: { payment_provider_ref: "tl_abc123" } },
        },
      ]);

      const report = await reportOffRailsInvoices(mockSupabase);

      expect(report.totalCount).toBe(0);
    });

    it("excludes pre-migration null payment_method invoices", async () => {
      const { reportOffRailsInvoices } = await import(
        "@/lib/report-off-rails-invoices"
      );

      const mockSupabase = createMockSupabase([
        {
          id: "inv-1",
          amount: 5000,
          status: "paid",
          payment_method: null,
          paid_at: "2026-08-14T10:00:00Z",
          quote: { job: { payment_provider_ref: null } },
        },
      ]);

      const report = await reportOffRailsInvoices(mockSupabase);

      expect(report.totalCount).toBe(0);
    });

    it("splits results by value band", async () => {
      const { reportOffRailsInvoices } = await import(
        "@/lib/report-off-rails-invoices"
      );

      const mockSupabase = createMockSupabase([
        {
          id: "inv-1",
          amount: 1500,
          status: "paid",
          payment_method: "cash",
          paid_at: "2026-08-16T10:00:00Z",
          quote: { job: { payment_provider_ref: null } },
        },
        {
          id: "inv-2",
          amount: 4000,
          status: "paid",
          payment_method: "bank_transfer",
          paid_at: "2026-08-16T10:00:00Z",
          quote: { job: { payment_provider_ref: null } },
        },
        {
          id: "inv-3",
          amount: 8500,
          status: "paid",
          payment_method: "other",
          paid_at: "2026-08-16T10:00:00Z",
          quote: { job: { payment_provider_ref: null } },
        },
        {
          id: "inv-4",
          amount: 15000,
          status: "paid",
          payment_method: "bank_transfer",
          paid_at: "2026-08-16T10:00:00Z",
          quote: { job: { payment_provider_ref: null } },
        },
        {
          id: "inv-5",
          amount: 30000,
          status: "paid",
          payment_method: "bank_transfer",
          paid_at: "2026-08-16T10:00:00Z",
          quote: { job: { payment_provider_ref: null } },
        },
      ]);

      const report = await reportOffRailsInvoices(mockSupabase);

      expect(report.totalCount).toBe(5);
      expect(report.bands).toBeDefined();
      expect(report.bands["£0-£2,500"].count).toBe(1);
      expect(report.bands["£2,501-£5,000"].count).toBe(1);
      expect(report.bands["£5,001-£10,000"].count).toBe(1);
      expect(report.bands["£10,001-£25,000"].count).toBe(1);
      expect(report.bands["£25,001+"].count).toBe(1);
    });

    it("returns empty report when no off-rails invoices exist", async () => {
      const { reportOffRailsInvoices } = await import(
        "@/lib/report-off-rails-invoices"
      );

      const mockSupabase = createMockSupabase([]);

      const report = await reportOffRailsInvoices(mockSupabase);

      expect(report.totalCount).toBe(0);
      expect(report.totalValue).toBe(0);
    });

    it("detects off-rails via payment_method even when payment_provider_ref exists", async () => {
      const { reportOffRailsInvoices } = await import(
        "@/lib/report-off-rails-invoices"
      );

      const mockSupabase = createMockSupabase([
        {
          id: "inv-1",
          amount: 5000,
          status: "paid",
          payment_method: "bank_transfer",
          paid_at: "2026-08-16T10:00:00Z",
          quote: { job: { payment_provider_ref: "pi_abandoned" } },
        },
      ]);

      const report = await reportOffRailsInvoices(mockSupabase);

      expect(report.totalCount).toBe(1);
    });

  });

  describe("cron endpoint", () => {
    it("exists at /api/cron/report-off-rails-invoices", async () => {
      const mod = await import(
        "@/app/api/cron/report-off-rails-invoices/route"
      );
      expect(mod.GET).toBeDefined();
    });

    it("requires CRON_SECRET authorization", async () => {
      const mod = await import(
        "@/app/api/cron/report-off-rails-invoices/route"
      );

      // NextRequest, not Request: the route is typed `(request: NextRequest)`
      // and reads `nextUrl`/`cookies`, which a bare Request does not carry.
      const request = new NextRequest(
        "http://localhost:3000/api/cron/report-off-rails-invoices",
        {
          method: "GET",
          headers: {},
        }
      );

      const response = await mod.GET(request);
      expect(response.status).toBe(401);
    });
  });
});

// Test helper to create a mock Supabase client that returns paid invoices
type InvoiceRow = {
  id: string;
  amount: number;
  status: string;
  payment_method: string | null;
  paid_at: string | null;
  quote: {
    job: {
      payment_provider_ref: string | null;
    };
  } | null;
};

function createMockSupabase(invoices: InvoiceRow[]): SupabaseClient {
  // Simulate Supabase's .eq("status", "paid") filter
  const paidInvoices = invoices.filter((inv) => inv.status === "paid");

  const mockFrom = vi.fn(() => ({
    select: vi.fn(() => ({
      eq: vi.fn((field: string, value: string) => {
        if (field === "status" && value === "paid") {
          return {
            data: paidInvoices,
            error: null,
          };
        }
        return {
          data: invoices,
          error: null,
        };
      }),
    })),
  }));

  return {
    from: mockFrom,
  } as unknown as SupabaseClient;
}
