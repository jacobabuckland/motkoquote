// VOICE ROUND 5: a trade saying "eleven pounds per bag" was billed for one bag.
//
// `applyStatedPrice` in compile-draft.ts branches on one qualifier:
//
//   if (statedPrice.qualifiers.each) { quantity: qty }   // per unit
//   // otherwise the stated amount IS the line total:
//   quantity: 1
//
// and that qualifier was detected as `/\beach\b/i` and nothing else. So the
// single word "each" decided whether a quote billed 28 bags or one, and four
// lines across three calls undercharged:
//
//   "28 bags of finish at £11.20 each"   28 x £11.20 = £313.60   (matched)
//   "7 bags of bonding at £14.50"         1 x £14.50             (-£87.00)
//   "18 bags of finish at £11.50/bag"     1 x £11.50             (-£195.50)
//   "£12 per shift", three shifts         1 x £12.00             (-£24.00)
//   "8 bags at £11 per bag"               1 x £11.00             (-£77.00)
//
// Every failure is silent: the DESCRIPTION still says "18 bags", so the quote
// reads as though it covers them. Only the quantity column disagrees, and it
// is the one that multiplies.
//
// THE OTHER HALF OF THE RULE, and the reason this is not simply "match more
// words": a time unit must never read as per-unit. "£250 a day" is a rate.
// Multiplying a day rate by a line quantity INFLATES a quote, which is the more
// expensive direction to be wrong in. A rate is still recorded, but
// `containsRateUnit` marks it REFUSED — so it never becomes chargeable — and
// the per-unit vocabulary excludes time and measure units outright.
import { describe, expect, it } from "vitest";
import {
  extractStatedPrices,
  getChargeableStatedPrices,
} from "@/lib/voice/stated-prices";

/**
 * Every stated price the extractor found, with its per-unit verdict.
 * `amount` comes back in PENCE, so it is converted once here and the
 * assertions below read in pounds.
 */
const priced = (transcript: string) =>
  extractStatedPrices(transcript, []).map((p) => ({
    amount: p.amount / 100,
    perUnit: p.qualifiers.each,
  }));

/**
 * Only the prices that reach the quote as line items — what `compile-draft`
 * consumes. A refused amount is extracted and recorded for the audit trail,
 * but never charged.
 */
const chargeable = (transcript: string) =>
  getChargeableStatedPrices(extractStatedPrices(transcript, [])).map((p) => ({
    amount: p.amount / 100,
    perUnit: p.qualifiers.each,
  }));

describe("per-unit phrasing a trade actually uses", () => {
  it("reads 'each', as it always did", () => {
    const [finish] = priced("Twenty eight bags of finishing plaster at £11.20 each.");
    expect(finish?.amount).toBe(11.2);
    expect(finish?.perUnit).toBe(true);
  });

  it("reads 'per bag'", () => {
    // The reported line. Eight bags at £11 billed £11.
    const [finish] = priced("Eight bags of finishing plaster at £11 per bag.");
    expect(finish?.amount).toBe(11);
    expect(finish?.perUnit).toBe(true);
  });

  it("reads 'a bag'", () => {
    const [finish] = priced("Finishing plaster is £11.50 a bag.");
    expect(finish?.perUnit).toBe(true);
  });

  it("reads a slash", () => {
    // "£11.50/bag" is how it arrives when the speech is transcribed tightly.
    const [finish] = priced("Eighteen bags of finish at £11.50/bag.");
    expect(finish?.perUnit).toBe(true);
  });

  it("reads 'apiece'", () => {
    const [beads] = priced("The corner beads are £4 apiece.");
    expect(beads?.perUnit).toBe(true);
  });

  it("reads 'per shift', which is how parking and hire are quoted", () => {
    // Three shifts at £12 billed £12.
    const [parking] = priced("Parking is £12 per shift.");
    expect(parking?.amount).toBe(12);
    expect(parking?.perUnit).toBe(true);
  });

  it("reads the packaging words a plasterer uses", () => {
    for (const phrase of [
      "Primer is £27 per tub.",
      "Boards are £14 a sheet.",
      "Scrim is £6 per roll.",
      "Beads are £22 a box.",
    ]) {
      const [line] = priced(phrase);
      expect(line?.perUnit, phrase).toBe(true);
    }
  });
});

describe("a rate is still not a per-unit price", () => {
  // The guard that must not move. Widening the qualifier must not turn a day
  // rate into a per-unit material line.
  //
  // Two separate claims, and both matter. A rate must not be marked per-unit,
  // because that is what makes `applyStatedPrice` multiply it by the line's
  // quantity. And a rate must not be CHARGEABLE either, because it is a rate
  // and not a line total — that is `containsRateUnit`'s existing refusal, and
  // widening the per-unit vocabulary must not reach past it.

  it("does not read a day rate as per-unit, and does not charge it", () => {
    for (const phrase of [
      "The lads are on two hundred and fifty a day.",
      "That's £250 per day.",
    ]) {
      expect(priced(phrase).every((p) => p.perUnit === false), phrase).toBe(true);
      expect(chargeable(phrase), phrase).toHaveLength(0);
    }
  });

  it("does not read an hourly rate as per-unit, and does not charge it", () => {
    for (const phrase of ["We charge £40 an hour.", "It's £40 per hour."]) {
      expect(priced(phrase).every((p) => p.perUnit === false), phrase).toBe(true);
      expect(chargeable(phrase), phrase).toHaveLength(0);
    }
  });

  it("does not read a rate per metre or per unit as per-unit pricing", () => {
    // "per unit" is the interesting one: the WORD "unit" is in the countable
    // vocabulary, so the qualifier would happily match it. `containsRateUnit`
    // refuses the amount outright, which is what keeps it off the quote.
    for (const phrase of ["Coving is £18 per metre.", "They're £30 per unit."]) {
      expect(chargeable(phrase), phrase).toHaveLength(0);
    }

    expect(priced("Coving is £18 per metre.").every((p) => p.perUnit === false)).toBe(true);
  });

  it("never lets a rate reach a line item, however it is phrased", () => {
    // The composite case: a rate and a genuine per-unit price in one breath.
    // Only the bags may be charged, and only the bags may be per-unit.
    const lines = chargeable(
      "The lads are £250 a day. Finishing plaster is £11.50 a bag.",
    );

    expect(lines).toHaveLength(1);
    expect(lines[0]?.amount).toBe(11.5);
    expect(lines[0]?.perUnit).toBe(true);
  });
});

describe("a price with no per-unit phrasing is still a line total", () => {
  // The other guard. Not every price is per-unit, and reading one as per-unit
  // multiplies it by a quantity nobody stated.

  it("leaves a bare lump sum alone", () => {
    const [waste] = priced("Waste removal is £180.");
    expect(waste?.amount).toBe(180);
    expect(waste?.perUnit).toBe(false);
  });

  it("leaves a job-total price alone", () => {
    const [protection] = priced("Protection for the whole job is £88.");
    expect(protection?.perUnit).toBe(false);
  });

  it("does not read 'for a <thing>' as per-unit", () => {
    // The construction that separates the two readings. "£11.50 a bag" spreads
    // a price over a count; "£140 for a radiator swap" names the price of one
    // thing. One word in front, and multiplying is now the wrong answer — so
    // the article form only counts immediately after the amount.
    const [swap] = priced("I normally charge one hundred and forty pounds for a radiator swap.");
    expect(swap?.amount).toBe(140);
    expect(swap?.perUnit).toBe(false);

    // And the same noun, one word closer, IS per-unit.
    const [rate] = priced("Radiators are £140 a radiator.");
    expect(rate?.perUnit).toBe(true);
  });

  it("does not read a bare 'a' as per-unit", () => {
    // "a" on its own is far too common. It needs a unit noun behind it.
    const [line] = priced("It's £95 for a full day of making good.");
    expect(line?.perUnit ?? false).toBe(false);
  });
});
