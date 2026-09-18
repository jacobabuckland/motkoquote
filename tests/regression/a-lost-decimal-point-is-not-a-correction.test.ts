/**
 * "Twelve forty" said twice is one price, not a hundredfold correction.
 *
 * A contractor states a rate with its pence — "seven bags of finish at £12.40 a
 * bag" — and then shortens it in a follow-up, which the transcript writes as
 * "1240". Read as a correction, the second spelling SUPERSEDES the first, and
 * the quote bills £1,240 a bag.
 *
 * Scenario 50 of the 18 Sep tranche came to £8,930 against an expected £336.80:
 * an overcharge of £8,593.20 on a customer-facing document, with no mismatch
 * warning, because nothing had disagreed — the later figure simply won. The
 * same scenario had passed the run before, so it is the conversation varying
 * rather than the code, which is what makes it worth a deterministic guard
 * instead of a hope.
 *
 * The signature is exact: the later amount is exactly a hundred times an
 * earlier one, AND that earlier one carries pence. A whole-pound figure has no
 * point to lose, so a genuine hundredfold correction still supersedes.
 *
 * The artefact is recorded as refused rather than dropped — the contractor did
 * say it and is owed an explanation — and refused prices are not chargeable.
 */

import { describe, expect, it } from "vitest";
import { compileDraftToLineItems, type CompileContext } from "@/lib/compile-draft";
import { lineItemTotal } from "@/lib/quote-math";
import type { DraftLineItem } from "@/lib/schemas/job";
import { extractStatedPrices } from "@/lib/voice/stated-prices";

const SAID = "Seven bags of finish at £12.40 a bag. Yeah, 1240.";

const live = (transcript: string) =>
  extractStatedPrices(transcript, []).filter((p) => p.superseded_by === null && !p.refused);

describe("a decimal rate restated without its point", () => {
  it("does not let the hundredfold spelling supersede the real one", () => {
    const chargeable = live(SAID);

    expect(chargeable).toHaveLength(1);
    expect(chargeable[0]?.amount).toBe(1240);
    expect(chargeable[0]?.quantity, "the count stays with the price").toBe(7);
  });

  it("records the figure they said rather than discarding it", () => {
    const artefact = extractStatedPrices(SAID, []).find((p) => p.amount === 124000);

    expect(artefact, "the contractor said it and is owed an explanation").toBeDefined();
    expect(artefact?.refused, "recorded, but never chargeable").toBe(true);
    expect(artefact?.superseded_by).toBeNull();
  });
});

describe("a correction that really is one", () => {
  it("still supersedes when the first figure was whole pounds", () => {
    // £5 has no decimal point to lose, so £500 is a correction, not an
    // artefact. This is the case the pence test exists to protect.
    const chargeable = live("The skip's £5. No, £500.");

    expect(chargeable.map((p) => p.amount)).toEqual([50000]);
  });

  it("still supersedes an ordinary correction", () => {
    const chargeable = live("Delivery is £60. Actually, no, £48.");

    expect(chargeable.map((p) => p.amount)).toEqual([4800]);
  });

  it("leaves a lone whole-pound rate alone", () => {
    // Nothing to compare it against: no decimal was ever said, so there is no
    // evidence of a lost point and the figure stands.
    expect(live("Seven bags at 1240 each").map((p) => p.amount)).toEqual([124000]);
  });
});

describe("what the customer would have been charged", () => {
  it("bills seven bags at twelve forty, not at twelve hundred and forty", () => {
    const context: CompileContext = {
      day_rate: 250,
      overtime_rate: null,
      markup_pct: 0,
      team_members: [],
      rate_cards: [],
      known_material_prices: [],
      owner_label: "Jake",
      has_pricing_history: false,
      labour_plan: { people_count: 1, duration_days: 1, crew_description: null },
    };
    const result = compileDraftToLineItems(
      [
        {
          kind: "material",
          description: "Finishing plaster (multi-finish) – seven bags",
          quantity: 7,
          unit: "bag",
          supplied_by: "contractor",
          estimated_unit_cost_pence: 1240,
        } as unknown as DraftLineItem,
      ],
      context,
      [],
      extractStatedPrices(SAID, []),
    );
    const finish = result.lineItems[0]!;

    expect(finish.unit_price, "the quote billed £1,240 a bag").toBe(12.4);
    expect(lineItemTotal(finish)).toBeCloseTo(86.8, 2);
  });

  it("tells the contractor about the figure it would not charge", () => {
    const context: CompileContext = {
      day_rate: 250,
      overtime_rate: null,
      markup_pct: 0,
      team_members: [],
      rate_cards: [],
      known_material_prices: [],
      owner_label: "Jake",
      has_pricing_history: false,
      labour_plan: { people_count: 1, duration_days: 1, crew_description: null },
    };
    const result = compileDraftToLineItems(
      [
        {
          kind: "material",
          description: "Finishing plaster (multi-finish) – seven bags",
          quantity: 7,
          unit: "bag",
          supplied_by: "contractor",
          estimated_unit_cost_pence: 1240,
        } as unknown as DraftLineItem,
      ],
      context,
      [],
      extractStatedPrices(SAID, []),
    );

    expect(
      result.contractorFlags.some((f) => f.includes("1,240") || f.includes("1240")),
      "silence here is how £8,593.20 of overcharge shipped",
    ).toBe(true);
  });
});
