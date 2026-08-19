import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Regression guard for the "Sending…" hang (#2): every outbound channel in
// sendQuote is bounded by withTimeout, so a hanging Resend/Twilio call can
// never wedge the action. Here we fault-inject an email send that never
// resolves and assert the action still resolves (within the email budget),
// logs the timeout instead of throwing, and flips the quote to "sent" so the
// contractor can fall back to the copyable /q/ link.
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

  // Never resolves — simulates a hung Resend request.
  const sendQuoteEmail = vi.fn(() => new Promise<{ delivered: boolean }>(() => {}));
  const sendQuoteSms = vi.fn(async () => ({ delivered: false }));
  const logError = vi.fn(async () => {});
  const track = vi.fn(async () => {});

  return { client, quoteUpdates, sendQuoteEmail, sendQuoteSms, logError, track };
});

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => h.client }));
vi.mock("@/lib/email", () => ({ sendQuoteEmail: h.sendQuoteEmail }));
vi.mock("@/lib/sms", () => ({ sendQuoteSms: h.sendQuoteSms }));
vi.mock("@/lib/analytics", () => ({ track: h.track, logError: h.logError }));
vi.mock("@/lib/knowledge", () => ({ syncQuoteKnowledge: vi.fn(), findSimilarPastJobs: vi.fn() }));
vi.mock("@/lib/materials", () => ({ rememberMaterialPrices: vi.fn(), findKnownMaterialPrices: vi.fn() }));
vi.mock("@/lib/claude", () => ({ generateSowNarrative: vi.fn(), draftQuoteLineItems: vi.fn() }));
vi.mock("@/lib/realtime", () => ({ createRealtimeClientSecret: vi.fn() }));

import { sendQuote } from "./actions";
import { TIMEOUT_MS } from "@/lib/with-timeout";

const JOB_ID = "11111111-1111-4111-8111-111111111111";
const QUOTE_ID = "22222222-2222-4222-8222-222222222222";

describe("sendQuote — a hanging email channel never wedges the send (#2)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    h.quoteUpdates.length = 0;
    h.sendQuoteEmail.mockClear();
    h.logError.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves within the email timeout and still flips the quote to sent", async () => {
    const promise = sendQuote({
      jobId: JOB_ID,
      quoteId: QUOTE_ID,
      customer: { name: "Sheila", email: "sheila@example.com", smsOptOut: false },
      channels: { email: true, sms: false },
    });

    // Flush the awaited DB reads, then fast-forward past the email budget so
    // withTimeout rejects the hung send.
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS.email + 1);

    const result = await promise;

    expect(result.delivered).toBe(false);
    expect(result.email).toEqual({ attempted: true, delivered: false });
    // The timeout was logged, not thrown.
    //
    // The message moved from "sendQuote email failed" to the dispatcher's
    // event-scoped form when the per-channel timeout and logging were lifted
    // out of sendQuote into notifyCustomer. Only the label changed: the
    // behaviour this test exists to pin — a hung channel resolves as
    // not-delivered inside its budget, is logged rather than thrown, and does
    // not stop the quote flipping to "sent" — is asserted unchanged above and
    // below.
    expect(h.logError).toHaveBeenCalledWith(
      "server",
      "notifyCustomer quote_sent email failed",
      expect.objectContaining({ detail: expect.stringMatching(/timed out/) }),
    );
    // The quote still flipped to "sent" — the contractor copies the /q/ link.
    expect(h.quoteUpdates.some((u) => u.status === "sent")).toBe(true);
  });
});
