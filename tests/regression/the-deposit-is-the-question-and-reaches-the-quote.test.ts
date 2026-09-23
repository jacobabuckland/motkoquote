/**
 * The last question of the call asks about the DEPOSIT, and the answer lands
 * on the quote.
 *
 * WHAT IT USED TO ASK. "Has anything already been agreed with the customer on
 * cost — a day rate, a fixed price, or a deposit?" Reported 22 Sep as the app
 * asking the same thing twice, and the contractor was right to read it that
 * way: they had answered the pricing question a minute earlier, and nothing in
 * the wording distinguishes "what did you agree with the customer BEFORE this
 * quote" from "how do you want this job priced". It is a different fact, and
 * telling them apart should not be the contractor's job mid-call.
 *
 * WHAT IT ASKS NOW. Whether a deposit has been discussed or they want one, and
 * at what percentage. The day rate and fixed price are dropped from the ASK,
 * not from the record: `pricing.mode` already holds how this job is priced,
 * and the fields stay for a contractor who volunteers one.
 *
 * WHY A PERCENTAGE HAS ITS OWN FIELD. "Twenty five" said of a deposit means
 * 25% far more often than twenty five pounds, and on a GBP 2,000 quote those
 * are GBP 500 and GBP 25. One field taking both has to guess, and the guess is
 * the customer's money.
 *
 * AND WHY IT HAD TO REACH THE QUOTE. A question whose answer goes nowhere is
 * worse than one nobody asked: the contractor states a deposit out loud, and
 * the document the customer reads says nothing about it. It goes through
 * `parseDeposit` against the quote's own total — the same arithmetic, and the
 * same ceilings, as typing "25%" into the editor.
 */

import { describe, expect, it } from "vitest";
import {
  CHECKLIST_QUESTIONS,
  EMPTY_SOW_STATE,
  getUnansweredRequiredChecklistQuestions,
  mergeSowDelta,
  type SowState,
} from "@/lib/schemas/sow";
import { parseDeposit } from "@/lib/quote-deposit";

const sow = (overrides: Partial<SowState>): SowState => ({ ...EMPTY_SOW_STATE, ...overrides });

describe("the question the contractor hears", () => {
  it("asks about a deposit, and for a percentage", () => {
    expect(CHECKLIST_QUESTIONS.agreed_costs).toMatch(/deposit/i);
    expect(CHECKLIST_QUESTIONS.agreed_costs).toMatch(/percentage/i);
  });

  it("covers both a deposit already discussed and one they want to add", () => {
    // "Have you discussed... or do you want to put one in?" — a contractor who
    // has agreed nothing yet still has something to answer.
    expect(CHECKLIST_QUESTIONS.agreed_costs).toMatch(/discussed/i);
    expect(CHECKLIST_QUESTIONS.agreed_costs).toMatch(/want to put one in/i);
  });

  it("no longer re-asks the pricing question in different words", () => {
    // This is the whole complaint: "a day rate, a fixed price, or a deposit"
    // is indistinguishable from the pricing question already answered.
    expect(CHECKLIST_QUESTIONS.agreed_costs).not.toMatch(/day rate/i);
    expect(CHECKLIST_QUESTIONS.agreed_costs).not.toMatch(/fixed price/i);
  });

  it("still asks how the job is priced, which is the separate question", () => {
    // Dropped from the deposit ask, not from the call.
    expect(CHECKLIST_QUESTIONS.duration).toMatch(/fixed price/i);
  });
});

describe("a percentage is stored as a percentage", () => {
  it("answers the slot", () => {
    const state = mergeSowDelta(
      null,
      { agreed_costs: { deposit_pct: 25 } } as Parameters<typeof mergeSowDelta>[1],
    );

    expect(state.agreed_costs?.deposit_pct).toBe(25);
    expect(getUnansweredRequiredChecklistQuestions(state)).not.toContain("agreed_costs");
  });

  it("is a different field from an amount in pounds", () => {
    // The two are not interchangeable and must not collapse into one.
    const pct = mergeSowDelta(
      null,
      { agreed_costs: { deposit_pct: 25 } } as Parameters<typeof mergeSowDelta>[1],
    );
    const amount = mergeSowDelta(
      null,
      { agreed_costs: { deposit_amount: 25 } } as Parameters<typeof mergeSowDelta>[1],
    );

    expect(pct.agreed_costs?.deposit_amount).toBeNull();
    expect(amount.agreed_costs?.deposit_pct).toBeNull();
  });

  it("does not clobber a deposit stated earlier in the call", () => {
    const first = mergeSowDelta(
      null,
      { agreed_costs: { deposit_pct: 25 } } as Parameters<typeof mergeSowDelta>[1],
    );
    const second = mergeSowDelta(
      first,
      { agreed_costs: { notes: "before VAT" } } as Parameters<typeof mergeSowDelta>[1],
    );

    expect(second.agreed_costs?.deposit_pct).toBe(25);
  });

  it("still lets 'nothing agreed' answer the slot", () => {
    const state = sow({
      agreed_costs: {
        day_rate: null,
        fixed_price: null,
        deposit_amount: null,
        deposit_pct: null,
        notes: undefined,
        nothing_agreed: true,
      },
    });

    expect(getUnansweredRequiredChecklistQuestions(state)).not.toContain("agreed_costs");
  });
});

describe("the percentage becomes the quote's deposit", () => {
  // What `draftQuote` does with it: the same call the editor makes when the
  // contractor types "25%". Asserted here against the arithmetic rather than
  // the database write, which is what the action test covers.
  const applied = (pct: number, totalPounds: number) =>
    parseDeposit(`${pct}%`, Math.round(totalPounds * 100));

  it("is a quarter of the quote, to the penny", () => {
    expect(applied(25, 2000)).toEqual({ ok: true, pennies: 50_000 });
  });

  it("rounds a repeating share once, rather than leaving it to the invoice", () => {
    expect(applied(33.33, 740)).toEqual({ ok: true, pennies: 24_664 });
  });

  it("refuses a deposit bigger than the job", () => {
    const result = applied(150, 2000);

    expect(result.ok).toBe(false);
  });

  it("refuses one over the single-payment ceiling, which is not a nicety", () => {
    // A payment over the Pay by Bank limit cannot be taken on the rail at all,
    // so the customer would be sent a demand they have no way to pay.
    const result = applied(100, 50_000);

    expect(result.ok).toBe(false);
  });

  it("treats zero as an answer, not as an absence", () => {
    // "No deposit" is a decision, and it is recorded as one.
    expect(applied(0, 2000)).toEqual({ ok: true, pennies: 0 });
  });
});
