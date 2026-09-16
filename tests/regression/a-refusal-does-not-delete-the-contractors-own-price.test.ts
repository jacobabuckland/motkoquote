/**
 * The unsourced-line refusal must not zero a price the contractor gave.
 *
 * Once extraction finds any stated price, every line that matched none of them
 * is zeroed and flagged unpriced, so the model cannot slip an invented number
 * onto a quote the transcript never mentioned. That is the right guard, and it
 * was applied to every line kind — including the ones whose price never came
 * from the model at all. So the more the contractor said on the call, the more
 * of their own quote it deleted, and the messages it raised were false:
 *
 *   * A labour line priced from the crew and a £250 day rate came out £0 and
 *     raised "no day rate was found for this job. Add your day rate in Business
 *     details" — against the day rate that priced the line being zeroed. The
 *     send is blocked and the remedy named is one the contractor already did.
 *     `compileLabour` had ALREADY ruled on this, in its own provenance comment:
 *     a labour line has a real rate and a defensible figure, so zeroing it
 *     replaces a number worth checking with no number at all. This block was
 *     reversing that decision a hundred lines later.
 *   * A material matched to a CONFIRMED supplier price came out £0 and raised
 *     "this is your first quote, so there's no supplier price on file to work
 *     from" — with the price on file, which is how it reached the line.
 *
 * Provenance is attached by each compiler where the number is chosen, and
 * "contractor" means the contractor's own confirmed figures. A line carrying it
 * is sourced. What the refusal still catches is what it was built for: a
 * `system-generated` price standing on a line nobody mentioned.
 */

import { describe, expect, it } from "vitest";
import {
  UNRESOLVED_RATE_FLAG,
  UNSOURCED_PRICE_FLAG,
  compileDraftToLineItems,
  type CompileContext,
} from "@/lib/compile-draft";
import { lineItemTotal } from "@/lib/quote-math";
import type { DraftLineItem } from "@/lib/schemas/job";
import { extractStatedPrices } from "@/lib/voice/stated-prices";

const context = (): CompileContext => ({
  day_rate: 250,
  overtime_rate: null,
  markup_pct: 0,
  team_members: [
    { id: "t1", name: "Daniel", role: "Plasterer", day_rate: 220 },
    { id: "t2", name: "Liam", role: "Apprentice", day_rate: 150 },
  ],
  rate_cards: [],
  // A price this contractor has confirmed before — the opposite of "no supplier
  // price on file".
  known_material_prices: [{ description: "Backing plaster", unit: "bag", unit_price: 14.5 }],
  owner_label: "Jake",
  has_pricing_history: true,
  labour_plan: { people_count: 3, duration_days: 3, crew_description: "Me, Daniel and Liam" },
});

const drafts: DraftLineItem[] = [
  {
    kind: "labour",
    description: "Plastering works",
    people: [
      { ref: "me", days: 3 },
      { ref: "t1", days: 3 },
      { ref: "t2", days: 2 },
    ],
    overtime: false,
    includes_tasks: [],
  },
  {
    // The line the stated price belongs to, so it has its proper home and
    // nothing else has to be matched against it.
    kind: "material",
    description: "Finishing plaster",
    quantity: 26,
    unit: "bag",
    supplied_by: "contractor",
    estimated_unit_cost_pence: 5000,
  },
  {
    kind: "material",
    description: "Backing plaster",
    quantity: 8,
    unit: "bag",
    supplied_by: "contractor",
    estimated_unit_cost_pence: 5000,
  },
  {
    kind: "material",
    description: "Skip hire",
    quantity: 1,
    unit: "sum",
    supplied_by: "contractor",
    estimated_unit_cost_pence: 34000,
  },
  {
    kind: "provisional",
    description: "Making good",
    suggested_amount_pence: 20000,
    reason: "extent unknown until the walls are off",
  },
];

// The contractor priced ONE thing out loud — the finishing plaster. Nothing
// here mentions the labour, the backing plaster, the skip or the making good.
const compiled = () =>
  compileDraftToLineItems(
    drafts,
    context(),
    [],
    extractStatedPrices("We supply 26 bags of finishing plaster at £10.80 each.", []),
  );

const line = (description: string) =>
  compiled().lineItems.find((i) => i.description === description);

describe("a labour line the transcript never priced", () => {
  it("keeps the figure its rate and days produce", () => {
    const labour = line("Plastering works");

    expect(labour?.unpriced, "a real rate is not an unsourced price").toBeFalsy();
    expect(lineItemTotal(labour!)).toBeGreaterThan(0);
  });

  it("does not claim the day rate was missing", () => {
    // The flag names a remedy — "add your day rate in Business details" — that
    // the contractor has already done, and blocks the send until they do it
    // again. There is no way out of that through the interface.
    expect(compiled().contractorFlags).not.toContain(UNRESOLVED_RATE_FLAG);
  });
});

describe("a material at a price the contractor has confirmed", () => {
  it("keeps that price", () => {
    const backing = line("Backing plaster");

    expect(backing?.unit_price).toBe(14.5);
    expect(lineItemTotal(backing!)).toBe(116);
    expect(backing?.unpriced).toBeFalsy();
  });
});

describe("what the refusal is actually for", () => {
  it("still zeroes a material carrying only the model's estimate", () => {
    const skip = line("Skip hire");

    expect(skip?.unpriced, "£340 nobody said and nobody has ever confirmed").toBe(true);
    expect(skip?.unit_price).toBe(0);
    expect(skip?.provenance).toBeUndefined();
  });

  it("still zeroes a provisional sum the model suggested", () => {
    expect(line("Making good")?.unpriced).toBe(true);
  });

  it("still tells the contractor a material needs a price", () => {
    expect(compiled().contractorFlags).toContain(UNSOURCED_PRICE_FLAG);
  });
});

describe("a labour line with no rate behind it", () => {
  it("stays unpriced, because compileLabour is the one that decides", () => {
    // Exempting labour from the refusal must not exempt it from being unpriced
    // when there is genuinely no rate — that is the flag's true case, and it
    // is raised where the rate lookup fails, not here.
    const noRate: CompileContext = { ...context(), day_rate: null, team_members: [] };
    const result = compileDraftToLineItems(
      [drafts[0]!],
      noRate,
      [],
      extractStatedPrices("We supply 26 bags of finishing plaster at £10.80 each.", []),
    );

    expect(result.lineItems[0]?.unpriced).toBe(true);
    expect(result.contractorFlags).toContain(UNRESOLVED_RATE_FLAG);
  });
});
