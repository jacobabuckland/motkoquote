import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  UNRESOLVED_RATE_FLAG,
  compileDraftToLineItems,
  hasUnresolvedRateFlag,
} from "@/lib/compile-draft";

// The signal has to arrive somewhere that can change behaviour. These tests
// assert on the row that would be WRITTEN — the actual `.insert()` payload
// captured from a stubbed client — never on whether track() was called.

const LABOUR_DRAFT = [
  {
    kind: "labour" as const,
    description: "Full rewire - three-bed semi",
    people: [{ ref: "owner", days: 5 }],
    includes_tasks: [],
    overtime: false,
  },
];

const compileWith = (dayRate: number | null) =>
  compileDraftToLineItems(
    LABOUR_DRAFT,
    {
      day_rate: dayRate,
      overtime_rate: null,
      markup_pct: null,
      team_members: [],
      rate_cards: [],
      known_material_prices: [],
      owner_label: "Owner",
    },
    [],
  );

describe("an unresolved rate reaches the contractor's flags", () => {
  it("is raised when no rate could be found", () => {
    const { contractorFlags } = compileWith(null);
    expect(hasUnresolvedRateFlag(contractorFlags)).toBe(true);
    expect(UNRESOLVED_RATE_FLAG).toMatch(/day rate/i);
  });

  it("is absent when the rate resolves", () => {
    const { contractorFlags } = compileWith(340);
    expect(hasUnresolvedRateFlag(contractorFlags)).toBe(false);
    expect(contractorFlags).toEqual([]);
  });

  it("is a job-level flag, so the editor's Before-you-send panel shows it", () => {
    // The editor treats "<line description>: note" as a line-scoped flag and
    // renders it inline; anything else goes to the job-level panel. This must
    // be the latter — it is about the job's rates, not one line's wording.
    const { contractorFlags } = compileWith(null);
    const flag = contractorFlags.find((f) => f === UNRESOLVED_RATE_FLAG);
    expect(flag).toBeDefined();
    expect(flag?.startsWith("Full rewire - three-bed semi: ")).toBe(false);
  });
});

describe("the row completeSowConversation persists", () => {
  // Captures every `.insert()` payload the action hands to Supabase, so the
  // assertion is against the stored row's contents rather than a mock call.
  const inserted: { table: string; row: Record<string, unknown> }[] = [];

  const stubClient = (dayRate: number | null) => {
    const chain = (table: string) => ({
      select: () => chain(table),
      eq: () => chain(table),
      order: () => chain(table),
      single: async () => ({ data: rowFor(table), error: null }),
      maybeSingle: async () => ({ data: rowFor(table), error: null }),
      insert: (row: Record<string, unknown>) => {
        inserted.push({ table, row });
        return {
          select: () => ({
            single: async () => ({ data: { id: "quote-1" }, error: null }),
          }),
        };
      },
      update: () => chain(table),
      then: undefined,
    });

    const rowFor = (table: string): unknown => {
      if (table === "contractors") {
        return {
          id: "contractor-1",
          company_name: "Buckland Electrical Ltd",
          trade: "Electrician",
          vat_registered: false,
          day_rate: dayRate,
          overtime_rate: null,
          callout_min: null,
          travel_rate: null,
          markup_pct: null,
        };
      }
      if (table === "jobs") return { id: "job-1", sow_json: null };
      return null;
    };

    return {
      auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
      from: (table: string) => chain(table),
    };
  };

  const runComplete = async (dayRate: number | null) => {
    inserted.length = 0;
    vi.resetModules();

    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => stubClient(dayRate),
    }));
    // Everything below is a network call or a database helper the flag does not
    // depend on. Stubbed so the test exercises the real drafting/compile path.
    vi.doMock("@/lib/claude", () => ({
      generateSowNarrative: async () => "Overview.",
      draftQuoteLineItems: async () => ({
        line_items: LABOUR_DRAFT,
        contractor_flags: [],
      }),
    }));
    vi.doMock("@/lib/knowledge", () => ({
      findSimilarPastJobs: async () => [],
      syncQuoteKnowledge: async () => {},
    }));
    vi.doMock("@/lib/materials", () => ({
      findKnownMaterialPrices: async () => [],
      rememberMaterialPrices: async () => {},
    }));
    vi.doMock("@/lib/quote-learning", () => ({
      getContractorTendencies: async () => [],
      diffLineItems: () => [],
      recordQuoteEdits: async () => {},
    }));
    vi.doMock("@/lib/analytics", () => ({ track: async () => {}, logError: async () => {} }));

    const { completeSowConversation } = await import("@/app/jobs/actions");
    await completeSowConversation({ jobId: "00000000-0000-4000-8000-000000000001" });

    return inserted.find((entry) => entry.table === "quotes")?.row ?? null;
  };

  beforeEach(() => {
    vi.resetModules();
  });

  it("carries the unresolved-rate flag when the contractor has no day rate", async () => {
    const quoteRow = await runComplete(null);

    expect(quoteRow, "no quotes row was inserted").not.toBeNull();
    const flags = quoteRow?.contractor_flags_json as string[];
    expect(hasUnresolvedRateFlag(flags)).toBe(true);

    // And the same row's line items carry the mark the document renders from,
    // so the two halves of the fix agree about the same quote.
    const lineItems = quoteRow?.line_items_json as { unpriced?: boolean }[];
    expect(lineItems.some((item) => item.unpriced)).toBe(true);
  }, 30_000);

  it("carries no such flag when the contractor has a day rate", async () => {
    const quoteRow = await runComplete(340);

    const flags = quoteRow?.contractor_flags_json as string[];
    expect(hasUnresolvedRateFlag(flags)).toBe(false);

    const lineItems = quoteRow?.line_items_json as { unpriced?: boolean }[];
    expect(lineItems.some((item) => item.unpriced)).toBe(false);
  }, 30_000);
});
