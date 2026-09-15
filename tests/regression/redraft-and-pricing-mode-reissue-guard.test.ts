// #727 re-binds two properties that its retirement took out of
// tests/acceptance/quote-edit-status-guard.test.ts.
//
// The five retired assertions all pinned `accepted -> refuse`, which is the
// rule this item reverses, so each was unsatisfiable by definition. But two of
// them carried a claim WORTH KEEPING that had nothing to do with `accepted`:
//
//   1. "checks status BEFORE invoking the drafting LLM, so a refusal costs no
//      tokens" — still true, and still the difference between a cheap refusal
//      and a paid one. Only the fixture status it was demonstrated with is
//      superseded.
//
//   2. criterion 8's RACE — an edit landing between the read and the UPDATE
//      must not silently overwrite what arrived in between. Still true; what
//      changed is which flip refuses. Flipping to `accepted` mid-flight now
//      re-issues, so the race is demonstrated with `declined`, which is still
//      a refusal and is the customer-driven flip that actually matters now.
//
// updateQuoteLineItems' half of both is covered in
// src/app/jobs/update-quote-line-items.test.ts. This file covers its two
// siblings, which is what the retired pair was about.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QUOTE_NOT_EDITABLE } from "@/lib/quote-send-guards";
import { WRITABLE_QUOTE_STATUSES } from "@/lib/quote-editability";

const JOB_ID = "11111111-1111-4111-8111-111111111111";
const QUOTE_ID = "22222222-2222-4222-8222-222222222222";

type Row = Record<string, unknown>;
type Recorded = { table: string; payload: Row };

const h = vi.hoisted(() => {
  const state = {
    /** What the SELECT sees. */
    quoteStatus: "draft",
    /** Whether a contract embed comes back on the quote row. */
    contractExists: false,
    /**
     * What the UPDATE's `.in("status", …)` predicate sees. Differs from
     * quoteStatus only in the race tests — that gap IS the race.
     */
    statusAtUpdate: null as string | null,
    updates: [] as Recorded[],
    /** Every `.in("status", …)` the code built, so the predicate is assertable. */
    statusPredicates: [] as string[][],
  };

  const quoteRow = (): Row => ({
    id: QUOTE_ID,
    status: state.quoteStatus,
    total: 300,
    sent_total: 300,
    contract: state.contractExists ? { id: "contract-1" } : null,
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
    contractor_flags_json: [],
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
          if (col === "status") {
            inStatuses = vals;
            state.statusPredicates.push([...vals]);
          }
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
            return Promise.resolve({ data: [] as Row[], error: null }).then(onOk, onErr);
          }
          // An UPDATE guarded by `.in("status", …)` matches only when the row's
          // status AT WRITE TIME is in the allowed set. This is the whole
          // mechanism the race assertions exercise.
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
vi.mock("@/lib/email", () => ({ sendQuoteEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/sms", () => ({ sendQuoteSms: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/analytics", () => ({ track: async () => {}, logError: async () => {} }));

const quoteUpdates = () => h.state.updates.filter((u) => u.table === "quotes");
const jobUpdates = () => h.state.updates.filter((u) => u.table === "jobs");

beforeEach(() => {
  h.state.quoteStatus = "draft";
  h.state.contractExists = false;
  h.state.statusAtUpdate = null;
  h.state.updates = [];
  h.state.statusPredicates = [];
  h.draftQuoteLineItems.mockClear();
});

describe("a refused redraft costs no tokens", () => {
  // The property the retired assertion carried. It was demonstrated on an
  // accepted quote, which no longer refuses; these are the two refusals that
  // remain, and the claim is unchanged: the guard runs BEFORE the LLM.

  it("refuses a declined quote without calling the drafting model", async () => {
    h.state.quoteStatus = "declined";
    const { redraftJob } = await import("@/app/jobs/actions");

    await expect(redraftJob({ jobId: JOB_ID })).rejects.toThrow(QUOTE_NOT_EDITABLE);
    expect(h.draftQuoteLineItems).not.toHaveBeenCalled();
    expect(quoteUpdates()).toHaveLength(0);
  });

  it("refuses an accepted quote that has a contract, without calling the model", async () => {
    // Stronger than the assertion it replaces: this is the case #727 ADDS, and
    // getting it wrong costs a token spend on every locked job as well as an
    // overwritten agreement.
    h.state.quoteStatus = "accepted";
    h.state.contractExists = true;
    const { redraftJob } = await import("@/app/jobs/actions");

    await expect(redraftJob({ jobId: JOB_ID })).rejects.toThrow(/contract has been raised/i);
    expect(h.draftQuoteLineItems).not.toHaveBeenCalled();
    expect(quoteUpdates()).toHaveLength(0);
  });
});

describe("a status landing mid-flight still cannot be overwritten", () => {
  // Criterion 8, re-demonstrated. `accepted` arriving mid-flight now re-issues
  // rather than refusing — that is the decision — so the flip that must still
  // refuse is `declined`, and it is the customer-driven one.

  it("redraftJob refuses when the quote is declined between the read and the UPDATE", async () => {
    h.state.quoteStatus = "draft";
    h.state.statusAtUpdate = "declined";
    const { redraftJob } = await import("@/app/jobs/actions");

    await expect(redraftJob({ jobId: JOB_ID })).rejects.toThrow(QUOTE_NOT_EDITABLE);
    expect(quoteUpdates()).toHaveLength(0);
  });

  it("setQuotePricingMode refuses on the same flip, and writes neither table", async () => {
    // The no-partial-write half: the quote UPDATE and the sow_json write are
    // two statements with no transaction, so the guarded one must run first
    // and short-circuit the other.
    h.state.quoteStatus = "draft";
    h.state.statusAtUpdate = "declined";
    const { setQuotePricingMode } = await import("@/app/jobs/actions");

    await expect(
      setQuotePricingMode({ jobId: JOB_ID, quoteId: QUOTE_ID, mode: "fixed", fixedAmount: 2000 }),
    ).rejects.toThrow(QUOTE_NOT_EDITABLE);
    expect(quoteUpdates()).toHaveLength(0);
    expect(jobUpdates()).toHaveLength(0);
  });

  it("guards both writes with the writable set, not with a wider filter", async () => {
    // Asserting the PREDICATE, not the returned row — a stub returns whatever
    // it was handed, so asserting the row would pass with the `.in(...)`
    // deleted, which is the entire defect this exists to catch (#660).
    h.state.quoteStatus = "accepted";
    const { setQuotePricingMode } = await import("@/app/jobs/actions");

    await setQuotePricingMode({
      jobId: JOB_ID,
      quoteId: QUOTE_ID,
      mode: "fixed",
      fixedAmount: 2000,
    });

    expect(h.state.statusPredicates).toContainEqual([...WRITABLE_QUOTE_STATUSES]);
    expect([...WRITABLE_QUOTE_STATUSES]).toEqual(["draft", "sent", "accepted"]);
  });
});
