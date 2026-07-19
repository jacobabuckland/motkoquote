import { describe, expect, it } from "vitest";
import { compileDraftToLineItems, type CompileContext } from "@/lib/compile-draft";
import { containsContractorDirectedLanguage } from "@/lib/contractor-language";
import type { DraftLineItem } from "@/lib/schemas/job";

// Task 4 — the two note channels must stay apart. customer_note rides onto
// the priced LineItem (renders on the document); contractor_flag and job-wide
// flags are routed into CompileResult.contractorFlags and NEVER touch a line.

const ctx: CompileContext = {
  day_rate: 300,
  overtime_rate: null,
  markup_pct: 20,
  team_members: [],
  rate_cards: [{ id: "rc-rad", work_type: "Radiator swap", unit: "radiator", rate_per_unit: 140 }],
  known_material_prices: [],
  owner_label: "Owner",
};

describe("note channels", () => {
  it("routes customer_note onto the line and contractor_flag off it", () => {
    const drafts: DraftLineItem[] = [
      {
        kind: "material",
        description: "Bathroom suite",
        quantity: 1,
        unit: "set",
        supplied_by: "customer",
        customer_note: "Supplied by you as agreed",
        contractor_flag: "Verify the customer's chosen suite is in stock",
      },
    ];

    const { lineItems, contractorFlags } = compileDraftToLineItems(drafts, ctx);

    const line = lineItems[0]!;
    expect(line.customer_note).toBe("Supplied by you as agreed");
    // The contractor-directed flag is nowhere on the customer-facing line.
    expect(JSON.stringify(line)).not.toContain("Verify the customer's chosen suite");
    expect(contractorFlags).toContain("Bathroom suite: Verify the customer's chosen suite is in stock");
  });

  it("passes job-wide flags through untouched and keeps them off every line", () => {
    const drafts: DraftLineItem[] = [
      {
        kind: "rate_card",
        rate_card_id: "rc-rad",
        quantity: 1,
        description: "Radiator swap",
      },
    ];

    const jobFlags = ["A mate is helping Tuesday — confirm their day rate"];
    const { lineItems, contractorFlags } = compileDraftToLineItems(drafts, ctx, jobFlags);

    expect(contractorFlags).toContain("A mate is helping Tuesday — confirm their day rate");
    for (const line of lineItems) {
      expect(line.customer_note ?? "").not.toContain("mate is helping");
    }
  });

  it("never emits a contractor flag when no notes are present", () => {
    const drafts: DraftLineItem[] = [
      { kind: "rate_card", rate_card_id: "rc-rad", quantity: 1, description: "Radiator swap" },
    ];
    const { contractorFlags } = compileDraftToLineItems(drafts, ctx);
    expect(contractorFlags).toEqual([]);
  });

  it("no customer_note on any compiled line reads as contractor-directed", () => {
    const drafts: DraftLineItem[] = [
      {
        kind: "material",
        description: "Tile adhesive",
        quantity: 1,
        unit: "job",
        estimated_unit_cost_pence: 8000,
        supplied_by: "contractor",
        customer_note: "Neutral grout to match the tiles",
      },
    ];
    const { lineItems } = compileDraftToLineItems(drafts, ctx);
    for (const line of lineItems) {
      if (line.customer_note) {
        expect(containsContractorDirectedLanguage(line.customer_note)).toBe(false);
      }
    }
  });
});

describe("contractor-directed language guard", () => {
  it("flags app/contractor-directed phrases", () => {
    const bad = [
      "Verify Liam's day rate before issuing",
      "Markup to be applied by the app",
      "Adjust once you confirm the supplier price",
      "Confirm the tile count before sending",
      "Apprentice rate — check the contractor",
    ];
    for (const text of bad) {
      expect(containsContractorDirectedLanguage(text)).toBe(true);
    }
  });

  it("passes genuine customer-facing notes", () => {
    const good = [
      "Supplied by you as agreed",
      "Neutral grout to match the tiles",
      "Includes making good after removal",
      "Two coats of primer on bare plaster",
    ];
    for (const text of good) {
      expect(containsContractorDirectedLanguage(text)).toBe(false);
    }
  });
});
