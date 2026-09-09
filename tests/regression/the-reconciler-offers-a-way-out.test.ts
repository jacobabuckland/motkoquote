import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  STATED_PRICE_MISMATCH_PREFIX,
  parseStatedPriceMismatch,
  reconcileStatedPrice,
  statedPriceMismatchFlag,
} from "@/lib/stated-price-guard";
import type { LineItem } from "@/lib/schemas/job";

/**
 * A stated-price mismatch has to offer a way out.
 *
 * On 9 Sep a contractor pressed send, read "you set £1800.00, but the priced
 * lines come to £2200.00", pressed send again, and read it again (Sentry
 * JAVASCRIPT-NEXTJS-A). The message was correct. It was also the end of the
 * road: nothing on the screen connected it to a control, so every press
 * recomputed the same refusal from unchanged data.
 *
 * The cause was narrow and findable. quote-editor's catch block matched
 * "Unsourced line", "Amount mismatch" and "Duplicate amount" and routed those to
 * a review screen — but NOT this prefix, so it fell through to setSendResult,
 * which renders a bare error with no action.
 *
 * WHAT THIS IS NOT: a confirm. The zero-total, narrative and over-ceiling guards
 * all let the contractor proceed after acknowledging. Sending with two stored
 * figures that disagree is what produced the £5,000 SoW against a £5.00 works
 * line, accepted at £6.00 gross, so this one has to be RESOLVED. Both offered
 * routes change the quote; neither bypasses the guard.
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

describe("the two figures survive the round trip", () => {
  it("reads back exactly what the producer wrote", () => {
    // Producer and parser live in one file precisely so this can hold. A
    // reworded message with an unchanged regex is the drift this catches.
    const message = statedPriceMismatchFlag(1800, 2200);
    expect(parseStatedPriceMismatch(message)).toEqual({ stated: 1800, priced: 2200 });
  });

  it("survives the pennies", () => {
    const message = statedPriceMismatchFlag(1800, 2355.98);
    expect(parseStatedPriceMismatch(message)).toEqual({ stated: 1800, priced: 2355.98 });
  });

  it("reads it out of a real reconcileStatedPrice failure", () => {
    // Not a hand-built string: the actual output of the guard that blocks send.
    const lines = [line({ description: "Works", unit_price: 2200 })];
    const failure = reconcileStatedPrice(
      { pricing: { mode: "fixed", fixed_amount: 1800 } },
      lines,
    );
    expect(failure).not.toBeNull();
    expect(parseStatedPriceMismatch(failure!)).toEqual({ stated: 1800, priced: 2200 });
  });

  it("still reads it when other failures are joined on", () => {
    // reconcileStatedPrice JOINS its failure kinds with a space, so a mismatch
    // can arrive with a double-charge or an unsourced line trailing it.
    const joined = `${statedPriceMismatchFlag(1800, 2200)} Unsourced line: "Skirting" has no provenance.`;
    expect(parseStatedPriceMismatch(joined)).toEqual({ stated: 1800, priced: 2200 });
  });

  it("returns null for the other reconciliation kinds", () => {
    expect(parseStatedPriceMismatch('Unsourced line: "Skirting" has no provenance.')).toBeNull();
    expect(parseStatedPriceMismatch("Amount mismatch: stated £400.00 …")).toBeNull();
    expect(parseStatedPriceMismatch("")).toBeNull();
  });

  it("returns null when the prefix is present but the figures are not", () => {
    // A reworded body with the prefix intact must fail closed rather than
    // hand the UI two undefined numbers to render as buttons.
    expect(parseStatedPriceMismatch(`${STATED_PRICE_MISMATCH_PREFIX}something else entirely`))
      .toBeNull();
  });
});

/**
 * The editor has to ROUTE it. The parser being correct is no use if the catch
 * block never calls it — which is exactly the state this fixes.
 *
 * Source-read for the same reason tests/regression/top-bar-safe-area.test.tsx is:
 * the branch lives in a 1,200-line client component behind a Server Action call
 * and a transition, and what needs pinning is that the wiring EXISTS. The
 * behaviour either side of it is covered above and by the guard's own tests.
 */
describe("the editor routes it to a resolution", () => {
  const source = readFileSync(
    resolve(__dirname, "../../src/app/jobs/[id]/quote-editor.tsx"),
    "utf8",
  );

  it("parses the mismatch out of a failed send", () => {
    expect(source).toContain("parseStatedPriceMismatch");
  });

  it("holds it separately from the edit-only reconciliation kinds", () => {
    // reconciliationError is a review screen for things the contractor must go
    // and edit. This one is a choice between two known figures, so conflating
    // them would lose the resolution.
    expect(source).toContain("resolvingMismatch");
  });

  it("offers a route that sets the fixed price to the priced total", () => {
    expect(source).toMatch(/switchPricingMode\(\s*"fixed",\s*resolvingMismatch\.priced\s*\)/);
  });

  it("offers a route that drops fixed pricing altogether", () => {
    // Also resolves it: reconcileStatedPrice only runs in fixed mode.
    expect(source).toMatch(/switchPricingMode\(\s*"calculated"\s*\)/);
  });

  it("never offers a way to send the disagreement as-is", () => {
    // No confirmStatedPriceMismatch, anywhere. If one is ever added it is a
    // decision about money and belongs in areas/motko.md, not in a catch block.
    expect(source).not.toMatch(/confirmStatedPriceMismatch/);
  });
});
