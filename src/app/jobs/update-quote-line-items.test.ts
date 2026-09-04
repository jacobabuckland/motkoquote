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

const contextWith = (status: string) => ({
  status,
  job: { extracted_json: null, contractor: { id: "c-1", vat_registered: false } },
});

describe("updateQuoteLineItems — not editable after acceptance (#18)", () => {
  beforeEach(() => {
    h.syncQuoteKnowledge.mockClear();
    h.rememberMaterialPrices.mockClear();
    h.state.capturedIn = null;
    h.state.updateResult = { data: [{ id: "q-1" }], error: null };
  });

  it("refuses to edit an accepted quote and never writes", async () => {
    h.state.quoteContext = contextWith("accepted");
    await expect(
      updateQuoteLineItems({ jobId: JOB_ID, quoteId: QUOTE_ID, lineItems }),
    ).rejects.toThrow(/no longer be edited/i);
    expect(h.syncQuoteKnowledge).not.toHaveBeenCalled();
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
    expect(h.state.capturedIn).toEqual(["status", ["draft", "sent"]]);
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
