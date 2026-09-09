import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { applyPricingMode, fixedAmountAfterEdit } from "@/lib/pricing-mode";
import { reconcileStatedPrice, withStatedPriceFlag } from "@/lib/stated-price-guard";
import { sumLines } from "@/lib/quote-math";
import type { LineItem } from "@/lib/schemas/job";
import type { SowState } from "@/lib/schemas/sow";

/**
 * Editing a fixed-mode quote restates the fixed price. It used not to.
 *
 * `updateQuoteLineItems` wrote `line_items_json` and `total` with no view of
 * `sow_json` at all, so editing the works line left `pricing.fixed_amount`
 * stranded at the old figure — permanently, and with nothing reconciling the
 * two. stated-price-guard's own header records the production incident: a switch
 * to fixed seeded `fixed_amount` from the calculated subtotal at £5,000, the
 * works line was edited to £5.00, and the quote was sent and ACCEPTED at £6.00
 * gross.
 *
 * The response to that incident was reconcileStatedPrice — a DETECTOR. The
 * divergence itself was left in place, which is why it was still there months
 * later, and why this is the fourth instance of the same pattern on this board.
 *
 * WHAT THIS IS NOT: a price change. `total` is computed from the edited lines
 * either way, and the customer is charged the same either way. It stops a stale
 * stored figure contradicting the one being charged.
 */

const line = (over: Partial<LineItem> & { description: string }): LineItem => ({
  category: "materials",
  quantity: 1,
  unit: "unit",
  unit_price: 0,
  multiplier: 1,
  people_count: 1,
  overtime: false,
  assumed: false,
  ...over,
});

const fixedAt = (amount: number | null): Pick<SowState, "pricing"> => ({
  pricing: { mode: "fixed" as const, fixed_amount: amount },
});

describe("the £5,000 / £5.00 incident, reproduced", () => {
  // Seeded from the calculated subtotal, exactly as setQuotePricingMode does.
  const seeded = fixedAt(5000);
  const editedToFiver = [line({ description: "Rewire works", unit_price: 5 })];

  it("the guard still detects it — that part always worked", () => {
    expect(reconcileStatedPrice(seeded, editedToFiver)).toContain("5000.00");
  });

  it("and the edit now restates the price instead of stranding it", () => {
    expect(fixedAmountAfterEdit(seeded, editedToFiver)).toBe(5);
  });

  it("so the flag the same save writes is silent, not a mismatch it just caused", () => {
    // Reconciling the figure and then flagging the divergence you removed is
    // how a contractor learns to ignore the flag.
    const nextSow = fixedAt(fixedAmountAfterEdit(seeded, editedToFiver));
    expect(withStatedPriceFlag([], nextSow, editedToFiver)).toEqual([]);
  });
});

describe("what it restates, and what it leaves alone", () => {
  it("follows an edit upward as readily as downward", () => {
    const edited = [line({ description: "Works", unit_price: 2200 })];
    expect(fixedAmountAfterEdit(fixedAt(1800), edited)).toBe(2200);
  });

  it("says nothing when the figures already agree", () => {
    const edited = [line({ description: "Works", unit_price: 1800 })];
    expect(fixedAmountAfterEdit(fixedAt(1800), edited)).toBeNull();
  });

  it("ignores provisional sums — a fixed price never covered them", () => {
    // Editing the provisional must not restate the fixed price, and the
    // provisional must not inflate it either.
    const edited = [
      line({ description: "Works", unit_price: 1800 }),
      line({ description: "Provisional sum", unit_price: 400, provisional: true }),
    ];
    expect(fixedAmountAfterEdit(fixedAt(1800), edited)).toBeNull();
  });

  it("sums several defined-works lines rather than reading only the first", () => {
    const edited = [
      line({ description: "Works", unit_price: 1200 }),
      line({ description: "Extra sockets", unit_price: 300 }),
      line({ description: "Provisional sum", unit_price: 999, provisional: true }),
    ];
    expect(fixedAmountAfterEdit(fixedAt(1800), edited)).toBe(1500);
  });

  it("stands down outside fixed mode — no SoW field corresponds to these lines", () => {
    const edited = [line({ description: "Works", unit_price: 2200 })];
    expect(
      fixedAmountAfterEdit({ pricing: { mode: "calculated", fixed_amount: null } }, edited),
    ).toBeNull();
    expect(fixedAmountAfterEdit({ pricing: null }, edited)).toBeNull();
  });

  it("never seeds a figure where none was stated", () => {
    // Manufacturing the answer the duration slot exists to ask for.
    const edited = [line({ description: "Works", unit_price: 2200 })];
    expect(fixedAmountAfterEdit(fixedAt(null), edited)).toBeNull();
  });

  it("refuses to write a non-positive amount", () => {
    // pricingSchema declares fixed_amount positive, so a zero would produce a
    // row that fails its own parse on the next read.
    expect(fixedAmountAfterEdit(fixedAt(1800), [])).toBeNull();
    expect(
      fixedAmountAfterEdit(fixedAt(1800), [line({ description: "Works", unit_price: 0 })]),
    ).toBeNull();
  });
});

describe("the reconciled figure survives a round trip", () => {
  it("rebuilds the same lines it was derived from", () => {
    // The property that makes this safe to write: restating the price and then
    // re-applying the mode reproduces the edited quote, rather than drifting.
    const edited = [line({ description: "Rewire works", unit_price: 2200 })];
    const restated = fixedAmountAfterEdit(fixedAt(1800), edited)!;

    const rebuilt = applyPricingMode(edited, {
      pricing: { mode: "fixed", fixed_amount: restated },
      job_type: "rewire",
    });
    expect(sumLines(rebuilt)).toBe(sumLines(edited));
  });
});

/**
 * The action has to WIRE it, and write the SoW. Source-read for the reason the
 * sibling wrap-detour and reconciler tests are: this is a Server Action behind a
 * Supabase client, and what needs pinning is that the second write exists, is
 * ordered after the guarded quote write, and is not swallowed.
 */
describe("updateQuoteLineItems writes it back", () => {
  const source = readFileSync(resolve(__dirname, "../../src/app/jobs/actions.ts"), "utf8");
  const fn = source.slice(source.indexOf("export const updateQuoteLineItems"));
  const body = fn.slice(0, fn.indexOf("\nexport const", 1) === -1 ? fn.length : fn.indexOf("\nexport const", 1));

  it("derives the restated figure", () => {
    expect(body).toContain("fixedAmountAfterEdit");
  });

  it("updates the jobs row", () => {
    expect(body).toMatch(/from\("jobs"\)[\s\S]{0,120}\.update\(\{ sow_json: nextSow \}\)/);
  });

  it("keys the write on the quote's own job, not the id off the wire", () => {
    // The input carries a jobId. This action now writes sow_json, so the row it
    // writes must come from the quote it just authorised, not from the caller.
    expect(body).toMatch(/\.eq\("id", job\.id\)/);
    expect(body).not.toMatch(/\.eq\("id", jobId\)/);
  });

  it("writes the quote first, then the SoW", () => {
    // Two statements, no transaction. setQuotePricingMode records the same
    // ordering and the same reason: the guarded write goes first, so a refusal
    // cannot leave the job carrying a price for lines that were never saved.
    const quoteWrite = body.indexOf('.from("quotes")');
    const sowWrite = body.indexOf('.from("jobs")');
    expect(quoteWrite).toBeGreaterThan(-1);
    expect(sowWrite).toBeGreaterThan(quoteWrite);
  });

  it("throws rather than swallowing a failed SoW write", () => {
    expect(body).toContain("FIXED_PRICE_NOT_RECORDED");
  });

  it("recomputes the flags against the sow it is about to write", () => {
    // Against `nextSow`, not the stale `job?.sow_json` it read — otherwise the
    // save reconciles the figure and flags the divergence in the same breath.
    expect(body).toMatch(/withStatedPriceFlag\(\s*context\?\.contractor_flags_json,\s*nextSow,/);
  });
});
