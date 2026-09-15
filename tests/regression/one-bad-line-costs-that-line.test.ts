/**
 * A line the drafting model gets wrong costs that line, not the whole quote.
 *
 * `quoteDraftSchema.parse` threw, so one unusable line took the entire draft
 * with it — a ZodError out of the server action, HTTP 500 from POST /jobs/new,
 * and no quote at all. Voice run 14 on 15 Sep produced nothing for exactly that
 * reason, on release 8d9ffe5:
 *
 *   ZodError: path ["line_items", 1, "suggested_amount_pence"]
 *     "Too small: expected number to be >=0"
 *
 * That script asks for a 5% discount on base labour, and a negative provisional
 * sum is the only shape the model has for one. The schema is right to refuse
 * it — a negative provisional is not a charge anyone could raise — but refusing
 * the line should not cost the four lines around it.
 *
 * Same class as the `pricing.fixed_amount` fix in #766, on a different schema
 * and a different code path.
 */

import { describe, expect, it } from "vitest";
import { droppedDraftLineFlag, parseQuoteDraft } from "@/lib/schemas/job";

const labour = {
  kind: "labour",
  description: "Hall plastering",
  people: [{ ref: "owner", days: 4 }],
  overtime: false,
  includes_tasks: [],
};
const material = {
  kind: "material",
  description: "Finishing plaster",
  quantity: 20,
  unit: "bag",
  supplied_by: "contractor",
  estimated_unit_cost_pence: 1100,
};
const discount = {
  kind: "provisional",
  description: "5% discount on base labour",
  suggested_amount_pence: -10000,
  reason: "Agreed discount",
};

describe("one bad line costs that line", () => {
  it("keeps every line the model got right", () => {
    const { draft } = parseQuoteDraft({
      line_items: [labour, discount, material],
      contractor_flags: [],
    });

    expect(draft.line_items.map((l) => l.description)).toEqual([
      "Hall plastering",
      "Finishing plaster",
    ]);
  });

  it("reports the line it dropped, by name", () => {
    const { dropped } = parseQuoteDraft({
      line_items: [labour, discount, material],
      contractor_flags: [],
    });

    expect(dropped).toHaveLength(1);
    expect(dropped[0]?.description).toBe("5% discount on base labour");
  });

  it("says why in words a contractor can act on", () => {
    // Never the upstream prose (A6). "Too small: expected number to be >=0" is
    // accurate and useless to the person holding the quote.
    const { dropped } = parseQuoteDraft({
      line_items: [labour, discount],
      contractor_flags: [],
    });
    const flag = droppedDraftLineFlag(dropped[0]!);

    expect(flag).toContain("5% discount on base labour");
    expect(flag).toContain("reduction");
    expect(flag).not.toContain("Too small");
    expect(flag).not.toContain("suggested_amount_pence");
  });

  it("keeps the model's own contractor flags alongside", () => {
    const { draft } = parseQuoteDraft({
      line_items: [labour, discount],
      contractor_flags: ["A mate is helping Tuesday — confirm their day rate"],
    });

    expect(draft.contractor_flags).toEqual([
      "A mate is helping Tuesday — confirm their day rate",
    ]);
  });

  it("still throws when nothing usable survives", () => {
    // A quote with no lines is not a quote, which is what the schema's .min(1)
    // already said.
    expect(() => parseQuoteDraft({ line_items: [discount], contractor_flags: [] })).toThrow();
  });

  it("still throws when the response is not a draft at all", () => {
    expect(() => parseQuoteDraft({ nonsense: true })).toThrow();
  });

  it("changes nothing when every line is usable", () => {
    const { draft, dropped } = parseQuoteDraft({
      line_items: [labour, material],
      contractor_flags: [],
    });

    expect(dropped).toEqual([]);
    expect(draft.line_items).toHaveLength(2);
  });
});
