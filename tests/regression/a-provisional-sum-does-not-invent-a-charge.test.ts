/**
 * A provisional sum holds a place. It does not name a price.
 *
 * `suggested_amount_pence` is the drafting model's own figure — invented by
 * definition, as the compiler said of it in as many words. It was charged
 * whenever `has_pricing_history` was true, on the reasoning that an established
 * account gives the contractor something to judge it against.
 *
 * That reasoning asked about the ACCOUNT when the question is about the ITEM. A
 * record of what this contractor pays for plaster grounds nothing about skip
 * hire, making good, or a bonding coat nobody mentioned.
 *
 * Two live quotes on 16 Sep, both for £250 of labour and nothing else, both
 * from contractors who had said there were no other charges:
 *
 *     job 43:  bonding £36 + waste £50, neither mentioned   ->  £336
 *     job 46:  a finish price they had SAID they did not
 *              know, filed as a £40 provisional             ->  £320
 *
 * "Provisional" is a label. What a customer reads is the number.
 *
 * So the figure goes and the LINE STAYS — unpriced, carrying its reason, which
 * is what a provisional sum is for. It also becomes visible to the out-of-scope
 * filter, which only ever considers lines with no price: a priced invention was
 * invisible to the one guard built to strip work the contractor excluded.
 */

import { describe, expect, it } from "vitest";
import { compileDraftToLineItems, type CompileContext } from "@/lib/compile-draft";
import { lineItemTotal } from "@/lib/quote-math";
import type { DraftLineItem } from "@/lib/schemas/job";

const context = (overrides: Partial<CompileContext> = {}): CompileContext => ({
  day_rate: 250,
  overtime_rate: null,
  markup_pct: 0,
  team_members: [],
  rate_cards: [],
  known_material_prices: [],
  owner_label: "Owner",
  // The state both runs were actually in: these contractors HAVE history.
  has_pricing_history: true,
  labour_plan: {
    people_count: 1,
    duration_days: 1,
    crew_description: "just me",
    crew_days: [{ name: "me", days: 1 }],
  },
  ...overrides,
});

const LABOUR: DraftLineItem = {
  kind: "labour",
  description: "Plastering labour – patch and skim 20 m² of wall",
  people: [{ ref: "me", days: 1 }],
  overtime: false,
  includes_tasks: [],
} as DraftLineItem;

const provisional = (description: string, pence: number, reason: string): DraftLineItem =>
  ({ kind: "provisional", description, suggested_amount_pence: pence, reason }) as DraftLineItem;

const compile = (drafts: DraftLineItem[], ctx = context()) =>
  compileDraftToLineItems(drafts, ctx, [], []);

const subtotal = (result: ReturnType<typeof compile>) =>
  result.lineItems.reduce((sum, item) => sum + lineItemTotal(item), 0);

describe("job 43 — £250 of labour, and no other charges", () => {
  const drafts = [
    LABOUR,
    provisional("Bonding coat if substrate requires additional preparation", 3600, "Substrate unknown"),
    provisional("Waste removal and disposal", 5000, "Volume unknown"),
  ];

  it("charges the labour and nothing else", () => {
    expect(subtotal(compile(drafts)), "£86 of work nobody mentioned").toBe(250);
  });

  it("keeps the placeholders, with their reasons", () => {
    const result = compile(drafts);
    const waste = result.lineItems.find((i) => i.description.startsWith("Waste removal"));

    expect(waste, "the placeholder is the useful part — the figure was not").toBeDefined();
    expect(waste?.unpriced).toBe(true);
    expect(waste?.assumption_note).toBe("Volume unknown");
  });
});

describe("job 46 — a price the contractor said they did not know", () => {
  it("is not answered with one the model does", () => {
    const drafts = [
      LABOUR,
      provisional("Finishing plaster – 8 bags of multi-finish", 4000, "Price not known yet"),
    ];

    expect(subtotal(compile(drafts))).toBe(250);
  });
});

describe("history does not ground a suggested sum", () => {
  it("makes no difference whether the contractor has priced work before", () => {
    const drafts = [LABOUR, provisional("Waste removal and disposal", 5000, "Volume unknown")];

    const established = subtotal(compile(drafts, context({ has_pricing_history: true })));
    const firstEver = subtotal(compile(drafts, context({ has_pricing_history: false })));

    expect(established).toBe(firstEver);
    expect(established).toBe(250);
  });
});

describe("what a provisional line is still for", () => {
  it("reaches the out-of-scope filter, which only looks at unpriced lines", () => {
    // The filter strips work the SoW put outside the quote. A priced invention
    // was invisible to it; an unpriced one is not.
    const result = compile(
      [LABOUR, provisional("Waste removal and disposal of plaster debris", 5000, "Volume unknown")],
      context({
        out_of_scope_notes: ["Waste removal and disposal of plaster debris is not included"],
      }),
    );

    expect(result.lineItems.some((i) => i.description.startsWith("Waste removal"))).toBe(false);
    expect(subtotal(result)).toBe(250);
  });
});
