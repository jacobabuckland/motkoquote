/**
 * @vitest-environment happy-dom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const h = vi.hoisted(() => {
  const state = {
    jobData: null as Record<string, unknown> | null,
    quoteData: null as Record<string, unknown> | null,
    stagesData: null as unknown[] | null,
  };

  const client = {
    auth: {
      getUser: async () => ({ data: { user: { id: "user_1" } }, error: null }),
    },
    from: (table: string) => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        sort: () => builder,
        maybeSingle: async () => {
          if (table === "jobs") {
            return { data: state.jobData, error: null };
          }
          if (table === "quotes") {
            return { data: state.quoteData, error: null };
          }
          if (table === "payment_stages") {
            return { data: state.stagesData, error: null };
          }
          return { data: null, error: null };
        },
      };
      return builder;
    },
  };

  return { state, client };
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => h.client,
}));

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("notFound");
  }),
  useRouter: vi.fn(() => ({
    push: vi.fn(),
    refresh: vi.fn(),
  })),
  useSearchParams: vi.fn(() => ({
    get: () => null,
  })),
  usePathname: vi.fn(() => "/jobs/job_1"),
}));

vi.mock("@/app/jobs/[id]/cost-actions", () => ({
  getJobCosts: async () => ({ ok: true, data: [] }),
}));

vi.mock("@/app/jobs/[id]/pnl-actions", () => ({
  getJobPnL: async () => null,
}));

afterEach(cleanup);

describe("JOB-3: The signed contract is reachable from the job it belongs to", () => {
  beforeEach(() => {
    h.state.jobData = {
      id: "job_1",
      created_at: "2026-09-01T10:00:00Z",
      status: "drafted",
      contractor: {
        vat_registered: true,
        free_jobs_remaining: 3,
        business_profile: null,
      },
      customer: { name: "Test Customer", contact: { email: "test@example.com" } },
      extracted_json: null,
      sow_json: null,
      transcript: null,
      fee_amount_pennies: null,
      fee_status: null,
      fee_waived_reason: null,
      work_completed_at: null,
      settlement_state: null,
      payment_provider_ref: null,
    };
    h.state.stagesData = [];
  });

  it("shows Copy contract link and Download contract when contract is sent", async () => {
    const mod = await import("@/app/jobs/[id]/page");
    const PageComponent = mod.default;

    h.state.quoteData = {
      id: "quote_1",
      line_items_json: [],
      contractor_flags_json: null,
      total: 1000,
      subtotal: null,
      vat_amount: null,
      deposit_pennies: null,
      sent_total: null,
      status: "accepted",
      sent_at: "2026-09-10T10:00:00Z",
      viewed_at: "2026-09-10T11:00:00Z",
      accepted_at: "2026-09-10T12:00:00Z",
      declined_at: null,
      created_at: "2026-09-01T10:00:00Z",
      contracts: {
        id: "contract_1",
        status: "sent",
        sent_at: "2026-09-11T10:00:00Z",
        signed_at: null,
        deposit_pct: null,
      },
      invoices: [],
    };

    render(
      await PageComponent({
        params: Promise.resolve({ id: "job_1" }),
        searchParams: Promise.resolve({}),
      }),
    );

    // Should show Copy contract link
    const copyButton = screen.getByRole("button", { name: /copy contract link/i });
    expect(copyButton).toBeDefined();

    // Should show Download contract link
    const downloadLink = screen.getByRole("link", { name: /download contract/i });
    expect(downloadLink).toBeDefined();
    expect(downloadLink.getAttribute("href")).toBe("/api/contracts/contract_1/pdf");
  });

  it("shows Copy contract link and Download contract when contract is signed", async () => {
    const mod = await import("@/app/jobs/[id]/page");
    const PageComponent = mod.default;

    h.state.quoteData = {
      id: "quote_1",
      line_items_json: [],
      contractor_flags_json: null,
      total: 1000,
      subtotal: null,
      vat_amount: null,
      deposit_pennies: null,
      sent_total: null,
      status: "accepted",
      sent_at: "2026-09-10T10:00:00Z",
      viewed_at: "2026-09-10T11:00:00Z",
      accepted_at: "2026-09-10T12:00:00Z",
      declined_at: null,
      created_at: "2026-09-01T10:00:00Z",
      contracts: {
        id: "contract_1",
        status: "signed",
        sent_at: "2026-09-11T10:00:00Z",
        signed_at: "2026-09-14T10:00:00Z",
        deposit_pct: null,
      },
      invoices: [],
    };

    render(
      await PageComponent({
        params: Promise.resolve({ id: "job_1" }),
        searchParams: Promise.resolve({}),
      }),
    );

    // Should show Copy contract link for signed contract
    const copyButton = screen.getByRole("button", { name: /copy contract link/i });
    expect(copyButton).toBeDefined();

    // Should show Download contract for signed contract
    const downloadLink = screen.getByRole("link", { name: /download contract/i });
    expect(downloadLink).toBeDefined();
    expect(downloadLink.getAttribute("href")).toBe("/api/contracts/contract_1/pdf");
  });

  it("shows Copy contract link and Download contract when contract is declined", async () => {
    const mod = await import("@/app/jobs/[id]/page");
    const PageComponent = mod.default;

    h.state.quoteData = {
      id: "quote_1",
      line_items_json: [],
      contractor_flags_json: null,
      total: 1000,
      subtotal: null,
      vat_amount: null,
      deposit_pennies: null,
      sent_total: null,
      status: "accepted",
      sent_at: "2026-09-10T10:00:00Z",
      viewed_at: "2026-09-10T11:00:00Z",
      accepted_at: "2026-09-10T12:00:00Z",
      declined_at: null,
      created_at: "2026-09-01T10:00:00Z",
      contracts: {
        id: "contract_1",
        status: "declined",
        sent_at: "2026-09-11T10:00:00Z",
        signed_at: null,
        deposit_pct: null,
      },
      invoices: [],
    };

    render(
      await PageComponent({
        params: Promise.resolve({ id: "job_1" }),
        searchParams: Promise.resolve({}),
      }),
    );

    // Should show Copy contract link for declined contract
    const copyButton = screen.getByRole("button", { name: /copy contract link/i });
    expect(copyButton).toBeDefined();

    // Should show Download contract for declined contract
    const downloadLink = screen.getByRole("link", { name: /download contract/i });
    expect(downloadLink).toBeDefined();
    expect(downloadLink.getAttribute("href")).toBe("/api/contracts/contract_1/pdf");
  });

  it("does not show contract links when no contract exists", async () => {
    const mod = await import("@/app/jobs/[id]/page");
    const PageComponent = mod.default;

    h.state.quoteData = {
      id: "quote_1",
      line_items_json: [],
      contractor_flags_json: null,
      total: 1000,
      subtotal: null,
      vat_amount: null,
      deposit_pennies: null,
      sent_total: null,
      status: "accepted",
      sent_at: "2026-09-10T10:00:00Z",
      viewed_at: "2026-09-10T11:00:00Z",
      accepted_at: "2026-09-10T12:00:00Z",
      declined_at: null,
      created_at: "2026-09-01T10:00:00Z",
      contracts: null,
      invoices: [],
    };

    render(
      await PageComponent({
        params: Promise.resolve({ id: "job_1" }),
        searchParams: Promise.resolve({}),
      }),
    );

    // Should NOT show Copy contract link
    const copyButton = screen.queryByRole("button", { name: /copy contract link/i });
    expect(copyButton).toBeNull();

    // Should NOT show Download contract
    const downloadLink = screen.queryByRole("link", { name: /download contract/i });
    expect(downloadLink).toBeNull();
  });

  it("contract links appear after primary actions in signed_need_invoice state", async () => {
    const mod = await import("@/app/jobs/[id]/page");
    const PageComponent = mod.default;

    h.state.quoteData = {
      id: "quote_1",
      line_items_json: [],
      contractor_flags_json: null,
      total: 1000,
      subtotal: null,
      vat_amount: null,
      deposit_pennies: null,
      sent_total: null,
      status: "accepted",
      sent_at: "2026-09-10T10:00:00Z",
      viewed_at: "2026-09-10T11:00:00Z",
      accepted_at: "2026-09-10T12:00:00Z",
      declined_at: null,
      created_at: "2026-09-01T10:00:00Z",
      contracts: {
        id: "contract_1",
        status: "signed",
        sent_at: "2026-09-11T10:00:00Z",
        signed_at: "2026-09-14T10:00:00Z",
        deposit_pct: null,
      },
      invoices: [],
    };

    render(
      await PageComponent({
        params: Promise.resolve({ id: "job_1" }),
        searchParams: Promise.resolve({}),
      }),
    );

    // Should have primary actions
    const markCompleteButton = screen.getByRole("button", { name: /mark complete/i });
    expect(markCompleteButton).toBeDefined();

    // Should have contract links after primary actions
    const copyButton = screen.getByRole("button", { name: /copy contract link/i });
    expect(copyButton).toBeDefined();

    const downloadLink = screen.getByRole("link", { name: /download contract/i });
    expect(downloadLink).toBeDefined();

    // Verify order: Mark Complete should appear before contract links in DOM
    const allElements = Array.from(document.querySelectorAll("button, a"));
    const markCompleteIndex = allElements.indexOf(markCompleteButton);
    const copyIndex = allElements.indexOf(copyButton);
    const downloadIndex = allElements.indexOf(downloadLink);

    expect(markCompleteIndex).toBeGreaterThan(-1);
    expect(copyIndex).toBeGreaterThan(markCompleteIndex);
    expect(downloadIndex).toBeGreaterThan(markCompleteIndex);
  });

  it("constructs correct contract URLs", async () => {
    const mod = await import("@/app/jobs/[id]/page");
    const PageComponent = mod.default;

    h.state.quoteData = {
      id: "quote_1",
      line_items_json: [],
      contractor_flags_json: null,
      total: 1000,
      subtotal: null,
      vat_amount: null,
      deposit_pennies: null,
      sent_total: null,
      status: "accepted",
      sent_at: "2026-09-10T10:00:00Z",
      viewed_at: "2026-09-10T11:00:00Z",
      accepted_at: "2026-09-10T12:00:00Z",
      declined_at: null,
      created_at: "2026-09-01T10:00:00Z",
      contracts: {
        id: "contract_ABC123",
        status: "signed",
        sent_at: "2026-09-11T10:00:00Z",
        signed_at: "2026-09-14T10:00:00Z",
        deposit_pct: null,
      },
      invoices: [],
    };

    render(
      await PageComponent({
        params: Promise.resolve({ id: "job_1" }),
        searchParams: Promise.resolve({}),
      }),
    );

    // Copy button should copy the contract page URL
    const copyButton = screen.getByRole("button", { name: /copy contract link/i });
    expect(copyButton).toBeDefined();
    // The ShareLinkButton component will handle copying the contract URL

    // Download link should point to PDF API route
    const downloadLink = screen.getByRole("link", { name: /download contract/i });
    expect(downloadLink.getAttribute("href")).toBe("/api/contracts/contract_ABC123/pdf");
    expect(downloadLink.getAttribute("target")).toBe("_blank");
  });
});
