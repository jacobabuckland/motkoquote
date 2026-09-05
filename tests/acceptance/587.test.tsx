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

describe("SUB-5: Fee visibility on the trade's payment receipt", () => {
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

  it("shows a three-line payment receipt for a settled job with fee collected", async () => {
    const { createClient } = await import("@/lib/supabase/server");

    const jobData = {
      id: "job-1",
      status: "quoted",
      fee_amount_pennies: 990,
      fee_status: "collected",
      fee_waived_reason: null,
      work_completed_at: "2026-09-01T10:00:00Z",
      customer: { name: "Alice Smith", contact: { email: "alice@example.com" } },
      contractor: { vat_registered: false, free_jobs_remaining: 0, business_profile: null },
    };

    const quoteData = {
      id: "quote-1",
      line_items_json: [{ category: "labour", quantity: 10, unit_price: 5000, multiplier: 1 }],
      total: 50000,
      status: "accepted",
      sent_at: "2026-08-30T10:00:00Z",
      accepted_at: "2026-08-31T10:00:00Z",
      invoices: [
        {
          id: "invoice-1",
          amount: 50000,
          status: "paid",
          invoice_type: "final",
          paid_at: "2026-09-01T10:00:00Z",
          created_at: "2026-08-31T12:00:00Z",
        },
      ],
      contracts: [
        {
          id: "contract-1",
          status: "signed",
          sent_at: "2026-08-31T10:00:00Z",
          signed_at: "2026-08-31T11:00:00Z",
        },
      ],
    };

    const mockClient = createMockSupabase({ jobData, quoteData });
    vi.mocked(createClient).mockResolvedValue(mockClient);

    const mod = await import("@/app/jobs/[id]/page");
    const Page = mod.default;

    const { container } = render(
      await Page({
        params: Promise.resolve({ id: "job-1" }),
        searchParams: Promise.resolve({}),
      }),
    );

    const receiptText = container.textContent ?? "";

    // Must show all three lines
    expect(receiptText).toContain("Customer paid");
    expect(receiptText).toContain("£500.00");
    expect(receiptText).toContain("Motko payment fee");
    expect(receiptText).toContain("£9.90");
    expect(receiptText).toContain("taken at payment");
    expect(receiptText).toContain("You receive");
    expect(receiptText).toContain("£490.10");
  });

  it("shows waived fee with remaining free jobs count", async () => {
    const { createClient } = await import("@/lib/supabase/server");

    const jobData = {
      id: "job-2",
      status: "quoted",
      fee_amount_pennies: 0,
      fee_status: "not_applicable",
      fee_waived_reason: "free_allowance",
      work_completed_at: "2026-09-01T10:00:00Z",
      customer: { name: "Bob Jones", contact: null },
      contractor: { vat_registered: false, free_jobs_remaining: 3, business_profile: null },
    };

    const quoteData = {
      id: "quote-2",
      line_items_json: [{ category: "labour", quantity: 5, unit_price: 10000, multiplier: 1 }],
      total: 50000,
      status: "accepted",
      sent_at: "2026-08-30T10:00:00Z",
      accepted_at: "2026-08-31T10:00:00Z",
      invoices: [
        {
          id: "invoice-2",
          amount: 50000,
          status: "paid",
          invoice_type: "final",
          paid_at: "2026-09-01T10:00:00Z",
          created_at: "2026-08-31T12:00:00Z",
        },
      ],
      contracts: [
        {
          id: "contract-2",
          status: "signed",
          sent_at: "2026-08-31T10:00:00Z",
          signed_at: "2026-08-31T11:00:00Z",
        },
      ],
    };

    const mockClient = createMockSupabase({ jobData, quoteData });
    vi.mocked(createClient).mockResolvedValue(mockClient);

    const mod = await import("@/app/jobs/[id]/page");
    const Page = mod.default;

    const { container } = render(
      await Page({
        params: Promise.resolve({ id: "job-2" }),
        searchParams: Promise.resolve({}),
      }),
    );

    const receiptText = container.textContent ?? "";

    expect(receiptText).toContain("Customer paid");
    expect(receiptText).toContain("£500.00");
    expect(receiptText).toContain("Waived");
    expect(receiptText).toContain("3 free jobs left");
    expect(receiptText).toContain("You receive");
    expect(receiptText).toContain("£500.00"); // full amount when waived
  });

  it("shows zero fee with early access message while CLEAN-6 holds", async () => {
    const { createClient } = await import("@/lib/supabase/server");

    const jobData = {
      id: "job-3",
      status: "quoted",
      fee_amount_pennies: 0,
      fee_status: "collected", // not 'not_applicable', so this is CLEAN-6 zero not a waiver
      fee_waived_reason: null,
      work_completed_at: "2026-09-01T10:00:00Z",
      customer: { name: "Carol White", contact: { phone: "07700900000" } },
      contractor: { vat_registered: true, free_jobs_remaining: 0, business_profile: null },
    };

    const quoteData = {
      id: "quote-3",
      line_items_json: [{ category: "materials", quantity: 1, unit_price: 120000, multiplier: 1 }],
      total: 120000,
      status: "accepted",
      sent_at: "2026-08-30T10:00:00Z",
      accepted_at: "2026-08-31T10:00:00Z",
      invoices: [
        {
          id: "invoice-3",
          amount: 120000,
          status: "paid",
          invoice_type: "final",
          paid_at: "2026-09-01T10:00:00Z",
          created_at: "2026-08-31T12:00:00Z",
        },
      ],
      contracts: [
        {
          id: "contract-3",
          status: "signed",
          sent_at: "2026-08-31T10:00:00Z",
          signed_at: "2026-08-31T11:00:00Z",
        },
      ],
    };

    const mockClient = createMockSupabase({ jobData, quoteData });
    vi.mocked(createClient).mockResolvedValue(mockClient);

    const mod = await import("@/app/jobs/[id]/page");
    const Page = mod.default;

    const { container } = render(
      await Page({
        params: Promise.resolve({ id: "job-3" }),
        searchParams: Promise.resolve({}),
      }),
    );

    const receiptText = container.textContent ?? "";

    expect(receiptText).toContain("Customer paid");
    expect(receiptText).toContain("£1,200.00");
    expect(receiptText).toContain("£0.00");
    expect(receiptText).toContain("no fee while in early access");
    expect(receiptText).toContain("You receive");
    expect(receiptText).toContain("£1,200.00");
  });

  it("shows accrued fee as recorded not charged", async () => {
    const { createClient } = await import("@/lib/supabase/server");

    const jobData = {
      id: "job-4",
      status: "quoted",
      fee_amount_pennies: 400,
      fee_status: "accrued",
      fee_waived_reason: null,
      work_completed_at: "2026-09-01T10:00:00Z",
      customer: { name: "Dave Brown", contact: { email: "dave@example.com" } },
      contractor: { vat_registered: false, free_jobs_remaining: 0, business_profile: null },
    };

    const quoteData = {
      id: "quote-4",
      line_items_json: [{ category: "labour", quantity: 8, unit_price: 7500, multiplier: 1 }],
      total: 60000,
      status: "accepted",
      sent_at: "2026-08-30T10:00:00Z",
      accepted_at: "2026-08-31T10:00:00Z",
      invoices: [
        {
          id: "invoice-4",
          amount: 60000,
          status: "paid",
          invoice_type: "final",
          paid_at: "2026-09-01T10:00:00Z",
          created_at: "2026-08-31T12:00:00Z",
        },
      ],
      contracts: [
        {
          id: "contract-4",
          status: "signed",
          sent_at: "2026-08-31T10:00:00Z",
          signed_at: "2026-08-31T11:00:00Z",
        },
      ],
    };

    const mockClient = createMockSupabase({ jobData, quoteData });
    vi.mocked(createClient).mockResolvedValue(mockClient);

    const mod = await import("@/app/jobs/[id]/page");
    const Page = mod.default;

    const { container } = render(
      await Page({
        params: Promise.resolve({ id: "job-4" }),
        searchParams: Promise.resolve({}),
      }),
    );

    const receiptText = container.textContent ?? "";

    expect(receiptText).toContain("Customer paid");
    expect(receiptText).toContain("£600.00");
    expect(receiptText).toContain("£4.00");
    expect(receiptText).toContain("recorded, not charged");
    expect(receiptText).toContain("You receive");
    expect(receiptText).toContain("£600.00"); // full amount when accrued
  });

  it("handles legacy jobs with missing fee columns", async () => {
    const { createClient } = await import("@/lib/supabase/server");

    const jobData = {
      id: "job-5",
      status: "quoted",
      fee_amount_pennies: null,
      fee_status: null,
      fee_waived_reason: null,
      work_completed_at: "2026-09-01T10:00:00Z",
      customer: { name: "Eve Green", contact: null },
      contractor: { vat_registered: false, free_jobs_remaining: 0, business_profile: null },
    };

    const quoteData = {
      id: "quote-5",
      line_items_json: [{ category: "labour", quantity: 3, unit_price: 15000, multiplier: 1 }],
      total: 45000,
      status: "accepted",
      sent_at: "2026-08-30T10:00:00Z",
      accepted_at: "2026-08-31T10:00:00Z",
      invoices: [
        {
          id: "invoice-5",
          amount: 45000,
          status: "paid",
          invoice_type: "final",
          paid_at: "2026-09-01T10:00:00Z",
          created_at: "2026-08-31T12:00:00Z",
        },
      ],
      contracts: [
        {
          id: "contract-5",
          status: "signed",
          sent_at: "2026-08-31T10:00:00Z",
          signed_at: "2026-08-31T11:00:00Z",
        },
      ],
    };

    const mockClient = createMockSupabase({ jobData, quoteData });
    vi.mocked(createClient).mockResolvedValue(mockClient);

    const mod = await import("@/app/jobs/[id]/page");
    const Page = mod.default;

    const { container } = render(
      await Page({
        params: Promise.resolve({ id: "job-5" }),
        searchParams: Promise.resolve({}),
      }),
    );

    const receiptText = container.textContent ?? "";

    expect(receiptText).toContain("Customer paid");
    expect(receiptText).toContain("£450.00");
    expect(receiptText).toContain("£0.00");
    expect(receiptText).toContain("not recorded");
    expect(receiptText).toContain("You receive");
    expect(receiptText).toContain("£450.00");
  });

  it("reconciles customer paid minus fee to you receive exactly", async () => {
    const { createClient } = await import("@/lib/supabase/server");

    const jobData = {
      id: "job-6",
      status: "quoted",
      fee_amount_pennies: 234, // £2.34
      fee_status: "collected",
      fee_waived_reason: null,
      work_completed_at: "2026-09-01T10:00:00Z",
      customer: { name: "Frank Lee", contact: { email: "frank@example.com", phone: "07700900111" } },
      contractor: { vat_registered: false, free_jobs_remaining: 0, business_profile: null },
    };

    const quoteData = {
      id: "quote-6",
      line_items_json: [{ category: "labour", quantity: 2, unit_price: 8500, multiplier: 1 }],
      total: 17000, // £170.00
      status: "accepted",
      sent_at: "2026-08-30T10:00:00Z",
      accepted_at: "2026-08-31T10:00:00Z",
      invoices: [
        {
          id: "invoice-6",
          amount: 17000,
          status: "paid",
          invoice_type: "final",
          paid_at: "2026-09-01T10:00:00Z",
          created_at: "2026-08-31T12:00:00Z",
        },
      ],
      contracts: [
        {
          id: "contract-6",
          status: "signed",
          sent_at: "2026-08-31T10:00:00Z",
          signed_at: "2026-08-31T11:00:00Z",
        },
      ],
    };

    const mockClient = createMockSupabase({ jobData, quoteData });
    vi.mocked(createClient).mockResolvedValue(mockClient);

    const mod = await import("@/app/jobs/[id]/page");
    const Page = mod.default;

    const { container } = render(
      await Page({
        params: Promise.resolve({ id: "job-6" }),
        searchParams: Promise.resolve({}),
      }),
    );

    const receiptText = container.textContent ?? "";

    // Customer paid: £170.00
    expect(receiptText).toContain("£170.00");
    // Fee: £2.34
    expect(receiptText).toContain("£2.34");
    // You receive: £170.00 - £2.34 = £167.66
    expect(receiptText).toContain("£167.66");

    // Verify the arithmetic is stated correctly
    const customerPaid = 170.0;
    const fee = 2.34;
    const youReceive = 167.66;
    expect(Math.abs(customerPaid - fee - youReceive)).toBeLessThan(0.01); // pennies
  });

  it("uses distinct labelling to avoid confusion with subscription", async () => {
    const { createClient } = await import("@/lib/supabase/server");

    const jobData = {
      id: "job-7",
      status: "quoted",
      fee_amount_pennies: 990, // £9.90 - the capped payment fee
      fee_status: "collected",
      fee_waived_reason: null,
      work_completed_at: "2026-09-01T10:00:00Z",
      customer: { name: "Grace Hall", contact: { email: "grace@example.com" } },
      contractor: { vat_registered: false, free_jobs_remaining: 0, business_profile: null },
    };

    const quoteData = {
      id: "quote-7",
      line_items_json: [{ category: "labour", quantity: 100, unit_price: 10000, multiplier: 1 }],
      total: 1000000, // £10,000 - enough to hit the cap
      status: "accepted",
      sent_at: "2026-08-30T10:00:00Z",
      accepted_at: "2026-08-31T10:00:00Z",
      invoices: [
        {
          id: "invoice-7",
          amount: 1000000,
          status: "paid",
          invoice_type: "final",
          paid_at: "2026-09-01T10:00:00Z",
          created_at: "2026-08-31T12:00:00Z",
        },
      ],
      contracts: [
        {
          id: "contract-7",
          status: "signed",
          sent_at: "2026-08-31T10:00:00Z",
          signed_at: "2026-08-31T11:00:00Z",
        },
      ],
    };

    const mockClient = createMockSupabase({ jobData, quoteData });
    vi.mocked(createClient).mockResolvedValue(mockClient);

    const mod = await import("@/app/jobs/[id]/page");
    const Page = mod.default;

    const { container } = render(
      await Page({
        params: Promise.resolve({ id: "job-7" }),
        searchParams: Promise.resolve({}),
      }),
    );

    const receiptText = container.textContent ?? "";

    // Must use "payment fee" or "transaction fee", never just "Motko fee" or "service fee"
    // to distinguish from the £9.99 monthly subscription
    const hasPaymentFeeLabel =
      receiptText.includes("payment fee") || receiptText.includes("transaction fee");
    expect(
      hasPaymentFeeLabel,
      "Fee must be labelled as 'payment fee' or 'transaction fee' to distinguish from subscription",
    ).toBe(true);

    // Must not use ambiguous labels that could be confused with subscription
    expect(receiptText).not.toContain("Service fee");
    expect(receiptText).not.toMatch(/Motko fee(?! payment| transaction)/); // "Motko fee" without qualifier

    // The £9.90 amount must be visible
    expect(receiptText).toContain("£9.90");
  });
});
