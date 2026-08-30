import { describe, expect, it } from "vitest";
import { SOW_DELTA_TOOL_PARAMETERS } from "@/lib/schemas/sow";

// PRICE-5's "the statement of work carries no pricing" clause, which the Bugs
// board item "SoW ADDITIONAL WORK section holds unquantified unit prices"
// (Quote Flow defect review §5, ticket S5) waits on.
//
// The reviewed SoW's "Additional work" section carried unit prices with no
// quantities on a document that shows no totals — 2 × £85 never resolved to
// £170, and the customer saw figures they could not reconcile against
// anything. Half-exposed pricing is worse than either full pricing or none.
//
// The renderer adds nothing: `sow-pdf.tsx` maps `sow.additional_items` as plain
// strings. The money was written INTO the content by the drafting model, so
// this is a generation problem and the constraint belongs at generation.
//
// Recorded in areas/motko.md, 28 Aug, Precedent: yes — the SoW is the scope
// document, the quote is the priced document.
//
// NOT DONE BY STRIPPING MONEY FROM PROSE AFTER THE FACT. PRICE-5's card is
// explicit, and it is right: a post-hoc regex fires on "supply and fit the £180
// board the customer chose" exactly as readily as on the invented kind, and
// AGENTS.md records five lost cycles to that class of fix. Constrain what is
// generated, then assert on the constraint.

const params = SOW_DELTA_TOOL_PARAMETERS as {
  properties: Record<string, { description?: string }>;
};

const describeField = (field: string): string => {
  const description = params.properties[field]?.description;
  if (!description) throw new Error(`${field} has no description`);
  return description;
};

const PROSE_FIELDS = ["inclusions", "exclusions", "additional_items"];

describe("SoW prose fields are told to carry no pricing", () => {
  for (const field of PROSE_FIELDS) {
    it(`${field} forbids monetary amounts`, () => {
      expect(describeField(field)).toMatch(/NO MONETARY AMOUNTS/);
    });

    it(`${field} says where a stated price belongs instead`, () => {
      // A prohibition with nowhere for the content to go invites the model to
      // drop the item. "Never leave a requested job out" is already the rule on
      // additional_items, so the two must not pull against each other.
      expect(describeField(field)).toMatch(/belongs on the quote/);
    });

    it(`${field} gives a worked contrast rather than only a rule`, () => {
      expect(describeField(field)).toMatch(/two extra double sockets/);
    });
  }

  it("keeps each field's own definition", () => {
    // The constraint is appended, never a replacement — the model still has to
    // know what the field is for.
    expect(describeField("inclusions")).toMatch(/making good included/);
    expect(describeField("exclusions")).toMatch(/kitchen sockets staying/);
    expect(describeField("additional_items")).toMatch(/never leave a requested job out/);
  });

  it("tells exclusions not to restate who supplies materials", () => {
    // PRICE-5's second inherited clause, and the other half of the
    // materials-responsibility defect (#413 shipped the rendering half). The
    // tradesperson said he supplied everything and the SoW's "Not included"
    // told the customer THEY were supplying — a model-written exclusion
    // contradicting the structured materials_supply field one section away.
    const exclusions = describeField("exclusions");
    expect(exclusions).toMatch(/materials_supply/);
    expect(exclusions).toMatch(/NEVER state who supplies materials/);
  });

  it("does not constrain fields that legitimately carry figures", () => {
    // The rule is about SoW PROSE. A blanket sweep would hit the fields whose
    // whole purpose is a number, and the quote is where prices belong.
    const pricing = params.properties.pricing?.description ?? "";
    expect(pricing).not.toMatch(/NO MONETARY AMOUNTS/);
  });
});
