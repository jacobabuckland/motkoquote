import { describe, expect, it } from "vitest";
import { materialsSummary } from "@/lib/materials-summary";

// The statement of work rendered the materials list twice: once bare from
// materials_mentioned, and once under "Supplied by us:" from materials_supply.
// The two fields overlap by construction — the supply question attributes the
// materials that were already named — so on the reviewed job the whole list
// appeared twice inside one panel.

describe("materialsSummary", () => {
  it("does not repeat a material that has been attributed", () => {
    const summary = materialsSummary(
      ["consumer unit", "SWA cable", "outdoor socket"],
      { contractor_supplied: ["consumer unit", "SWA cable", "outdoor socket"], customer_supplied: [] },
    );

    expect(summary.unattributed).toEqual([]);
    expect(summary.supplySentence).toBe(
      "Supplied by us: consumer unit, SWA cable, outdoor socket.",
    );
  });

  it("still states a material nobody was attributed", () => {
    const summary = materialsSummary(
      ["consumer unit", "back boxes"],
      { contractor_supplied: ["consumer unit"], customer_supplied: [] },
    );

    expect(summary.unattributed).toEqual(["back boxes"]);
    expect(summary.supplySentence).toBe("Supplied by us: consumer unit.");
  });

  it("matches across case and a trailing full stop", () => {
    const summary = materialsSummary(
      ["Copper pipe and fittings."],
      { contractor_supplied: ["copper pipe and fittings"], customer_supplied: [] },
    );

    expect(summary.unattributed).toEqual([]);
  });

  it("attributes both sides when responsibility is split", () => {
    const summary = materialsSummary(
      ["consumer unit", "tiles"],
      { contractor_supplied: ["consumer unit"], customer_supplied: ["tiles"] },
    );

    expect(summary.unattributed).toEqual([]);
    expect(summary.supplySentence).toBe(
      "Supplied by us: consumer unit. Supplied by customer: tiles.",
    );
  });

  it("falls back to the bare list when the supply question was never answered", () => {
    const summary = materialsSummary(["consumer unit", "SWA cable"], null);

    expect(summary.unattributed).toEqual(["consumer unit", "SWA cable"]);
    expect(summary.supplySentence).toBeNull();
  });

  it("does not invent a supplier for an unattributed material", () => {
    // The unattributed list is stated without an implied supplier — guessing
    // one is the failure class this whole review is about.
    const summary = materialsSummary(["back boxes"], {
      contractor_supplied: [],
      customer_supplied: [],
    });

    expect(summary.unattributed).toEqual(["back boxes"]);
    expect(summary.supplySentence).toBeNull();
  });
});
