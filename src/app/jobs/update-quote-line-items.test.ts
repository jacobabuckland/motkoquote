import { describe, it, expect, vi, beforeEach } from "vitest";
import type { LineItem } from "@/lib/schemas/job";

// updateQuoteLineItems lives in the heavy jobs/actions.ts module. Mock every
// network / side-effect dependency so importing it is cheap and deterministic;
// only the Supabase client and the two knowledge writers matter for this test.
const h = vi.hoisted(() => {
  const syncQuoteKnowledge = vi.fn(async () => {});
  const rememberMaterialPrices = vi.fn(async () => {});
  const state: {
    quoteContext: unknown;
    updateResult: { data: unknown; error: unknown };
    capturedIn: [string, unknown] | null;
  } = { quoteContext: null, updateResult: { data: [{ id: "q-1" }], error: null }, capturedIn: null };

  const admin = {
    from: () => {
      const b: Record<string, unknown> = { _upd: false };
      b.select = (_c?: string) => (b._upd ? Promise.resolve(state.updateResult) : b);
      b.update = () => {
        b._upd = true;
        return b;
      };
      b.eq = () => b;
      b.in = (k: string, v: unknown) => {
        state.capturedIn = [k, v];
        return b;
      };
      b.single = () => Promise.resolve({ data: state.quoteContext, error: null });
      return b;
    },
  };

  return { syncQuoteKnowledge, rememberMaterialPrices, admin, state };
});

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => h.admin }));
vi.mock("@/lib/knowledge", () => ({
  syncQuoteKnowledge: h.syncQuoteKnowledge,
  findSimilarPastJobs: vi.fn(),
}));
vi.mock("@/lib/materials", () => ({
  rememberMaterialPrices: h.rememberMaterialPrices,
  findKnownMaterialPrices: vi.fn(),
}));
vi.mock("@/lib/claude", () => ({ generateSowNarrative: vi.fn(), draftQuoteLineItems: vi.fn() }));
vi.mock("@/lib/realtime", () => ({ createRealtimeClientSecret: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendQuoteEmail: vi.fn() }));
vi.mock("@/lib/sms", () => ({ sendQuoteSms: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn(), logError: vi.fn() }));

import { updateQuoteLineItems } from "./actions";

const JOB_ID = "11111111-1111-4111-8111-111111111111";
const QUOTE_ID = "22222222-2222-4222-8222-222222222222";

const lineItems: LineItem[] = [
  {
    description: "Works",
    category: "labour",
    quantity: 1,
    unit: "day",
    unit_price: 200,
    multiplier: 1,
    people_count: 1,
    overtime: false,
    assumed: false,
  },
];

const contextWith = (status: string, contract: { id: string } | null = null) => ({
  status,
  accepted_at: status === "accepted" ? "2026-09-13T10:00:00.000Z" : null,
  total: 200,
  sent_total: 180,
  // #727: the contract-presence input. `contracts.quote_id` is UNIQUE, so this
  // is a to-ONE embed — an object or null, never an array.
  contract,
  job: {
    extracted_json: null,
    customer: { name: "Harriet", contact: { email: "harriet@example.com" } },
    contractor: { id: "c-1", company_name: "Aspire Plastering Limited", vat_registered: false },
  },
});

describe("updateQuoteLineItems — not editable after acceptance (#18)", () => {
  beforeEach(() => {
    h.syncQuoteKnowledge.mockClear();
    h.rememberMaterialPrices.mockClear();
    h.state.capturedIn = null;
    h.state.updateResult = { data: [{ id: "q-1" }], error: null };
  });

  // #727 CHANGED THIS RULE IN ONE DIRECTION ONLY, and both directions are
  // asserted here. Jacob's ruling of 13 Sep: an edit voids the acceptance, and
  // only up to the point of the contract. So `accepted` with no contract is now
  // editable and re-issues; `accepted` WITH a contract is refused outright,
  // signed or unsigned. Same status, two answers.
  //
  // This test previously asserted the first case was refused. That was the
  // pre-#727 rule and it is deliberately superseded — but the second case is
  // new and matters more: a guard that simply widened the status list would
  // pass the first assertion and fail the second, which is the criterion the
  // card calls out.
  it("EDITS an accepted quote that has no contract, and re-issues it", async () => {
    h.state.quoteContext = contextWith("accepted", null);
    const result = await updateQuoteLineItems({ jobId: JOB_ID, quoteId: QUOTE_ID, lineItems });
    expect(result.total).toBe(200);
    // The write predicate is widened by exactly `accepted`.
    expect(h.state.capturedIn).toEqual(["status", ["draft", "sent", "accepted"]]);
  });

  it("refuses an accepted quote once a contract exists, and never writes", async () => {
    h.state.quoteContext = contextWith("accepted", { id: "contract-1" });
    await expect(
      updateQuoteLineItems({ jobId: JOB_ID, quoteId: QUOTE_ID, lineItems }),
    ).rejects.toThrow(/contract has been raised/i);
    expect(h.syncQuoteKnowledge).not.toHaveBeenCalled();
  });

  it("refuses a draft or sent quote that has a contract — signed or unsigned", async () => {
    // Decision (1) is about the contract existing, not about its status.
    for (const status of ["draft", "sent"]) {
      h.state.quoteContext = contextWith(status, { id: "contract-1" });
      await expect(
        updateQuoteLineItems({ jobId: JOB_ID, quoteId: QUOTE_ID, lineItems }),
      ).rejects.toThrow(/contract has been raised/i);
    }
  });

  it("refuses to edit a declined quote", async () => {
    h.state.quoteContext = contextWith("declined");
    await expect(
      updateQuoteLineItems({ jobId: JOB_ID, quoteId: QUOTE_ID, lineItems }),
    ).rejects.toThrow(/no longer be edited/i);
  });

  it("edits a draft quote, asserting the editable prior state in the UPDATE", async () => {
    h.state.quoteContext = contextWith("draft");
    const result = await updateQuoteLineItems({ jobId: JOB_ID, quoteId: QUOTE_ID, lineItems });
    expect(result.total).toBe(200);
    expect(h.state.capturedIn).toEqual(["status", ["draft", "sent", "accepted"]]);
    // PFIX-4: editing a draft no longer teaches the knowledge layer. Editing
    // is not approval, and a quote never sent must teach nothing — otherwise
    // the model's own invented figures come back as "similar past jobs" in the
    // next draft's prompt. Learning happens in sendQuote now.
    expect(h.syncQuoteKnowledge).not.toHaveBeenCalled();
  });

  it("edits a sent quote (still awaiting the customer's decision)", async () => {
    h.state.quoteContext = contextWith("sent");
    const result = await updateQuoteLineItems({ jobId: JOB_ID, quoteId: QUOTE_ID, lineItems });
    expect(result.total).toBe(200);
  });

  it("throws if a concurrent acceptance wins between the read and the write", async () => {
    h.state.quoteContext = contextWith("sent");
    h.state.updateResult = { data: [], error: null }; // .in("status", …) matched nothing
    await expect(
      updateQuoteLineItems({ jobId: JOB_ID, quoteId: QUOTE_ID, lineItems }),
    ).rejects.toThrow(/no longer be edited/i);
    expect(h.syncQuoteKnowledge).not.toHaveBeenCalled();
  });
});
