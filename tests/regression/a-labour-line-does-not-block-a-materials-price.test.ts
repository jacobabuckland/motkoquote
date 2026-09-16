/**
 * A line that cannot take the money does not get a vote on who does.
 *
 * #796 stopped one stated price charging several lines: a price contested by
 * more than one line is refused rather than guessed at. It counted every
 * description that MATCHED, and that was wrong within hours.
 *
 * Labour descriptions are prose. Run 2 of the 16 Sep tranche read:
 *
 *   "Plastering labour – prep and skim walls in two bedrooms (approx. 40 sq
 *    metres). Includes surface preparation, APPLYING FINISHING PLASTER, and
 *    making good throughout…"
 *
 * so it matched the stated £11.00 for "finishing plaster", contested it with
 * the materials line that was actually meant to have it, and both came away
 * with nothing. £965 against £1,053 on an ordinary two-bedroom quote (job
 * 99e90b36) — the bags were counted correctly and then priced at zero.
 *
 * That labour line could never have been priced from it. PFIX-3 refuses a
 * stated price on a line priced from a crew breakdown outright, because
 * `lineItemTotal` goes on preferring the breakdown whatever `unit_price` says.
 * So it was blocking a payment it could not itself receive.
 *
 * Contention is now counted among lines that could actually take the money. A
 * price matching ONLY a crew-priced labour line still resolves to it, so PFIX-3
 * still fires and still tells the contractor — it just no longer does so at the
 * expense of the line the money belonged to.
 */

import { describe, expect, it } from "vitest";
import {
  LABOUR_LOCK_REFUSED_PREFIX,
  UNATTACHED_STATED_PRICE_PREFIX,
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
  team_members: [{ id: "t1", name: "Daniel", role: "Plasterer", day_rate: 220 }],
  rate_cards: [],
  known_material_prices: [],
  owner_label: "Owner",
  has_pricing_history: false,
  labour_plan: {
    people_count: null,
    duration_days: 2,
    crew_description: "me and Daniel",
    crew_days: [
      { name: "me", days: 2 },
      { name: "Daniel", days: 2 },
    ],
  },
});

/** Run 2's labour line, verbatim — the prose is the whole point. */
const VERBOSE_LABOUR: DraftLineItem = {
  kind: "labour",
  description:
    "Plastering labour – prep and skim walls in two bedrooms (approx. 40 sq metres). " +
    "Includes surface preparation, applying finishing plaster, and making good throughout. " +
    "Floors protected and full clean-up on completion. Ceilings and decorating excluded.",
  people: [
    { ref: "me", days: 2 },
    { ref: "t1", days: 2 },
  ],
  overtime: false,
  includes_tasks: [],
} as DraftLineItem;

const PLASTER: DraftLineItem = {
  kind: "material",
  description: "Finishing plaster – two bedrooms wall skim",
  quantity: 8,
  unit: "bag",
  supplied_by: "contractor",
  estimated_unit_cost_pence: 1000,
} as DraftLineItem;

const SENTENCE = "Eight bags of finishing plaster at eleven pounds a bag.";

const compiled = (drafts: DraftLineItem[], sentence = SENTENCE) =>
  compileDraftToLineItems(drafts, context(), [], extractStatedPrices(sentence, []));

describe("a materials price named inside a labour description", () => {
  it("still reaches the materials line", () => {
    const result = compiled([VERBOSE_LABOUR, PLASTER]);
    const plaster = result.lineItems.find((i) => i.description === PLASTER.description);

    expect(plaster?.unit_price, "the bags were counted and then priced at zero").toBe(11);
    expect(lineItemTotal(plaster!)).toBe(88);
  });

  it("leaves the whole quote at the figure the contractor described", () => {
    const result = compiled([VERBOSE_LABOUR, PLASTER]);

    expect(result.lineItems.reduce((sum, i) => sum + lineItemTotal(i), 0)).toBe(1028);
  });

  it("does not report the price as homeless", () => {
    const result = compiled([VERBOSE_LABOUR, PLASTER]);

    expect(
      result.contractorFlags.some((f) => f.startsWith(UNATTACHED_STATED_PRICE_PREFIX)),
      "it is on a line — the materials line it names",
    ).toBe(false);
  });
});

describe("PFIX-3, which must still fire", () => {
  it("refuses a price aimed at a crew-priced labour line, and says so", () => {
    // No materials line to want it: labour is the only match, so the refusal
    // is the whole answer and the contractor has to be told.
    const result = compiled([VERBOSE_LABOUR], "The plastering labour is five hundred and twenty pounds.");
    const labour = result.lineItems.find((i) => i.category === "labour");

    expect(lineItemTotal(labour!), "the crew breakdown still governs").toBe(940);
    expect(
      result.contractorFlags.some((f) => f.startsWith(LABOUR_LOCK_REFUSED_PREFIX)),
    ).toBe(true);
  });
});

describe("the refusal #796 added, which must also still fire", () => {
  it("still refuses a price two PRICEABLE lines both answer to", () => {
    const result = compiled(
      [
        { ...PLASTER, description: "Bonding and multi-finish plaster materials" } as DraftLineItem,
        { ...PLASTER, description: "Plasterboard and finish plaster" } as DraftLineItem,
      ],
      "Materials are 18 bags of finish at £11.50.",
    );

    expect(result.lineItems.every((i) => i.unpriced === true)).toBe(true);
    expect(
      result.contractorFlags.some((f) => f.startsWith(UNATTACHED_STATED_PRICE_PREFIX)),
    ).toBe(true);
  });
});
