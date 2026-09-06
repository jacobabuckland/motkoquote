/**
 * @vitest-environment happy-dom
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { SupabaseClient } from "@supabase/supabase-js";

afterEach(cleanup);

// Mock createClient at the top level
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

// Mock throwIfQueryFailed - default no-op
vi.mock("@/lib/query-error", () => ({
  throwIfQueryFailed: vi.fn(async () => {}),
}));

describe("MONEY-1: The paid panel shows amounts correctly, not at 1/100th", () => {
  function createMockSupabase(options?: {
    jobData?: unknown;
    jobError?: unknown;
    quoteData?: unknown;
    quoteError?: unknown;
  }) {
    const mockAuth = {
      getUser: vi.fn(async () => ({
        data: { user: { id: "test-user" } },
        error: null,
      })),
    };

    const mockFrom = (table?: string) => {
      const mockSelect = () => {
        const mockEq = () => {
          let data = null;
          let error = null;

          if (table === "jobs") {
            data = options?.jobData ?? null;
            error = options?.jobError ?? null;
          } else if (table === "quotes") {
            data = options?.quoteData ?? null;
            error = options?.quoteError ?? null;
          } else if (table === "job_costs") {
            // Default empty costs
            data = [];
            error = null;
          } else if (table === "contractors") {
            // Default contractor
            data = { id: "contractor-123" };
            error = null;
          }

          return {
            data,
            error,
            eq: mockEq,
            order: vi.fn(async () => ({ data: data ?? [], error })),
            maybeSingle: vi.fn(async () => ({ data, error })),
            single: vi.fn(async () => ({ data, error })),
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

  it("shows Customer paid £500.00 and You receive £490.10 for a settled £500 job with £9.90 fee", async () => {
    const { createClient } = await import("@/lib/supabase/server");

    const jobData = {
      id: "job-money-1-test",
      status: "quoted",
      fee_amount_pennies: 990,
      fee_status: "collected",
      fee_waived_reason: null,
      settlement_state: "settled",
      payment_provider_ref: "pi_test123",
      work_completed_at: "2026-09-06T10:00:00Z",
      customer: {
        name: "Test Customer",
        contact: { email: "test@example.com" }
      },
      contractor: {
        vat_registered: false,
        free_jobs_remaining: 0,
        business_profile: null
      },
    };

    const quoteData = {
      id: "quote-money-1-test",
      line_items_json: [
        {
          category: "labour" as const,
          description: "Test work",
          quantity: 10,
          unit: "hours",
          unit_price: 50,
          multiplier: 1,
          people_count: 1,
          overtime: false,
          assumed: false,
        },
      ],
      total: 500,
      status: "accepted",
      sent_at: "2026-09-05T10:00:00Z",
      accepted_at: "2026-09-05T11:00:00Z",
      invoices: [
        {
          id: "invoice-money-1-test",
          amount: 500.00,
          status: "paid",
          invoice_type: "final",
          paid_at: "2026-09-06T10:00:00Z",
          created_at: "2026-09-05T12:00:00Z",
        },
      ],
      contracts: [
        {
          id: "contract-money-1-test",
          status: "signed",
          sent_at: "2026-09-05T10:00:00Z",
          signed_at: "2026-09-05T11:00:00Z",
        },
      ],
    };

    const mockClient = createMockSupabase({ jobData, quoteData });
    vi.mocked(createClient).mockResolvedValue(mockClient);

    const mod = await import("@/app/jobs/[id]/page");
    const Page = mod.default;

    const { container } = render(
      await Page({
        params: Promise.resolve({ id: "job-money-1-test" }),
        searchParams: Promise.resolve({}),
      }),
    );

    const receiptText = container.textContent ?? "";

    // The defect: currently shows £5.00 instead of £500.00, and -£4.90 instead of £490.10
    // After fix: must show correct amounts
    expect(receiptText).toContain("Customer paid");
    expect(receiptText).toContain("£500.00");

    expect(receiptText).toContain("Motko payment fee");
    expect(receiptText).toContain("£9.90");

    expect(receiptText).toContain("You receive");
    expect(receiptText).toContain("£490.10");

    // Must never show a negative amount on "You receive"
    expect(receiptText).not.toContain("-£");
  });

  it("shows the full amount received when fee is waived", async () => {
    const { createClient } = await import("@/lib/supabase/server");

    const jobData = {
      id: "job-money-1-waived",
      status: "quoted",
      fee_amount_pennies: 0,
      fee_status: "not_applicable",
      fee_waived_reason: "free_allowance",
      settlement_state: "settled",
      payment_provider_ref: "pi_test456",
      work_completed_at: "2026-09-06T10:00:00Z",
      customer: {
        name: "Test Customer",
        contact: { email: "test@example.com" }
      },
      contractor: {
        vat_registered: false,
        free_jobs_remaining: 2,
        business_profile: null
      },
    };

    const quoteData = {
      id: "quote-money-1-waived",
      line_items_json: [
        {
          category: "labour" as const,
          description: "Test work",
          quantity: 8,
          unit: "hours",
          unit_price: 50,
          multiplier: 1,
          people_count: 1,
          overtime: false,
          assumed: false,
        },
      ],
      total: 400,
      status: "accepted",
      sent_at: "2026-09-05T10:00:00Z",
      accepted_at: "2026-09-05T11:00:00Z",
      invoices: [
        {
          id: "invoice-money-1-waived",
          amount: 400.00,
          status: "paid",
          invoice_type: "final",
          paid_at: "2026-09-06T10:00:00Z",
          created_at: "2026-09-05T12:00:00Z",
        },
      ],
      contracts: [
        {
          id: "contract-money-1-waived",
          status: "signed",
          sent_at: "2026-09-05T10:00:00Z",
          signed_at: "2026-09-05T11:00:00Z",
        },
      ],
    };

    const mockClient = createMockSupabase({ jobData, quoteData });
    vi.mocked(createClient).mockResolvedValue(mockClient);

    const mod = await import("@/app/jobs/[id]/page");
    const Page = mod.default;

    const { container } = render(
      await Page({
        params: Promise.resolve({ id: "job-money-1-waived" }),
        searchParams: Promise.resolve({}),
      }),
    );

    const receiptText = container.textContent ?? "";

    // When fee is waived, full amount is received
    expect(receiptText).toContain("Customer paid");
    expect(receiptText).toContain("£400.00");

    expect(receiptText).toContain("Waived");
    expect(receiptText).toContain("free jobs");

    expect(receiptText).toContain("You receive");
    expect(receiptText).toContain("£400.00");

    // Must never show a negative amount
    expect(receiptText).not.toContain("-£");
  });
});
