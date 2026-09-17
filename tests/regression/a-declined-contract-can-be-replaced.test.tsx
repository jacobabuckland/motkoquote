/**
 * @vitest-environment happy-dom
 */
// PASS-14 CRITICAL 1: declining a contract permanently bricked the job, and the
// partial fix made it a trap rather than a wall.
//
// `deriveJobState` has said `move: "contractor"` for a declined contract since
// pass 12 — the customer refused THIS contract, not the job. The job page's
// panel never got the message: it rendered "Nothing needs you here." and no
// form. Two surfaces, contradicting each other, and the panel won.
//
// What that cost, in pass 14's words: CONTRACT-3 made the quote editable again
// after a decline, so the contractor edits the price, the job moves to "Waiting
// on X to accept", the Actions panel promises "Send contract — available once X
// accepts the quote", the customer accepts a SECOND time, and the job lands
// back on "Nothing needs you here" with no form. £1,320 of accepted work with
// no way to contract or invoice it, and invisible in the dashboard besides.
//
// The page is rendered for real here rather than asserted against its source,
// because the defect was precisely that the rendered panel disagreed with the
// derivation. A test of `deriveJobState` alone passes against the bug.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { dashboardSection } from "@/lib/dashboard-sections";
import type { QuoteState, ContractState } from "@/lib/job-stages";

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
          if (table === "jobs") return { data: state.jobData, error: null };
          if (table === "quotes") return { data: state.quoteData, error: null };
          if (table === "payment_stages") return { data: state.stagesData, error: null };
          return { data: null, error: null };
        },
      };
      return builder;
    },
  };

  return { state, client };
});

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => h.client }));

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("notFound");
  }),
  useRouter: vi.fn(() => ({ push: vi.fn(), refresh: vi.fn() })),
  useSearchParams: vi.fn(() => ({ get: () => null })),
  usePathname: vi.fn(() => "/jobs/job_1"),
}));

vi.mock("@/app/jobs/[id]/cost-actions", () => ({
  getJobCosts: async () => ({ ok: true, data: [] }),
}));

vi.mock("@/app/jobs/[id]/pnl-actions", () => ({ getJobPnL: async () => null }));

afterEach(cleanup);

const DECLINED_CONTRACT = {
  id: "contract_1",
  status: "declined",
  sent_at: "2026-09-17T10:00:00Z",
  signed_at: null,
  declined_at: "2026-09-17T11:00:00Z",
  withdrawn_at: null,
  deposit_pct: null,
  job_input_json: null,
};

const renderJobPage = async () => {
  const mod = await import("@/app/jobs/[id]/page");
  render(
    await mod.default({
      params: Promise.resolve({ id: "job_1" }),
      searchParams: Promise.resolve({}),
    }),
  );
};

beforeEach(() => {
  h.state.jobData = {
    id: "job_1",
    created_at: "2026-09-01T10:00:00Z",
    status: "drafted",
    contractor: { vat_registered: true, free_jobs_remaining: 3, business_profile: null },
    customer: { name: "Dawn Whitlock", contact: { email: "dawn@example.com" } },
    extracted_json: null,
    sow_json: null,
    transcript: null,
    fee_amount_pennies: null,
    fee_status: null,
    fee_waived_reason: null,
    work_completed_at: null,
    settlement_state: null,
    payment_provider_ref: null,
    archived_at: null,
  };
  h.state.stagesData = [];
  h.state.quoteData = {
    id: "quote_1",
    line_items_json: [],
    contractor_flags_json: null,
    total: 1320,
    subtotal: null,
    vat_amount: null,
    deposit_pennies: null,
    sent_total: null,
    status: "accepted",
    sent_at: "2026-09-17T09:00:00Z",
    viewed_at: "2026-09-17T09:30:00Z",
    accepted_at: "2026-09-17T09:45:00Z",
    accepted_first_at: "2026-09-17T09:45:00Z",
    accepted_total: 1320,
    reissued_at: null,
    declined_at: null,
    created_at: "2026-09-01T10:00:00Z",
    contracts: DECLINED_CONTRACT,
    invoices: [],
  };
});

describe("a job whose contract was declined", () => {
  it("offers a way to send a replacement", async () => {
    // The whole finding. Before this, the panel rendered "Nothing needs you
    // here." and the only controls were Copy link, Add cost and Archive job.
    await renderJobPage();

    expect(
      screen.getByRole("button", { name: /send contract/i }),
      "a declined contract left the contractor with no way to send a replacement, " +
        "though the quote is still accepted and the derivation says it is their move",
    ).toBeDefined();
  });

  it("does not tell the contractor there is nothing to do", async () => {
    await renderJobPage();

    expect(screen.queryByText("Nothing needs you here.")).toBeNull();
  });

  it("still says what happened, rather than hiding the decline", async () => {
    // The fix must not buy a working form by pretending the contract was never
    // declined. The headline is true and stays.
    await renderJobPage();

    expect(screen.getByText(/declined the contract/i)).toBeDefined();
  });

  it("keeps the declined contract reachable", async () => {
    await renderJobPage();

    const download = screen.getByRole("link", { name: /download contract/i });
    expect(download.getAttribute("href")).toBe("/api/contracts/contract_1/pdf");
  });
});

describe("where the dashboard files a declined contract", () => {
  const quote: QuoteState = {
    status: "accepted",
    sent_at: "2026-09-17T09:00:00Z",
    viewed_at: "2026-09-17T09:30:00Z",
    accepted_at: "2026-09-17T09:45:00Z",
    declined_at: null,
    total: 1320,
  };

  it("puts it in front of the contractor, not only in the record of declines", () => {
    // It returned null, so the job appeared ONLY under "Signed & declined
    // contracts / Declined today" and was absent from the pipeline and from the
    // "your move" count. Accepted work, invisible.
    const contract: ContractState = {
      id: "contract_1",
      status: "declined",
      sent_at: "2026-09-17T10:00:00Z",
      signed_at: null,
      declined_at: "2026-09-17T11:00:00Z",
      deposit_pct: null,
    };

    expect(dashboardSection(quote, contract, [])).toBe("awaiting_contract");
  });

  it("leaves a DECLINED QUOTE alone, which really is over", () => {
    const declinedQuote: QuoteState = {
      ...quote,
      status: "declined",
      accepted_at: null,
      declined_at: "2026-09-17T09:45:00Z",
    };

    expect(dashboardSection(declinedQuote, null, [])).toBeNull();
  });

  it("still files a live contract awaiting signature under neither section", () => {
    const contract: ContractState = {
      id: "contract_1",
      status: "sent",
      sent_at: "2026-09-17T10:00:00Z",
      signed_at: null,
      declined_at: null,
      deposit_pct: null,
    };

    expect(dashboardSection(quote, contract, [])).toBeNull();
  });
});
