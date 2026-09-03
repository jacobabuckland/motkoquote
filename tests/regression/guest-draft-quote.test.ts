import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_SOW_STATE, type SowState } from "@/lib/schemas/sow";
import type { QuoteDraft } from "@/lib/schemas/job";

// draftGuestQuote is the whole guest half of "talk a job through and get a
// quote back". Everything around it was covered — the token mint, the session
// store, the document, the send guards — but the function that turns a SoW into
// a GuestQuote had never been executed, in a test or anywhere else, because the
// two Anthropic calls inside it need an API key.
//
// They are the only part that genuinely needs one. Stubbing @/lib/claude leaves
// the whole rest of the chain real: extraction, the deterministic compile, the
// agreed-rate overrides, pricing mode, totals, and the shape handed back across
// the server-action boundary. That plumbing is where a guest would actually get
// stranded — after doing all the talking — so it is what these cover.

const sow = (overrides: Partial<SowState> = {}): SowState => ({
  ...EMPTY_SOW_STATE,
  job_type: "Full rewire",
  rooms: [{ name: "Downstairs", work_items: ["ten double sockets"] }],
  customer_name: "Luca Feser",
  customer_phone: "07700 900123",
  ...overrides,
});

const LABOUR_AND_MATERIALS: QuoteDraft = {
  line_items: [
    {
      kind: "labour",
      description: "Full rewire - three-bed semi",
      people: [{ ref: "owner", days: 5 }],
      includes_tasks: ["First fix", "Second fix"],
      overtime: false,
    },
    {
      kind: "material",
      description: "Twin & earth 2.5mm",
      quantity: 100,
      unit: "m",
      estimated_unit_cost_pence: 185,
      supplied_by: "contractor",
    },
  ],
  contractor_flags: [],
};

// Captures what the guest path asks the model for, so the "nothing fabricated"
// promise is checked against the real call and not just the source.
let narrativeCalls: { trade: string | null; companyName: string }[] = [];
let draftContexts: Record<string, unknown>[] = [];
let draftReturns: QuoteDraft = LABOUR_AND_MATERIALS;

const loadDraftGuestQuote = async () => {
  vi.resetModules();
  narrativeCalls = [];
  draftContexts = [];

  vi.doMock("@/lib/claude", () => ({
    generateSowNarrative: async (
      _sowState: SowState,
      contractor: { trade: string | null; companyName: string },
    ) => {
      narrativeCalls.push(contractor);
      return "Rewiring the downstairs of a three-bed semi.";
    },
    draftQuoteLineItems: async (
      _extraction: unknown,
      contractor: Record<string, unknown>,
    ) => {
      draftContexts.push(contractor);
      return draftReturns;
    },
  }));

  const mod = await import("@/lib/guest/quote");
  return mod.draftGuestQuote;
};

const draft = async (state: SowState) => {
  const draftGuestQuote = await loadDraftGuestQuote();
  return draftGuestQuote({
    sow: state,
    reference: "ABCD1234",
    createdAt: "2026-03-14T09:30:00.000Z",
  });
};

describe("drafting a quote for someone with no account", () => {
  beforeEach(() => {
    draftReturns = LABOUR_AND_MATERIALS;
  });

  afterEach(() => {
    vi.doUnmock("@/lib/claude");
  });

  it("returns a quote whose figures are computed, not echoed from the model", async () => {
    // The model proposed structure only — no amounts anywhere in the draft
    // above. Every number below came out of the compiler.
    const quote = await draft(sow({ agreed_costs: { day_rate: 300, fixed_price: null, deposit_amount: null } }));

    expect(quote.reference).toBe("ABCD1234");
    expect(quote.jobType).toBe("Full rewire");
    expect(quote.lineItems.length).toBeGreaterThan(0);

    const labour = quote.lineItems.find((item) => item.category === "labour");
    expect(labour, "no labour line came back").toBeDefined();
    expect(labour?.unpriced).toBeUndefined();
    // 5 days at the £300 the contractor stated in the call.
    expect(labour?.people?.[0]?.day_rate).toBe(300);
    expect(quote.total).toBeGreaterThan(0);
    // PFIX-4: Guests have no pricing history, so materials are unpriced.
    // unpricedLabour is true if ANY line is unpriced, not just labour.
    expect(quote.unpricedLabour).toBe(true);
  });

  it("marks labour unpriced when no rate was stated, rather than pricing it at zero", async () => {
    const quote = await draft(sow());

    const labour = quote.lineItems.find((item) => item.category === "labour");
    expect(labour?.unpriced).toBe(true);
    expect(quote.unpricedLabour).toBe(true);
    // PFIX-4: Guests have no pricing history, so materials are also unpriced
    // (no supplier prices on file to work from). With both labour and materials
    // unpriced, the total is 0 (not missing, just zero).
    const materials = quote.lineItems.find((item) => item.category === "materials");
    expect(materials?.unpriced).toBe(true);
    expect(quote.total).toBe(0);
  });

  it("honours a fixed price the contractor stated in the call", async () => {
    const quote = await draft(
      sow({ pricing: { mode: "fixed", fixed_amount: 4500 } }),
    );

    expect(quote.total).toBe(4500);
  });

  it("never charges VAT — a guest has no VAT registration to charge under", async () => {
    const quote = await draft(sow({ agreed_costs: { day_rate: 300, fixed_price: null, deposit_amount: null } }));

    // computeQuoteTotals adds VAT only for a registered contractor; a guest has
    // no contractor at all, so subtotal and total must agree.
    expect(quote.total).toBe(quote.subtotal);
  });

  it("carries a captured customer through, and omits the block when none was captured", async () => {
    const withCustomer = await draft(sow());
    expect(withCustomer.customer).toEqual({
      name: "Luca Feser",
      phone: "07700 900123",
      email: undefined,
      address: undefined,
    });

    const anonymous = await draft(
      sow({ customer_name: undefined, customer_phone: undefined }),
    );
    // null, not an object of undefineds — the document omits the block on null.
    expect(anonymous.customer).toBeNull();
  });

  it("asks the model for a narrative without inventing a business identity", async () => {
    await draft(sow());

    expect(narrativeCalls).toHaveLength(1);
    expect(narrativeCalls[0]).toEqual({ trade: null, companyName: "" });
  });

  it("gives the pricing model no rates, team or history to draw on", async () => {
    await draft(sow());

    expect(draftContexts).toHaveLength(1);
    const ctx = draftContexts[0]!;
    // Omitted, never stubbed with a plausible default — a guest has none of
    // this and the quote must not imply otherwise.
    for (const key of ["trade", "day_rate", "overtime_rate", "callout_min", "travel_rate", "markup_pct"]) {
      expect(ctx[key], `${key} should be null`).toBeNull();
    }
    for (const key of ["team_members", "similar_past_jobs", "known_material_prices", "rate_cards", "contractor_tendencies"]) {
      expect(ctx[key], `${key} should be empty`).toEqual([]);
    }
  });

  it("surfaces a model failure as a rejection the intake can show, not a half-built quote", async () => {
    vi.resetModules();
    vi.doMock("@/lib/claude", () => ({
      generateSowNarrative: async () => {
        throw new Error("Anthropic 529");
      },
      draftQuoteLineItems: async () => LABOUR_AND_MATERIALS,
    }));

    const { draftGuestQuote } = await import("@/lib/guest/quote");
    await expect(
      draftGuestQuote({
        sow: sow(),
        reference: "ABCD1234",
        createdAt: "2026-03-14T09:30:00.000Z",
      }),
    ).rejects.toThrow(/529/);
  });
});
