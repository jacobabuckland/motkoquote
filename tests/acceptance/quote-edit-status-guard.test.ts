// Acceptance: redraftJob and setQuotePricingMode must refuse to rewrite a
// quote's figures once the customer has responded.
//
// updateQuoteLineItems already enforced this; its two siblings write the same
// columns (line_items_json, total) and did not. That matters because the
// contract's money panel reads quotes.total LIVE at view time while its body
// prose carries the total frozen into variables_json at signature — so a
// post-signature rewrite leaves a signed contract disagreeing with itself.
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  EDITABLE_STATUSES,
  QUOTE_NOT_EDITABLE,
  isEditableQuoteStatus,
} from "@/lib/quote-send-guards";

const JOB_ID = "11111111-1111-4111-8111-111111111111";
const QUOTE_ID = "22222222-2222-4222-8222-222222222222";

type Row = Record<string, unknown>;

type Recorded = { table: string; payload: Row };

const h = vi.hoisted(() => {
  const state = {
    // What the SELECT sees.
    quoteStatus: "draft",
    // What the UPDATE's `.in("status", …)` predicate sees. Differs from
    // quoteStatus only in the race test.
    statusAtUpdate: null as string | null,
    updates: [] as Recorded[],
  };

  const quoteRow = (): Row => ({
    id: QUOTE_ID,
    status: state.quoteStatus,
    line_items_json: [
      {
        description: "Labour",
        category: "labour",
        quantity: 1,
        unit: "day",
        unit_price: 300,
        multiplier: 1,
        people_count: 1,
        overtime: false,
        assumed: false,
      },
    ],
    drafted_line_items_json: null,
  });

  const rowFor = (table: string): Row | null => {
    if (table === "contractors") {
      return {
        id: "c-1",
        trade: "electrician",
        vat_registered: false,
        day_rate: 300,
        overtime_rate: null,
        callout_min: null,
        travel_rate: null,
        markup_pct: null,
      };
    }
    if (table === "jobs") return { id: JOB_ID, sow_json: null };
    if (table === "quotes") return quoteRow();
    return null;
  };

  type Builder = {
    select: (cols?: string) => Builder;
    eq: (col: string, val: unknown) => Builder;
    in: (col: string, vals: readonly string[]) => Builder;
    update: (payload: Row) => Builder;
    single: () => Promise<{ data: Row | null; error: null }>;
    maybeSingle: () => Promise<{ data: Row | null; error: null }>;
    then: (
      onOk: (v: { data: Row[]; error: null }) => unknown,
      onErr?: (e: unknown) => unknown,
    ) => Promise<unknown>;
  };

  const client = {
    auth: {
      getUser: async () => ({ data: { user: { id: "u-1" } }, error: null }),
    },
    from: (table: string): Builder => {
      let isUpdate = false;
      let payload: Row = {};
      let inStatuses: readonly string[] | null = null;

      const b: Builder = {
        select: () => b,
        eq: () => b,
        in: (col, vals) => {
          if (col === "status") inStatuses = vals;
          return b;
        },
        update: (p) => {
          isUpdate = true;
          payload = p;
          return b;
        },
        single: async () => ({ data: rowFor(table), error: null }),
        maybeSingle: async () => ({ data: rowFor(table), error: null }),
        then: (onOk, onErr) => {
          if (!isUpdate) {
            // Plain list reads (team_members, rate_cards).
            return Promise.resolve({ data: [] as Row[], error: null }).then(onOk, onErr);
          }
          // An UPDATE guarded by `.in("status", …)` only matches when the row's
          // status at write time is in the allowed set.
          const effective = state.statusAtUpdate ?? state.quoteStatus;
          const matched = inStatuses === null || inStatuses.includes(effective);
          if (matched) state.updates.push({ table, payload });
          return Promise.resolve({
            data: matched ? [{ id: QUOTE_ID }] : ([] as Row[]),
            error: null,
          }).then(onOk, onErr);
        },
      };
      return b;
    },
  };

  const draftQuoteLineItems = vi.fn(async () => ({
    line_items: [],
    contractor_flags: [],
  }));

  return { state, client, draftQuoteLineItems };
});

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => h.client }));
vi.mock("@/lib/claude", () => ({
  draftQuoteLineItems: h.draftQuoteLineItems,
  generateSowNarrative: vi.fn(async () => ""),
}));
vi.mock("@/lib/compile-draft", () => ({
  compileDraftToLineItems: () => ({
    lineItems: [
      {
        description: "Labour",
        category: "labour" as const,
        quantity: 1,
        unit: "day",
        unit_price: 300,
        multiplier: 1,
        people_count: 1,
        overtime: false,
        assumed: false,
      },
    ],
    contractorFlags: [],
  }),
  hasUnresolvedRateFlag: () => false,
}));
vi.mock("@/lib/knowledge", () => ({
  findSimilarPastJobs: async () => [],
  syncQuoteKnowledge: async () => {},
}));
vi.mock("@/lib/materials", () => ({
  findKnownMaterialPrices: async () => [],
  rememberMaterialPrices: async () => {},
}));
vi.mock("@/lib/quote-learning", () => ({
  findSimilarPastJobs: async () => [],
  getContractorTendencies: async () => [],
  diffLineItems: () => [],
  recordQuoteEdits: async () => {},
}));
vi.mock("@/lib/analytics", () => ({ track: async () => {}, logError: async () => {} }));

const quoteUpdates = () => h.state.updates.filter((u) => u.table === "quotes");
const jobUpdates = () => h.state.updates.filter((u) => u.table === "jobs");

beforeEach(() => {
  h.state.quoteStatus = "draft";
  h.state.statusAtUpdate = null;
  h.state.updates = [];
  h.draftQuoteLineItems.mockClear();
});

describe("shared guard vocabulary (criterion 1)", () => {
  it("defines the editable statuses once, outside the server-actions module", () => {
    expect([...EDITABLE_STATUSES]).toEqual(["draft", "sent"]);
  });

  it("classifies every lifecycle status the same way for all three writers", () => {
    expect(isEditableQuoteStatus("draft")).toBe(true);
    expect(isEditableQuoteStatus("sent")).toBe(true);
    expect(isEditableQuoteStatus("accepted")).toBe(false);
    expect(isEditableQuoteStatus("declined")).toBe(false);
  });

  it("exposes one refusal message so all three paths answer identically", () => {
    expect(QUOTE_NOT_EDITABLE).toBe(
      "This quote can no longer be edited — the customer has already responded.",
    );
  });
});

describe("redraftJob status guard (criteria 2-5)", () => {
  it("refuses on an accepted quote and writes nothing", async () => {
    h.state.quoteStatus = "accepted";
    const { redraftJob } = await import("@/app/jobs/actions");

    await expect(redraftJob({ jobId: JOB_ID })).rejects.toThrow(QUOTE_NOT_EDITABLE);
    expect(quoteUpdates()).toHaveLength(0);
  });

  it("refuses on a declined quote and writes nothing", async () => {
    h.state.quoteStatus = "declined";
    const { redraftJob } = await import("@/app/jobs/actions");

    await expect(redraftJob({ jobId: JOB_ID })).rejects.toThrow(QUOTE_NOT_EDITABLE);
    expect(quoteUpdates()).toHaveLength(0);
  });

  it("checks status BEFORE invoking the drafting LLM, so a refusal costs no tokens", async () => {
    h.state.quoteStatus = "accepted";
    const { redraftJob } = await import("@/app/jobs/actions");

    await expect(redraftJob({ jobId: JOB_ID })).rejects.toThrow(QUOTE_NOT_EDITABLE);
    expect(h.draftQuoteLineItems).not.toHaveBeenCalled();
  });

  it.each(["draft", "sent"])("still succeeds on a %s quote", async (status) => {
    h.state.quoteStatus = status;
    const { redraftJob } = await import("@/app/jobs/actions");

    const result = await redraftJob({ jobId: JOB_ID });

    expect(result.lineItemCount).toBeGreaterThan(0);
    expect(quoteUpdates()).toHaveLength(1);
    expect(quoteUpdates()[0].payload).toHaveProperty("total");
  });
});

describe("setQuotePricingMode status guard (criteria 6-7)", () => {
  it("refuses on an accepted quote, writing neither the quote nor the job's sow_json", async () => {
    h.state.quoteStatus = "accepted";
    const { setQuotePricingMode } = await import("@/app/jobs/actions");

    await expect(
      setQuotePricingMode({ jobId: JOB_ID, quoteId: QUOTE_ID, mode: "fixed", fixedAmount: 2000 }),
    ).rejects.toThrow(QUOTE_NOT_EDITABLE);

    // No partial write: the two statements are not transactional, so the
    // guarded quote UPDATE must run first and short-circuit the sow_json write.
    expect(quoteUpdates()).toHaveLength(0);
    expect(jobUpdates()).toHaveLength(0);
  });

  it("refuses on a declined quote, writing nothing", async () => {
    h.state.quoteStatus = "declined";
    const { setQuotePricingMode } = await import("@/app/jobs/actions");

    await expect(
      setQuotePricingMode({ jobId: JOB_ID, quoteId: QUOTE_ID, mode: "fixed", fixedAmount: 2000 }),
    ).rejects.toThrow(QUOTE_NOT_EDITABLE);
    expect(quoteUpdates()).toHaveLength(0);
    expect(jobUpdates()).toHaveLength(0);
  });

  it.each(["draft", "sent"])("still succeeds on a %s quote", async (status) => {
    h.state.quoteStatus = status;
    const { setQuotePricingMode } = await import("@/app/jobs/actions");

    const result = await setQuotePricingMode({
      jobId: JOB_ID,
      quoteId: QUOTE_ID,
      mode: "fixed",
      fixedAmount: 2000,
    });

    expect(result.total).toBe(2000);
    expect(quoteUpdates()).toHaveLength(1);
    expect(jobUpdates()).toHaveLength(1);
  });
});

describe("acceptance landing mid-flight (criterion 8)", () => {
  it("redraftJob refuses when the status flips between the read and the UPDATE", async () => {
    h.state.quoteStatus = "draft";
    h.state.statusAtUpdate = "accepted";
    const { redraftJob } = await import("@/app/jobs/actions");

    await expect(redraftJob({ jobId: JOB_ID })).rejects.toThrow(QUOTE_NOT_EDITABLE);
    expect(quoteUpdates()).toHaveLength(0);
  });

  it("setQuotePricingMode refuses when the status flips between the read and the UPDATE", async () => {
    h.state.quoteStatus = "draft";
    h.state.statusAtUpdate = "accepted";
    const { setQuotePricingMode } = await import("@/app/jobs/actions");

    await expect(
      setQuotePricingMode({ jobId: JOB_ID, quoteId: QUOTE_ID, mode: "fixed", fixedAmount: 2000 }),
    ).rejects.toThrow(QUOTE_NOT_EDITABLE);
    expect(quoteUpdates()).toHaveLength(0);
    expect(jobUpdates()).toHaveLength(0);
  });
});
