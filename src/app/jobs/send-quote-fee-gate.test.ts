import { describe, it, expect, vi, beforeEach } from "vitest";

// The zero-free-jobs gate on sendQuote: a trade whose free allowance AND grace
// window are spent (and who still hasn't set up billing) is stopped from
// sending a NEW quote, but nothing else. We drive loadFeeRunway directly (its
// own maths is unit-tested in fee-runway.test.ts) to prove the wiring: blocked
// throws the pointed message and never flips the quote to "sent"; allowed sends
// as normal.
const h = vi.hoisted(() => {
  const quoteUpdates: Array<Record<string, unknown>> = [];
  const job = {
    contractor_id: "c-1",
    customer_id: "cust-1",
    sow_json: null,
    contractor: { company_name: "Meg's Plumbers" },
  };
  const quote = { total: 200, line_items_json: [], drafted_line_items_json: null };

  const client = {
    from: (table: string) => {
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.eq = () => b;
      b.insert = () => b;
      b.update = (payload: Record<string, unknown>) => {
        if (table === "quotes") quoteUpdates.push(payload);
        return b;
      };
      b.single = () =>
        Promise.resolve({
          data: table === "jobs" ? job : table === "quotes" ? quote : null,
          error: null,
        });
      return b;
    },
  };

  const loadFeeRunway = vi.fn();
  const sendQuoteEmail = vi.fn(async () => ({ delivered: true }));
  const sendQuoteSms = vi.fn(async () => ({ delivered: false }));
  const logError = vi.fn(async () => {});
  const track = vi.fn(async () => {});

  return { client, quoteUpdates, loadFeeRunway, sendQuoteEmail, sendQuoteSms, logError, track };
});

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => h.client }));
vi.mock("@/lib/fee-runway", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/fee-runway")>();
  return { ...actual, loadFeeRunway: h.loadFeeRunway };
});
vi.mock("@/lib/email", () => ({ sendQuoteEmail: h.sendQuoteEmail }));
vi.mock("@/lib/sms", () => ({ sendQuoteSms: h.sendQuoteSms }));
vi.mock("@/lib/analytics", () => ({ track: h.track, logError: h.logError }));
vi.mock("@/lib/knowledge", () => ({ syncQuoteKnowledge: vi.fn(), findSimilarPastJobs: vi.fn() }));
vi.mock("@/lib/materials", () => ({ rememberMaterialPrices: vi.fn(), findKnownMaterialPrices: vi.fn() }));
vi.mock("@/lib/claude", () => ({ generateSowNarrative: vi.fn(), draftQuoteLineItems: vi.fn() }));
vi.mock("@/lib/realtime", () => ({ createRealtimeClientSecret: vi.fn() }));

import { sendQuote } from "./actions";
import { FEE_RUNWAY_BLOCKED_MESSAGE } from "@/lib/fee-runway";

const JOB_ID = "11111111-1111-4111-8111-111111111111";
const QUOTE_ID = "22222222-2222-4222-8222-222222222222";

const send = () =>
  sendQuote({
    jobId: JOB_ID,
    quoteId: QUOTE_ID,
    customer: { name: "Sheila", email: "sheila@example.com", smsOptOut: false },
    channels: { email: true, sms: false },
  });

describe("sendQuote — zero-free-jobs gate", () => {
  beforeEach(() => {
    h.quoteUpdates.length = 0;
    h.loadFeeRunway.mockReset();
    h.sendQuoteEmail.mockClear();
  });

  it("blocks the send with the pointed message and never marks the quote sent", async () => {
    h.loadFeeRunway.mockResolvedValue({ canSendQuote: false });

    await expect(send()).rejects.toThrow(FEE_RUNWAY_BLOCKED_MESSAGE);
    // The block is a hard stop: no delivery attempt, no status flip.
    expect(h.sendQuoteEmail).not.toHaveBeenCalled();
    expect(h.quoteUpdates.some((u) => u.status === "sent")).toBe(false);
  });

  it("sends as normal when the runway permits it", async () => {
    h.loadFeeRunway.mockResolvedValue({ canSendQuote: true });

    const result = await send();
    expect(result.delivered).toBe(true);
    expect(h.quoteUpdates.some((u) => u.status === "sent")).toBe(true);
  });
});
