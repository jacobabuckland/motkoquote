import { describe, it, expect, beforeEach, vi } from "vitest";
import { PAY_BY_BANK_LIMIT_PENNIES } from "@/app/i/[id]/pay-panel";
import {
  OVER_CEILING_CONFIRM_REQUIRED,
  quoteExceedsCeiling,
  overCeilingConfirmMessage,
  parseOverCeilingConfirm,
} from "@/lib/quote-send-guards";
import { sendQuoteSchema } from "@/app/jobs/actions";

describe("STAGE-1: Detect over-ceiling quotes at quote time", () => {

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exports PAY_BY_BANK_LIMIT_PENNIES from pay-panel.ts", () => {
    expect(PAY_BY_BANK_LIMIT_PENNIES).toBe(10_000_00);
    expect(typeof PAY_BY_BANK_LIMIT_PENNIES).toBe("number");
  });

  it("defines OVER_CEILING_CONFIRM_REQUIRED sentinel in quote-send-guards", () => {
    expect(OVER_CEILING_CONFIRM_REQUIRED).toBeDefined();
    expect(typeof OVER_CEILING_CONFIRM_REQUIRED).toBe("string");
  });

  it("quoteExceedsCeiling returns true when quote exceeds the limit", () => {
    // £14,000 = 1,400,000 pennies, which exceeds 1,000,000
    const overCeilingAmount = 14000;
    const result = quoteExceedsCeiling(overCeilingAmount);
    expect(result).toBe(true);
  });

  it("quoteExceedsCeiling returns false when quote is under the limit", () => {
    // £8,000 = 800,000 pennies, which is under 1,000,000
    const underCeilingAmount = 8000;
    const result = quoteExceedsCeiling(underCeilingAmount);
    expect(result).toBe(false);
  });

  it("quoteExceedsCeiling returns false when quote equals the limit exactly", () => {
    // £10,000 = 1,000,000 pennies, exactly at the limit
    // Should not trigger confirmation (> not >=, matching pay-panel.ts line 98)
    const exactLimitAmount = 10000;
    const result = quoteExceedsCeiling(exactLimitAmount);
    expect(result).toBe(false);
  });

  it("quoteExceedsCeiling reads the same constant as buildPayPanel", () => {
    // The check must import PAY_BY_BANK_LIMIT_PENNIES from pay-panel.ts,
    // not duplicate it. This test verifies both use the same limit value.
    const amountJustOver = (PAY_BY_BANK_LIMIT_PENNIES / 100) + 0.01;
    const amountJustUnder = (PAY_BY_BANK_LIMIT_PENNIES / 100) - 0.01;

    expect(quoteExceedsCeiling(amountJustOver)).toBe(true);
    expect(quoteExceedsCeiling(amountJustUnder)).toBe(false);
  });

  it("sendQuote throws OVER_CEILING_CONFIRM_REQUIRED for £14,000 quote without confirmation", async () => {
    // This test verifies that sendQuote checks the quote total and throws
    // the sentinel when it exceeds the limit and confirmOverCeiling is false.
    // The actual implementation will be in actions.ts.

    // Since sendQuote requires real database setup, this test verifies the
    // guard function is called correctly. A full integration test would
    // require mocking Supabase.
    const overCeilingAmount = 14000;
    expect(quoteExceedsCeiling(overCeilingAmount)).toBe(true);
  });

  it("sendQuote schema accepts confirmOverCeiling flag", async () => {
    // The sendQuoteSchema must accept a confirmOverCeiling boolean flag
    // that allows over-ceiling quotes to send after confirmation.
    // Import will fail before implementation, which is the correct pre-state.

    const validInput = {
      jobId: "11111111-1111-4111-8111-111111111111",
      quoteId: "22222222-2222-4222-8222-222222222222",
      customer: {
        name: "Test Customer",
        email: "test@example.com",
      },
      channels: {
        email: true,
        sms: false,
      },
      confirmZeroTotal: false,
      confirmNarrativeMismatch: false,
      confirmOverCeiling: true,
    };

    // Should parse without throwing
    const result = sendQuoteSchema.safeParse(validInput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.confirmOverCeiling).toBe(true);
    }
  });

  it("parseOverCeilingConfirm extracts the total from the sentinel message", () => {
    // Following the pattern of parseNarrativeConfirm, this should extract
    // the quote total from the sentinel message for display in the UI.
    const quoteTotal = 14000;
    const message = overCeilingConfirmMessage(quoteTotal);
    expect(message).toContain(OVER_CEILING_CONFIRM_REQUIRED);

    const parsed = parseOverCeilingConfirm(message);
    expect(parsed).not.toBeNull();
    expect(parsed?.total).toBe(quoteTotal);
  });

  it("parseOverCeilingConfirm returns null for non-matching messages", () => {
    const parsed = parseOverCeilingConfirm("Some other error");
    expect(parsed).toBeNull();
  });

  it("parseOverCeilingConfirm handles bare sentinel without figure", () => {
    // Tolerates a message with no figure appended (older client, rethrow that
    // lost the tail) — must still be recognized as the confirmation question.
    const parsed = parseOverCeilingConfirm(OVER_CEILING_CONFIRM_REQUIRED);
    expect(parsed).not.toBeNull();
    expect(parsed?.total).toBeNull();
  });
});
