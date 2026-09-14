// "Switch to fixed price" destroyed the lines again — on the SECOND switch.
//
// #730 fixed the first collapse on a hand-typed quote by seeding
// `drafted_line_items_json` from the lines that existed before it, so the
// switch became reversible. It seeded that baseline once and never again, and
// that is the whole of this defect: the baseline froze at whatever the lines
// were the first time the control was used, and every later collapse computed
// from a snapshot that no longer described the quote.
//
// Reported 13 Sep, reproduced end to end by hand, twice, with two different
// stale values:
//
//   £1,150 → £1,000   One line at the first switch. A £150 materials line
//                     added and saved afterwards was never in the baseline,
//                     and the second switch collapsed to £1,000 without it.
//
//   £1,499 → £0.00    The first switch happened while the quote was still
//                     EMPTY, so the baseline froze at the single £0 works line
//                     that collapse created. Four lines typed and saved
//                     afterwards — £1,499 — collapsed to nothing.
//
// Both unrecoverable after reload. And in both cases the confirmation dialog
// named the CORRECT figure, because it computes from the live client lines —
// precisely the state the server was ignoring. So the control acquired a
// confirmation that made two promises it did not keep: the figure it named,
// and "switching back to itemised brings them again".
//
// WHY THIS FILE DRIVES THE REAL ACTION.
//
// `switching-pricing-mode-keeps-the-work.test.ts` covers #730 by reimplementing
// the baseline rule locally and asserting on the copy. That mirror encoded the
// frozen-baseline rule faithfully and passed, because a mirror can only be as
// right as the rule you copy into it. So this one calls `setQuotePricingMode`
// itself and asserts on the UPDATE it actually sends — `getWrites()`, not a
// restatement. AGENTS.md: assert the query, not the rows.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockSupabaseClient } from "../helpers/supabase";
import type { LineItem } from "@/lib/schemas/job";
import { EMPTY_SOW_STATE, type SowState } from "@/lib/schemas/sow";

const JOB_ID = "7967c58f-6f5d-4aa6-bdb5-0db34e4b89fd";
const QUOTE_ID = "881e998e-c5cd-4557-b9a3-c22a480a9ffb";

const line = (over: Partial<LineItem>): LineItem => ({
  description: "Work",
  category: "labour",
  quantity: 1,
  unit: "job",
  unit_price: 100,
  multiplier: 1,
  people_count: 1,
  overtime: false,
  assumed: false,
  ...over,
});

/** "Labour – two plasterers, four days", 4 day @ £250. The first switch's lines. */
const LABOUR = line({
  description: "Labour - two plasterers, four days",
  quantity: 4,
  unit: "day",
  unit_price: 250,
});

/** "Materials – bonding and multi-finish", added AFTER the first switch. */
const MATERIALS = line({
  description: "Materials - bonding and multi-finish",
  category: "materials",
  quantity: 1,
  unit: "lot",
  unit_price: 150,
});

/** What an empty quote's first collapse leaves behind, and froze the baseline. */
const EMPTY_COLLAPSE = [line({ description: "Works", unit: "job", unit_price: 0, category: "other" })];

type Scenario = {
  /** `sow_json.pricing.mode` — the mode the quote is in BEFORE this switch. */
  currentMode: "calculated" | "fixed" | null;
  active: LineItem[];
  drafted: LineItem[] | null;
};

// One row object serves every select in the action: the helper returns the same
// rows for each `from()`, and the action destructures only the fields each
// table supplies. Shapes them all at once rather than three stubbed clients.
const setup = ({ currentMode, active, drafted }: Scenario) => {
  // Spread the real empty state rather than writing a partial: `sow_json` is
  // used as the WHOLE SowState here (the action only falls back to
  // EMPTY_SOW_STATE when the column is null), so a partial reaches
  // buildQuoteScope with no `rooms` and throws.
  const sow: SowState = {
    ...EMPTY_SOW_STATE,
    pricing: currentMode ? { mode: currentMode, fixed_amount: null } : null,
  };

  const { client, getWrites } = mockSupabaseClient([
    {
      id: JOB_ID,
      vat_registered: false,
      sow_json: sow,
      status: "draft",
      line_items_json: active,
      drafted_line_items_json: drafted,
      contractor_flags_json: [],
    },
  ]);

  vi.doMock("@/lib/supabase/server", () => ({
    createClient: async () => ({
      ...client,
      auth: { getUser: async () => ({ data: { user: { id: "user_1" } }, error: null }) },
    }),
  }));

  return { getWrites };
};

const switchMode = async (mode: "fixed" | "calculated") => {
  const { setQuotePricingMode } = await import("@/app/jobs/actions");
  return setQuotePricingMode({ jobId: JOB_ID, quoteId: QUOTE_ID, mode, fixedAmount: null });
};

/** The UPDATE the action sends to `quotes`. */
const quoteUpdate = (getWrites: () => { method: string; table?: string; payload: unknown }[]) =>
  getWrites().find((w) => w.method === "update" && w.table === "quotes")?.payload as
    | Record<string, unknown>
    | undefined;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("the £1,150 case — a line added after the first switch", () => {
  it("collapses to the figure the dialog named, not to the stale one", async () => {
    // Itemised, with BOTH lines live. The baseline still holds only the labour
    // line, frozen there by the first switch.
    setup({ currentMode: "calculated", active: [LABOUR, MATERIALS], drafted: [LABOUR] });

    const result = await switchMode("fixed");

    // 4 x 250 + 1 x 150 = 1150. The reported outcome was 1000.
    expect(result.total).toBe(1150);
  });

  it("re-snapshots the baseline so the £150 line survives the round trip", async () => {
    const { getWrites } = setup({
      currentMode: "calculated",
      active: [LABOUR, MATERIALS],
      drafted: [LABOUR],
    });

    await switchMode("fixed");

    // The claim that matters: the collapse records what it actually collapsed.
    // Asserted on the write, because the returned rows are whatever the stub
    // was handed and would pass either way.
    expect(quoteUpdate(getWrites)?.drafted_line_items_json).toEqual([LABOUR, MATERIALS]);
  });
});

describe("the £1,499 case — a baseline poisoned by an empty first switch", () => {
  it("does not collapse real lines to £0.00", async () => {
    // The contractor typed four lines after switching an empty quote to fixed
    // and back. The baseline is the £0 works line that collapse created.
    const typed = [
      line({ description: "Strip walls", quantity: 2, unit: "day", unit_price: 250 }),
      line({ description: "Reskim", quantity: 3, unit: "day", unit_price: 250 }),
      line({ description: "Plaster", category: "materials", quantity: 12, unit: "bag", unit_price: 12 }),
      line({ description: "Waste", category: "other", quantity: 1, unit: "job", unit_price: 105 }),
    ];

    setup({ currentMode: "calculated", active: typed, drafted: EMPTY_COLLAPSE });

    const result = await switchMode("fixed");

    // 500 + 750 + 144 + 105 = 1499.
    expect(result.total).toBe(1499);
    expect(result.total).not.toBe(0);
  });

  it("replaces the poisoned baseline rather than keeping it", async () => {
    const typed = [line({ description: "Strip walls", quantity: 2, unit: "day", unit_price: 250 })];
    const { getWrites } = setup({
      currentMode: "calculated",
      active: typed,
      drafted: EMPTY_COLLAPSE,
    });

    await switchMode("fixed");

    expect(quoteUpdate(getWrites)?.drafted_line_items_json).toEqual(typed);
  });
});

describe("what must not regress — the baseline is still a baseline", () => {
  it("restores from the baseline when switching back OUT of fixed mode", async () => {
    // Already collapsed: the active lines are the single works line and carry
    // no breakdown at all. This is the one case where the stored baseline is
    // the thing to read.
    const { getWrites } = setup({
      currentMode: "fixed",
      active: [line({ description: "Works", category: "other", unit_price: 1150 })],
      drafted: [LABOUR, MATERIALS],
    });

    await switchMode("calculated");

    expect(quoteUpdate(getWrites)?.line_items_json).toEqual([LABOUR, MATERIALS]);
  });

  it("does not overwrite the baseline on the way OUT of fixed mode", async () => {
    // Snapshotting a restore is what poisoned the second case above.
    const { getWrites } = setup({
      currentMode: "fixed",
      active: [line({ description: "Works", category: "other", unit_price: 1150 })],
      drafted: [LABOUR, MATERIALS],
    });

    await switchMode("calculated");

    expect(quoteUpdate(getWrites)).not.toHaveProperty("drafted_line_items_json");
  });

  it("still seeds a baseline on the very first collapse of a typed quote", async () => {
    // #730's case: no baseline at all, because the manual-quote path inserts
    // `drafted_line_items_json: []`.
    const { getWrites } = setup({
      currentMode: null,
      active: [LABOUR],
      drafted: [],
    });

    await switchMode("fixed");

    expect(quoteUpdate(getWrites)?.drafted_line_items_json).toEqual([LABOUR]);
  });

  it("writes no baseline when there is nothing to snapshot", async () => {
    const { getWrites } = setup({ currentMode: null, active: [], drafted: [] });

    await switchMode("fixed");

    expect(quoteUpdate(getWrites)).not.toHaveProperty("drafted_line_items_json");
  });
});
