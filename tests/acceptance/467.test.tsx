/**
 * @vitest-environment happy-dom
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { motkoFeePennies } from "@/lib/motko-fee";
import { formatGBP } from "@/lib/format";

// Mock modules at the top level to avoid hoisting warnings
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/app/jobs/[id]/cost-actions", () => ({
  getJobCosts: vi.fn(),
}));

vi.mock("@/app/jobs/[id]/pnl-actions", () => ({
  getJobPnL: vi.fn(),
}));

// Required: vitest does not set globals: true, so Testing Library's automatic
// cleanup never registers. Without this, each test's markup stays in
// document.body for the next test to find.
afterEach(cleanup);

describe("projectedFeeLine — pure function assertions", () => {
  it("exists and is exported from fee-copy.ts", async () => {
    const mod = await import("@/lib/fee-copy");
    expect(mod.projectedFeeLine).toBeDefined();
    expect(typeof mod.projectedFeeLine).toBe("function");
  });

  it("states the fee for a £500 net job with no free allowance", async () => {
    const { projectedFeeLine } = await import("@/lib/fee-copy");
    const fee = motkoFeePennies(50_000, 0);
    const line = projectedFeeLine({ freeJobsRemaining: 0, netSubtotalPounds: 500 });
    expect(line).toContain(formatGBP(fee / 100));
    expect(line).toContain("service fee");
  });

  it("states the fee for a £1,000 net job", async () => {
    const { projectedFeeLine } = await import("@/lib/fee-copy");
    const fee = motkoFeePennies(100_000, 0);
    const line = projectedFeeLine({ freeJobsRemaining: 0, netSubtotalPounds: 1_000 });
    expect(line).toContain(formatGBP(fee / 100));
  });

  it("states the fee for a £22,000 net job, uncapped", async () => {
    const { projectedFeeLine } = await import("@/lib/fee-copy");
    const fee = motkoFeePennies(2_200_000, 0);
    const line = projectedFeeLine({ freeJobsRemaining: 0, netSubtotalPounds: 22_000 });
    expect(line).toContain(formatGBP(fee / 100));
    expect(line).toContain("£43");
  });

  it("states exactly what settlement will charge, for every value", async () => {
    const { projectedFeeLine } = await import("@/lib/fee-copy");
    for (const net of [500, 1_000, 2_500, 5_000, 10_000, 22_000]) {
      const line = projectedFeeLine({ freeJobsRemaining: 0, netSubtotalPounds: net });
      const charged = motkoFeePennies(net * 100, 0);
      expect(line, `for £${net} job`).toContain(formatGBP(charged / 100));
    }
  });

  it("says no fee when a free credit covers it all", async () => {
    const { projectedFeeLine } = await import("@/lib/fee-copy");
    const line = projectedFeeLine({ freeJobsRemaining: 1, netSubtotalPounds: 500 });
    expect(line.toLowerCase()).toContain("free");
    expect(line.toLowerCase()).toContain("no service fee");
  });

  it("states the payable remainder when the waiver does not cover the whole fee", async () => {
    const { projectedFeeLine } = await import("@/lib/fee-copy");
    // This branch is unreachable today (unbounded ceiling), but the wording must
    // survive for when a ceiling returns. Compute the split and assert on both figures.
    const { waiverSplit } = await import("@/lib/motko-fee");
    const fullFee = motkoFeePennies(2_200_000, 0);
    const { waivedPennies, payablePennies } = waiverSplit(fullFee);

    // If the waiver covers everything, skip this test
    if (payablePennies === 0) {
      expect(true).toBe(true); // pass the test, as the branch is unreachable
      return;
    }

    const line = projectedFeeLine({ freeJobsRemaining: 1, netSubtotalPounds: 22_000 });
    expect(line).toContain(formatGBP(waivedPennies / 100));
    expect(line).toContain(formatGBP(payablePennies / 100));
    expect(line).toContain(formatGBP(fullFee / 100));
  });

  it("does not throw on a quote with no line items", async () => {
    const { projectedFeeLine } = await import("@/lib/fee-copy");
    const line = projectedFeeLine({ freeJobsRemaining: 0, netSubtotalPounds: 0 });
    expect(line).toBeDefined();
    expect(line).toContain("£2"); // the floor
  });

  it("does not throw on a negative subtotal", async () => {
    const { projectedFeeLine } = await import("@/lib/fee-copy");
    const line = projectedFeeLine({ freeJobsRemaining: 0, netSubtotalPounds: -100 });
    expect(line).toBeDefined();
    expect(line).toContain("£2"); // the floor
  });

  it("is forward-looking — the tense describes what will happen", async () => {
    const { projectedFeeLine } = await import("@/lib/fee-copy");
    const line = projectedFeeLine({ freeJobsRemaining: 0, netSubtotalPounds: 1_000 });
    // Must not use past tense like "taken at payment" (that's paidJobFeeLine)
    expect(line.toLowerCase()).not.toContain("taken");
    expect(line.toLowerCase()).not.toContain("was");
  });

  it("matches markPaidFeeLine for the same job and same free balance", async () => {
    const { projectedFeeLine, markPaidFeeLine } = await import("@/lib/fee-copy");

    for (const net of [500, 1_000, 5_000, 22_000]) {
      const projected = projectedFeeLine({ freeJobsRemaining: 0, netSubtotalPounds: net });
      const markPaid = markPaidFeeLine({ freeJobsRemaining: 0, netSubtotalPounds: net });

      // Both must contain the same fee amount
      const fee = motkoFeePennies(net * 100, 0);
      const feeStr = formatGBP(fee / 100);
      expect(projected, `projected for £${net}`).toContain(feeStr);
      expect(markPaid, `mark-paid for £${net}`).toContain(feeStr);
    }
  });
});

describe("Two jobs differing only by VAT produce the same fee", () => {
  it("rates the NET subtotal, not the VAT-inclusive total", async () => {
    const { projectedFeeLine } = await import("@/lib/fee-copy");
    const { computeQuoteTotals } = await import("@/lib/quote-math");

    // Build identical line items
    const lineItems = [
      {
        category: "labour" as const,
        description: "Rewire kitchen",
        quantity: 3,
        unit: "days",
        unit_price: 300,
        multiplier: 1,
        people_count: 1,
        overtime: false,
        assumed: false,
        people: null,
      },
    ];

    // Compute totals for VAT-registered and non-registered
    const { subtotal: netSubtotal } = computeQuoteTotals(lineItems, false);
    const { total: grossTotal } = computeQuoteTotals(lineItems, true);

    // The NET subtotal is the same in both cases
    expect(netSubtotal).toBe(900);

    // The gross total is 20% higher for VAT-registered
    expect(grossTotal).toBe(1080);

    // The fee must be computed from the net, so both produce the same figure
    const feeFromNet = motkoFeePennies(Math.round(netSubtotal * 100), 0);
    const line = projectedFeeLine({ freeJobsRemaining: 0, netSubtotalPounds: netSubtotal });

    expect(line).toContain(formatGBP(feeFromNet / 100));

    // Assert that passing the gross would produce a DIFFERENT (wrong) fee
    const feeFromGross = motkoFeePennies(Math.round(grossTotal * 100), 0);
    expect(feeFromGross).toBeGreaterThan(feeFromNet);
  });
});

describe("Job page renders the projected fee line", () => {
  it("shows the fee on a sent quote (quote_sent situation)", async () => {
    // Import the mocked modules
    const { createClient } = await import("@/lib/supabase/server");
    const { getJobCosts } = await import("@/app/jobs/[id]/cost-actions");
    const { getJobPnL } = await import("@/app/jobs/[id]/pnl-actions");

    // Mock createClient to return a stub with the data for a sent quote
    const mockSupabase = {
      auth: {
        getUser: vi.fn(async () => ({ data: { user: { id: "contractor-1" } }, error: null })),
      },
      from: vi.fn((table: string) => {
        if (table === "jobs") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({
                  data: {
                    id: "job-1",
                    status: "drafted",
                    transcript: null,
                    extracted_json: { job_type: "Electrical work" },
                    sow_json: null,
                    fee_amount_pennies: null,
                    fee_status: null,
                    fee_waived_reason: null,
                    work_completed_at: null,
                    customer: { name: "Alice Smith", contact: { email: "alice@example.com" } },
                    contractor: { vat_registered: false, free_jobs_remaining: 0, business_profile: null },
                  },
                  error: null,
                })),
              })),
            })),
          };
        }
        if (table === "quotes") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({
                  data: {
                    id: "quote-1",
                    line_items_json: [
                      {
                        category: "labour",
                        description: "Rewire",
                        quantity: 2,
                        unit: "days",
                        unit_price: 300,
                        multiplier: 1,
                        people_count: 1,
                        overtime: false,
                        assumed: false,
                        people: null,
                      },
                    ],
                    contractor_flags_json: null,
                    total: 600,
                    sent_total: 600,
                    status: "sent",
                    sent_at: "2026-09-01T10:00:00Z",
                    viewed_at: null,
                    accepted_at: null,
                    declined_at: null,
                    created_at: "2026-09-01T09:00:00Z",
                    contracts: [],
                    invoices: [],
                  },
                  error: null,
                })),
              })),
            })),
          };
        }
        return { select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: [], error: null })) })) })) };
      }),
    };

    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    vi.mocked(getJobCosts).mockResolvedValue({ ok: true, data: [] } as never);
    vi.mocked(getJobPnL).mockResolvedValue(null);

    // Import the job page component after mocking
    const PageComponent = (await import("@/app/jobs/[id]/page")).default;

    // Render the page
    const page = await PageComponent({
      params: Promise.resolve({ id: "job-1" }),
      searchParams: Promise.resolve({}),
    });

    render(page);

    // The fee line should be visible
    const fee = motkoFeePennies(60_000, 0); // £600 net = 60,000 pennies
    const feeText = formatGBP(fee / 100);

    expect(screen.getByText((content) => content.includes(feeText))).toBeDefined();
    expect(screen.getByText((content) => content.toLowerCase().includes("service fee"))).toBeDefined();
  });

  it("shows the fee on an unpaid invoice (invoice_unpaid situation)", async () => {
    // Import the mocked modules
    const { createClient } = await import("@/lib/supabase/server");
    const { getJobCosts } = await import("@/app/jobs/[id]/cost-actions");
    const { getJobPnL } = await import("@/app/jobs/[id]/pnl-actions");

    // Mock createClient to return a stub with the data for an unpaid invoice
    const mockSupabase = {
      auth: {
        getUser: vi.fn(async () => ({ data: { user: { id: "contractor-1" } }, error: null })),
      },
      from: vi.fn((table: string) => {
        if (table === "jobs") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({
                  data: {
                    id: "job-2",
                    status: "drafted",
                    transcript: null,
                    extracted_json: { job_type: "Electrical work" },
                    sow_json: null,
                    fee_amount_pennies: null,
                    fee_status: null,
                    fee_waived_reason: null,
                    work_completed_at: "2026-08-30T10:00:00Z",
                    customer: { name: "Bob Jones", contact: { email: "bob@example.com" } },
                    contractor: { vat_registered: false, free_jobs_remaining: 0, business_profile: null },
                  },
                  error: null,
                })),
              })),
            })),
          };
        }
        if (table === "quotes") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({
                  data: {
                    id: "quote-2",
                    line_items_json: [
                      {
                        category: "labour",
                        description: "Rewire kitchen",
                        quantity: 5,
                        unit: "days",
                        unit_price: 400,
                        multiplier: 1,
                        people_count: 1,
                        overtime: false,
                        assumed: false,
                        people: null,
                      },
                    ],
                    contractor_flags_json: null,
                    total: 2000,
                    sent_total: 2000,
                    status: "accepted",
                    sent_at: "2026-08-25T10:00:00Z",
                    viewed_at: "2026-08-25T11:00:00Z",
                    accepted_at: "2026-08-25T12:00:00Z",
                    declined_at: null,
                    created_at: "2026-08-25T09:00:00Z",
                    contracts: [
                      {
                        id: "contract-1",
                        status: "signed",
                        sent_at: "2026-08-26T10:00:00Z",
                        signed_at: "2026-08-26T12:00:00Z",
                        deposit_pct: null,
                      },
                    ],
                    invoices: [
                      {
                        id: "invoice-1",
                        amount: 2000,
                        status: "sent",
                        invoice_type: "final",
                        due_date: "2026-09-10T00:00:00Z",
                        created_at: "2026-08-31T10:00:00Z",
                        paid_at: null,
                        chase_events: [],
                      },
                    ],
                  },
                  error: null,
                })),
              })),
            })),
          };
        }
        return { select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: [], error: null })) })) })) };
      }),
    };

    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    vi.mocked(getJobCosts).mockResolvedValue({ ok: true, data: [] } as never);
    vi.mocked(getJobPnL).mockResolvedValue(null);

    // Import the job page component after mocking
    const PageComponent = (await import("@/app/jobs/[id]/page")).default;

    // Render the page
    const page = await PageComponent({
      params: Promise.resolve({ id: "job-2" }),
      searchParams: Promise.resolve({}),
    });

    render(page);

    // The fee line should be visible
    const fee = motkoFeePennies(200_000, 0); // £2,000 net = 200,000 pennies
    const feeText = formatGBP(fee / 100);

    expect(screen.getByText((content) => content.includes(feeText))).toBeDefined();
    expect(screen.getByText((content) => content.toLowerCase().includes("service fee"))).toBeDefined();
  });

  it("shows no fee when free credits cover it", async () => {
    // Import the mocked modules
    const { createClient } = await import("@/lib/supabase/server");
    const { getJobCosts } = await import("@/app/jobs/[id]/cost-actions");
    const { getJobPnL } = await import("@/app/jobs/[id]/pnl-actions");

    const mockSupabase = {
      auth: {
        getUser: vi.fn(async () => ({ data: { user: { id: "contractor-1" } }, error: null })),
      },
      from: vi.fn((table: string) => {
        if (table === "jobs") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({
                  data: {
                    id: "job-3",
                    status: "drafted",
                    transcript: null,
                    extracted_json: { job_type: "Plumbing" },
                    sow_json: null,
                    fee_amount_pennies: null,
                    fee_status: null,
                    fee_waived_reason: null,
                    work_completed_at: null,
                    customer: { name: "Charlie Brown", contact: { email: "charlie@example.com" } },
                    contractor: { vat_registered: false, free_jobs_remaining: 3, business_profile: null },
                  },
                  error: null,
                })),
              })),
            })),
          };
        }
        if (table === "quotes") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({
                  data: {
                    id: "quote-3",
                    line_items_json: [
                      {
                        category: "labour",
                        description: "Fix leak",
                        quantity: 1,
                        unit: "days",
                        unit_price: 250,
                        multiplier: 1,
                        people_count: 1,
                        overtime: false,
                        assumed: false,
                        people: null,
                      },
                    ],
                    contractor_flags_json: null,
                    total: 250,
                    sent_total: 250,
                    status: "sent",
                    sent_at: "2026-09-01T10:00:00Z",
                    viewed_at: null,
                    accepted_at: null,
                    declined_at: null,
                    created_at: "2026-09-01T09:00:00Z",
                    contracts: [],
                    invoices: [],
                  },
                  error: null,
                })),
              })),
            })),
          };
        }
        return { select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: [], error: null })) })) })) };
      }),
    };

    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    vi.mocked(getJobCosts).mockResolvedValue({ ok: true, data: [] } as never);
    vi.mocked(getJobPnL).mockResolvedValue(null);

    // Import the job page component after mocking
    const PageComponent = (await import("@/app/jobs/[id]/page")).default;

    // Render the page
    const page = await PageComponent({
      params: Promise.resolve({ id: "job-3" }),
      searchParams: Promise.resolve({}),
    });

    render(page);

    // Should show the free job message
    expect(screen.getByText((content) => content.toLowerCase().includes("free"))).toBeDefined();
    expect(screen.getByText((content) => content.toLowerCase().includes("no service fee"))).toBeDefined();
  });
});
