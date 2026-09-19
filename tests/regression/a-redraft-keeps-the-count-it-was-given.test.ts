/**
 * A redraft does not hand the count back to the model.
 *
 * #828 taught the compiler to apply a count the contractor stated without a
 * price — "I need eight bags of finish" — and wired it into `draftQuote`. It
 * did NOT wire it into `redraftJob`, which rebuilds every line from scratch and
 * so re-ran the drafting model with nothing carrying the eight. The model
 * writes such a count into the line description and leaves `quantity` at 1, so
 * a contractor who redrafted went straight back to being billed for one bag of
 * eight: the fix held on the first path and nowhere else.
 *
 * The guard has to hold on EVERY path that rebuilds the lines, and the redraft
 * reads the stored answer rather than re-deriving it — exactly as it already
 * does for `stated_prices`, which is the field this one sits beside.
 *
 * Asserts the WIRING, at the seam that broke: what `redraftJob` hands the
 * compiler. What the compiler then does with it is pinned separately, by
 * a-count-said-without-a-price-is-a-quantity.test.ts, and duplicating that here
 * would test the same thing twice and the handover not at all.
 */

import { describe, expect, it, vi } from "vitest";
import type { StatedQuantity } from "@/lib/voice/stated-quantities";

const QUANTITIES: StatedQuantity[] = [
  {
    item: "finish",
    quantity: 8,
    unit: "bag",
    transcript_span: "I need eight bags of finish",
  },
];

const JOB_ID = "11111111-1111-4111-8111-111111111111";

/** What reached compileDraftToLineItems on the redraft path. */
const redraftWithStoredQuantities = async (
  quantities: StatedQuantity[] | undefined,
): Promise<StatedQuantity[] | undefined> => {
  vi.resetModules();

  let seen: StatedQuantity[] | undefined;

  const sow = {
    job_type: "Plastering",
    rooms: [],
    additional_items: [],
    materials_mentioned: ["finish"],
    inclusions: [],
    exclusions: [],
    assumptions_and_unknowns: [],
    stated_prices: [],
    materials_supply: {
      contractor_supplied: [],
      customer_supplied: [],
      responsibility: "contractor",
      ...(quantities ? { quantities } : {}),
    },
  };

  const single = async (data: unknown) => ({ data, error: null });
  vi.doMock("@/lib/supabase/server", () => ({
    createClient: async () => ({
      auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
      from: (table: string) => {
        const row =
          table === "contractors"
            ? { id: "c1", trade: "plasterer", vat_registered: false, day_rate: 300, overtime_rate: null, callout_min: null, travel_rate: null, markup_pct: 0 }
            : table === "jobs"
              ? { id: JOB_ID, sow_json: sow }
              : table === "quotes"
                ? { id: "q1", status: "draft", total: 0, sent_total: null, contract: null }
                : null;
        const builder = {
          select: () => builder,
          eq: () => builder,
          single: () => single(row),
          maybeSingle: () => single(row),
          update: () => builder,
          insert: () => builder,
          then: (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null }),
        };
        return builder;
      },
    }),
  }));

  vi.doMock("next/cache", () => ({ revalidatePath: () => {} }));
  vi.doMock("@/lib/claude", () => ({
    generateSowNarrative: async () => "",
    draftQuoteLineItems: async () => ({ line_items: [], contractor_flags: [] }),
  }));
  vi.doMock("@/lib/knowledge", () => ({
    findSimilarPastJobs: async () => [],
    syncQuoteKnowledge: async () => {},
  }));
  vi.doMock("@/lib/learned-quotes", () => ({ countLearnedQuotes: async () => 0 }));
  vi.doMock("@/lib/materials", () => ({
    findKnownMaterialPrices: async () => [],
    rememberMaterialPrices: async () => {},
  }));
  vi.doMock("@/lib/quote-learning", () => ({
    diffLineItems: () => [],
    getContractorTendencies: async () => [],
    recordQuoteEdits: async () => {},
  }));

  const actual = await vi.importActual<typeof import("@/lib/compile-draft")>("@/lib/compile-draft");
  vi.doMock("@/lib/compile-draft", () => ({
    ...actual,
    compileDraftToLineItems: (
      _drafts: unknown,
      _ctx: unknown,
      _jobFlags: unknown,
      _prices: unknown,
      statedQuantities?: StatedQuantity[],
    ) => {
      seen = statedQuantities;
      return { lineItems: [], mismatches: [], contractorFlags: [] };
    },
  }));

  const { redraftJob } = await import("@/app/jobs/actions");
  await redraftJob({ jobId: JOB_ID }).catch(() => {
    // The action continues past the compile into persistence this stub does not
    // model. The argument has already been captured by then, and THAT is the
    // claim — a throw afterwards is this harness's limit, not the guard's.
  });

  return seen;
};

describe("redraftJob", () => {
  it("carries the stored count into the compiler", async () => {
    expect(await redraftWithStoredQuantities(QUANTITIES)).toEqual(QUANTITIES);
  });

  it("passes an empty list rather than undefined when nothing was counted", async () => {
    // The compiler defaults the parameter, so either would work today. Pinning
    // it keeps the redraft path's shape identical to the draft path's, which is
    // what stops the two drifting apart again.
    expect(await redraftWithStoredQuantities(undefined)).toEqual([]);
  });
});
