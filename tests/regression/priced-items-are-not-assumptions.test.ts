import { describe, expect, it } from "vitest";
import { SOW_DELTA_TOOL_PARAMETERS } from "@/lib/schemas/sow";

// Bugs board: "Items with a stated price are demoted to ASSUMPTIONS on the SoW"
// (Quote Flow defect review, 28 Aug, §5 ticket S6).
//
// "Assuming main supplementary bonding upgrades are required" printed under
// ASSUMPTIONS on a customer-facing document. It had been dictated as a firm £90
// item with a stated reason. Presenting priced, agreed work as an assumption
// invites the customer to challenge something already settled.
//
// The classification happens at intake, and the tool description said only
// "Anything the contractor said they couldn't verify or might need to revisit".
// Nothing in it made a stated price disqualifying, so a firm figure with a
// rationale read as tentative and was filed as an unknown.
//
// WHY THE FIX IS HERE AND NOT IN THE RENDERER. The card's wake condition
// expected line-item provenance (PRICE-3, #443) to turn the downstream filter
// into "a lookup rather than a guess". It does not: provenance shipped as
// `{ source, transcript_span }` — where a line came from, not a link to the
// assumption it corresponds to. The only join available is still
// `matchStatedPrice`, which matches on two shared words of free text, and the
// card refused that deliberately: over-matching silently drops a genuine
// assumption from a customer document, and an unstated exclusion the customer
// never sees is how a contractor ends up doing unpriced work. That failure is
// worse than this one and invisible in the way this one is not.
//
// So this fixes where the bad classification is made rather than filtering it
// downstream on a guess.

const assumptionsDescription = (): string => {
  const params = SOW_DELTA_TOOL_PARAMETERS as {
    properties: Record<string, { description?: string }>;
  };
  const description = params.properties.assumptions_and_unknowns?.description;
  if (!description) throw new Error("assumptions_and_unknowns has no description");
  return description;
};

describe("the intake tool tells the model a stated price is not an unknown", () => {
  it("says a stated price disqualifies an item", () => {
    expect(assumptionsDescription().toLowerCase()).toMatch(/stated price disqualifies/);
  });

  it("says a rationale does not make a priced item an unknown", () => {
    // The reported item carried BOTH a figure and a reason, and the reason is
    // what made it read as tentative. Naming that pairing is the whole fix.
    const description = assumptionsDescription().toLowerCase();
    expect(description).toMatch(/reason|rationale/);
    expect(description).toMatch(/tentative|sounded/);
  });

  it("gives a worked pair — one priced, one genuinely unknown", () => {
    // A rule with only a prohibition tends to over-apply. The counter-example
    // is what keeps genuine unknowns in the list, which is the other half of
    // the acceptance criteria.
    const description = assumptionsDescription();
    expect(description).toMatch(/ninety quid|£90/i);
    expect(description).toMatch(/couldn't get at|IS an unknown/i);
  });

  it("still describes what the field is for", () => {
    // The original sentence must survive — this adds a disqualifier, it does
    // not replace the definition.
    expect(assumptionsDescription()).toMatch(/couldn't verify or might need to revisit/);
  });
});
