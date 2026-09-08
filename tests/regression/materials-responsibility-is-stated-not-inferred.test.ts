/**
 * Who supplies the materials is a stated fact, not one inferred from which
 * list happens to be empty.
 *
 * P2·15 was carded as a granularity preference — "plaster" as an item is the
 * schema working as designed, so changing it is a product call. Production says
 * it is a correctness defect, and the shape is one the old question invites.
 *
 * Job f453b3ae (8 Sep, £7,200 plastering) captured:
 *
 *   materials_supply: { customer_supplied: ["plaster"], contractor_supplied: [] }
 *
 * The contractor said the customer was bringing the plaster — naming what the
 * OTHER party supplies is the natural way to say it. `materialsResponsibility`
 * reads `contractor_supplied.length === 0` as "the contractor supplies
 * nothing", returns "Customer" with no notes, and the contract clause renders:
 *
 *   Materials will be supplied by: **Customer**.
 *
 * on a job where the plasterer is supplying everything except the plaster. That
 * allocates the materials cost to the wrong party on a document somebody signs.
 * Job 7215aa49 has the same shape with the literal item "Materials".
 *
 * So the fix is to ask the binary and record it: `responsibility` says who is
 * responsible overall, the lists say which specific items are exceptions, and
 * nothing is inferred from an empty array.
 *
 * LEGACY ROWS ARE UNCHANGED. Every SOW written before this has no
 * `responsibility`, and for those the old derivation still runs exactly as it
 * did — see tests/regression/materials-responsibility-agreement.test.ts, which
 * passes untouched. A silent reinterpretation of stored rows would be a worse
 * defect than the one being fixed.
 */

import { describe, expect, it } from "vitest";

import { contractPrefillFromJob } from "@/lib/contract-prefill";
import { materialsResponsibility } from "@/lib/materials-summary";
import { materialsSupplySchema, type MaterialsSupply } from "@/lib/schemas/job";

describe("the stated answer wins over the shape of the lists", () => {
  it("says Contractor when the contractor said so, whatever the lists hold", () => {
    expect(
      materialsResponsibility({
        responsibility: "contractor",
        contractor_supplied: [],
        customer_supplied: [],
      }).by,
    ).toBe("Contractor");
  });

  it("says Customer when the contractor said the customer supplies it all", () => {
    expect(
      materialsResponsibility({
        responsibility: "customer",
        contractor_supplied: [],
        customer_supplied: [],
      }).by,
    ).toBe("Customer");
  });

  it("reads job f453b3ae the way the contractor meant it", () => {
    // The production row, re-captured under the new question: the contractor
    // supplies the job, the customer brings the plaster.
    const materials = materialsResponsibility({
      responsibility: "split",
      contractor_supplied: [],
      customer_supplied: ["plaster"],
    });

    expect(materials.by).toBe("Contractor and customer (see notes)");
    expect(materials.notes).toContain("plaster");
    // And emphatically NOT the clause that would have been signed.
    expect(materials.by).not.toBe("Customer");
  });

  it("never loses an itemised material, whatever the headline says", () => {
    // The notes carry whatever was named, so a document can never state a
    // headline that silently drops something the customer must provide.
    const materials = materialsResponsibility({
      responsibility: "contractor",
      contractor_supplied: ["adhesive"],
      customer_supplied: ["tiles"],
    });

    expect(materials.notes).toContain("adhesive");
    expect(materials.notes).toContain("tiles");
  });
});

describe("rows written before this are read exactly as before", () => {
  const legacy = (supply: Omit<MaterialsSupply, "responsibility">): ReturnType<
    typeof materialsResponsibility
  > => materialsResponsibility(supply);

  it("still derives Contractor from a contractor-only list", () => {
    expect(legacy({ contractor_supplied: ["cable"], customer_supplied: [] }).by).toBe(
      "Contractor",
    );
  });

  it("still derives Customer from a customer-only list", () => {
    // Unchanged deliberately, even though this is the shape that was misread:
    // reinterpreting stored rows would be a worse defect than the original.
    expect(legacy({ contractor_supplied: [], customer_supplied: ["tiles"] }).by).toBe(
      "Customer",
    );
  });

  it("still derives a split from two populated lists", () => {
    expect(
      legacy({ contractor_supplied: ["adhesive"], customer_supplied: ["tiles"] }).by,
    ).toBe("Contractor and customer (see notes)");
  });

  it("still stays blank when the question was never answered", () => {
    expect(materialsResponsibility(null)).toEqual({ by: "", notes: "" });
    expect(legacy({ contractor_supplied: [], customer_supplied: [] })).toEqual({
      by: "",
      notes: "",
    });
  });
});

describe("the schema accepts the field and defaults it away", () => {
  it("leaves responsibility ABSENT on a row that omits it", () => {
    // Optional with no default, like pricing.mode: an absent answer stays
    // absent rather than becoming a value nobody gave. It also means every
    // fixture written before this still satisfies the type, so no frozen
    // acceptance test needs widening and the pipeline harness's recorded
    // prompt hashes still match.
    const parsed = materialsSupplySchema.parse({
      contractor_supplied: ["cable"],
      customer_supplied: [],
    });

    expect(parsed.responsibility).toBeUndefined();
    expect("responsibility" in parsed).toBe(false);
  });

  it("accepts each of the three answers and nothing else", () => {
    for (const answer of ["contractor", "customer", "split"]) {
      expect(
        materialsSupplySchema.parse({ responsibility: answer }).responsibility,
      ).toBe(answer);
    }
    expect(
      materialsSupplySchema.safeParse({ responsibility: "both" }).success,
    ).toBe(false);
  });
});

describe("what reaches the contract form", () => {
  it("carries the stated answer through to the contract's materials clause", () => {
    const prefill = contractPrefillFromJob({
      customer: null,
      extracted_json: {
        materials_supply: {
          responsibility: "contractor",
          contractor_supplied: [],
          customer_supplied: [],
        },
      },
    });

    // The clause renders "Materials will be supplied by: **{{materials_by}}**",
    // so a blank here is a contract that says nothing about materials at all —
    // which is what "I'm supplying everything" used to produce.
    expect(prefill.materials_by).toBe("Contractor");
  });
});
