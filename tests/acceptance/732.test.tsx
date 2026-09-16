/**
 * @vitest-environment happy-dom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, screen, within } from "@testing-library/react";
import type { LineItem } from "@/lib/schemas/job";

const JOB_ID = "11111111-1111-4111-8111-111111111111";
const QUOTE_ID = "22222222-2222-4222-8222-222222222222";

const lineItems: LineItem[] = [
  {
    description: "Rewire 5 sockets",
    category: "labour",
    quantity: 5,
    unit: "socket",
    unit_price: 50,
    multiplier: 1,
    people_count: 1,
    overtime: false,
    assumed: false,
  },
];

type QuoteRow = {
  id: string;
  line_items_json: unknown;
  contractor_flags_json: string[] | null;
  total: number;
  sent_total: number | null;
  status: string;
  sent_at: string | null;
  viewed_at: string | null;
  accepted_at: string | null;
  declined_at: string | null;
  created_at: string;
  contracts: null;
  invoices: never[];
};

const h = vi.hoisted(() => {
  const state = {
    quoteStatus: "draft" as string,
  };

  const buildQuoteRow = (): QuoteRow => ({
    id: QUOTE_ID,
    line_items_json: lineItems,
    contractor_flags_json: null,
    total: 250,
    sent_total: null,
    status: state.quoteStatus,
    sent_at: null,
    viewed_at: null,
    accepted_at: state.quoteStatus === "accepted" ? "2026-09-01T10:00:00Z" : null,
    declined_at: state.quoteStatus === "declined" ? "2026-09-01T10:00:00Z" : null,
    created_at: "2026-09-01T09:00:00Z",
    contracts: null,
    invoices: [],
  });

  const client = {
    auth: {
      getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }),
    },
    from: (table: string) => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        single: async () => {
          if (table === "contractors") {
            return {
              data: { id: "contractor-1" },
              error: null,
            };
          }
          if (table === "costs") {
            return { data: [], error: null };
          }
          return { data: null, error: null };
        },
        maybeSingle: async () => {
          if (table === "jobs") {
            return {
              data: {
                id: JOB_ID,
                created_at: "2026-09-01T09:00:00Z",
                transcript: "Customer wants 5 sockets rewired",
                extracted_json: { job_type: "Electrical work" },
                sow_json: null,
                status: "drafted",
                fee_amount_pennies: null,
                fee_status: null,
                fee_waived_reason: null,
                work_completed_at: null,
                settlement_state: null,
                payment_provider_ref: null,
                customer: {
                  name: "Test Customer",
                  contact: null,
                },
                contractor: {
                  vat_registered: false,
                  free_jobs_remaining: 3,
                  business_profile: null,
                },
              },
              error: null,
            };
          }
          if (table === "quotes") {
            return { data: buildQuoteRow(), error: null };
          }
          if (table === "payment_stages") {
            return { data: null, error: null };
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
  usePathname: vi.fn(() => `/jobs/${JOB_ID}`),
  useSearchParams: vi.fn(() => ({
    get: () => null,
  })),
}));

vi.mock("@/app/jobs/[id]/cost-actions", () => ({
  getJobCosts: async () => ({ ok: true, data: [] }),
}));

vi.mock("@/app/jobs/[id]/pnl-actions", () => ({
  getJobPnL: async () => null,
}));

// Required cleanup for DOM tests
afterEach(cleanup);

beforeEach(() => {
  h.state.quoteStatus = "draft";
});

describe("JOBUI-1: Quote editor status guard (criterion 1 — guard exists)", () => {
  it("isEditableQuoteStatus returns true for draft and sent", async () => {
    const { isEditableQuoteStatus } = await import("@/lib/quote-send-guards");
    expect(isEditableQuoteStatus("draft")).toBe(true);
    expect(isEditableQuoteStatus("sent")).toBe(true);
  });

  it("isEditableQuoteStatus returns false for accepted and declined", async () => {
    const { isEditableQuoteStatus } = await import("@/lib/quote-send-guards");
    expect(isEditableQuoteStatus("accepted")).toBe(false);
    expect(isEditableQuoteStatus("declined")).toBe(false);
  });
});

describe("JOBUI-1: Editor appears only when editable (criteria 2-3)", () => {
  // RETIRED 15 Sep by #750 (JOBUI-2), per the retirement line on that card:
  //   "shows the editor for a quote in draft status"
  //   "shows the editor for a quote in sent status"
  // Both asserted the editor's own controls — Add line item, Save changes — on
  // the JOB PAGE. JOBUI-2 moves the editor to its own route at
  // /jobs/[id]/quote, so neither is satisfiable by any implementation of it.
  // The route's own coverage is tests/acceptance/750.test.ts.
  //
  // The two NEGATIVE assertions below are NOT retired and are the half worth
  // keeping: the editor must not appear on the job page for a quote the
  // customer has already responded to. JOBUI-2 makes them true of every
  // status, which is a strengthening, not a supersession.

  it("does NOT show the editor for a quote in accepted status", async () => {
    h.state.quoteStatus = "accepted";
    const JobPage = (await import("@/app/jobs/[id]/page")).default;

    render(
      await JobPage({
        params: Promise.resolve({ id: JOB_ID }),
        searchParams: Promise.resolve({}),
      }),
    );

    // Editor controls must be absent
    expect(screen.queryByRole("button", { name: /Add line item/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Save changes/i })).toBeNull();
    expect(screen.queryByText(/Send to customer/i)).toBeNull();
  });

  it("does NOT show the editor for a quote in declined status", async () => {
    h.state.quoteStatus = "declined";
    const JobPage = (await import("@/app/jobs/[id]/page")).default;

    render(
      await JobPage({
        params: Promise.resolve({ id: JOB_ID }),
        searchParams: Promise.resolve({}),
      }),
    );

    // Editor controls must be absent
    expect(screen.queryByRole("button", { name: /Add line item/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Save changes/i })).toBeNull();
    expect(screen.queryByText(/Send to customer/i)).toBeNull();
  });
});

describe("JOBUI-1: Read-only view appears when not editable (criterion 4)", () => {
  it("shows line items and total for an accepted quote", async () => {
    h.state.quoteStatus = "accepted";
    const JobPage = (await import("@/app/jobs/[id]/page")).default;

    render(
      await JobPage({
        params: Promise.resolve({ id: JOB_ID }),
        searchParams: Promise.resolve({}),
      }),
    );

    // Line item description must be visible
    expect(screen.getByText(/Rewire 5 sockets/i)).toBeDefined();

    // The page header shows the total beside the customer name - query it there
    // to avoid collision with any summary rendering
    const header = screen.getByRole("heading", { name: /Test Customer/i }).parentElement;
    expect(header).toBeDefined();
    if (header) {
      expect(within(header).getByText(/£250.00/i)).toBeDefined();
    }
  });

  it("shows line items and total for a declined quote", async () => {
    h.state.quoteStatus = "declined";
    const JobPage = (await import("@/app/jobs/[id]/page")).default;

    render(
      await JobPage({
        params: Promise.resolve({ id: JOB_ID }),
        searchParams: Promise.resolve({}),
      }),
    );

    // Line item description must be visible
    expect(screen.getByText(/Rewire 5 sockets/i)).toBeDefined();

    // Total in the page header
    const header = screen.getByRole("heading", { name: /Test Customer/i }).parentElement;
    expect(header).toBeDefined();
    if (header) {
      expect(within(header).getByText(/£250.00/i)).toBeDefined();
    }
  });

  it("shows line items and total for a draft quote (editor is present too)", async () => {
    h.state.quoteStatus = "draft";
    const JobPage = (await import("@/app/jobs/[id]/page")).default;

    render(
      await JobPage({
        params: Promise.resolve({ id: JOB_ID }),
        searchParams: Promise.resolve({}),
      }),
    );

    // Line item is visible
    expect(screen.getByText(/Rewire 5 sockets/i)).toBeDefined();

    // Total is visible somewhere on the page (editor shows it in its own header)
    expect(screen.getAllByText(/£250.00/i).length).toBeGreaterThan(0);
  });

  it("shows line items and total for a sent quote (editor is present too)", async () => {
    h.state.quoteStatus = "sent";
    const JobPage = (await import("@/app/jobs/[id]/page")).default;

    render(
      await JobPage({
        params: Promise.resolve({ id: JOB_ID }),
        searchParams: Promise.resolve({}),
      }),
    );

    // Line item is visible
    expect(screen.getByText(/Rewire 5 sockets/i)).toBeDefined();

    // Total is visible
    expect(screen.getAllByText(/£250.00/i).length).toBeGreaterThan(0);
  });
});

describe("JOBUI-1: Download quote link persists across all states (criterion 5)", () => {
  it.each(["draft", "sent", "accepted", "declined"])(
    "shows Download quote link on a %s quote",
    async (status) => {
      h.state.quoteStatus = status;
      const JobPage = (await import("@/app/jobs/[id]/page")).default;

      render(
        await JobPage({
          params: Promise.resolve({ id: JOB_ID }),
          searchParams: Promise.resolve({}),
        }),
      );

      // The link text is "Download quote" and it's an external link
      expect(screen.getByText(/Download quote/i)).toBeDefined();
    },
  );
});

describe("JOBUI-1: The page renders successfully in all states (criterion 6)", () => {
  it.each(["draft", "sent", "accepted", "declined"])(
    "renders without error for a %s quote",
    async (status) => {
      h.state.quoteStatus = status;
      const JobPage = (await import("@/app/jobs/[id]/page")).default;

      // Should not throw
      const result = render(
        await JobPage({
          params: Promise.resolve({ id: JOB_ID }),
          searchParams: Promise.resolve({}),
        }),
      );

      expect(result.container).toBeDefined();
    },
  );
});
