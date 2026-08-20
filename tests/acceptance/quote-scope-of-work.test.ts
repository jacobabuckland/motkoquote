// Acceptance: the customer's quote carries the scope of works.
//
// The scope was captured, schema-validated, persisted to jobs.sow_json and
// rendered in full — onto SowPdf, which is served from an authenticated,
// tenant-scoped route only the contractor can open. The customer-facing quote
// never loaded the column: renderQuotePdf's select did not mention sow_json,
// and QuotePdfPayload had no field to put it in.
//
// In fixed-price mode that left the customer one line reading "Rewire works as
// described", where "described" referred to a document they had never been
// sent. The phrase pointed at nothing.
import { describe, expect, it } from "vitest";
import { buildQuoteScope, type QuotePdfPayload } from "@/lib/pdf/quote-payload";
import { deriveWorksDescription, applyPricingMode } from "@/lib/pricing-mode";
import { EMPTY_SOW_STATE, synthesizeTimeline, type SowState } from "@/lib/schemas/sow";
import type { LineItem } from "@/lib/schemas/job";

const line = (over: Partial<LineItem> & Pick<LineItem, "description" | "category">): LineItem => ({
  quantity: 1,
  unit: "day",
  unit_price: 100,
  multiplier: 1,
  people_count: 1,
  overtime: false,
  assumed: false,
  ...over,
});

const CREW_LINE = line({
  description: "Rewire",
  category: "labour",
  quantity: 3,
  unit_price: 340,
  people: [
    { label: "Owner", days: 3, day_rate: 340 },
    { label: "Liam", days: 3, day_rate: 120 },
  ],
});

const FULL_SOW: SowState = {
  ...EMPTY_SOW_STATE,
  job_type: "rewire",
  overview_narrative: "A full rewire of a three-bed semi over three working days.",
  rooms: [
    { name: "Kitchen", dimensions: "4m x 3m", work_items: ["Replace 6 sockets", "Move the spur"] },
    { name: "Landing", dimensions: undefined, work_items: ["Two-way switch"] },
  ],
  additional_items: ["Haul rubbish away"],
  existing_conditions: "Old rubber cable throughout.",
  access_issues: "No working before 9am — baby sleeps.",
  inclusions: ["Making good the chases"],
  exclusions: ["Kitchen sockets staying"],
  materials_mentioned: ["6mm twin and earth"],
  materials_supply: { contractor_supplied: ["Cable"], customer_supplied: ["Light fittings"] },
  assumptions_and_unknowns: [
    { description: "Soil stack condition unknown", treatment: "provisional_sum" },
  ],
  labour_plan: { people_count: 1, duration_days: 3, crew_description: "just me" },
};

describe("buildQuoteScope — what the customer is allowed to read", () => {
  it("projects every customer-facing field off the SoW", () => {
    const scope = buildQuoteScope(FULL_SOW, [CREW_LINE]);
    if (!scope) throw new Error("expected a scope");

    expect(scope.overviewNarrative).toContain("three-bed semi");
    expect(scope.rooms.map((r) => r.name)).toEqual(["Kitchen", "Landing"]);
    expect(scope.rooms[0].workItems).toEqual(["Replace 6 sockets", "Move the spur"]);
    expect(scope.rooms[0].dimensions).toBe("4m x 3m");
    expect(scope.additionalItems).toEqual(["Haul rubbish away"]);
    expect(scope.existingConditions).toContain("rubber cable");
    expect(scope.accessIssues).toContain("9am");
    expect(scope.inclusions).toEqual(["Making good the chases"]);
    expect(scope.exclusions).toEqual(["Kitchen sockets staying"]);
    expect(scope.materialsMentioned).toEqual(["6mm twin and earth"]);
    expect(scope.assumptions).toEqual(["Soil stack condition unknown"]);
  });

  it("takes the crew size from the PRICING, so the timeline cannot understate the team", () => {
    // labour_plan says 1 person; the priced line carries two. The Fenland
    // "1-person team" bug is exactly this disagreement, and synthesizeTimeline
    // accepts an override for it.
    const scope = buildQuoteScope(FULL_SOW, [CREW_LINE]);
    expect(scope?.timeline).toContain("2-person team");
    expect(scope?.timeline).toBe(synthesizeTimeline(FULL_SOW, 2));
  });

  it("carries NOTHING addressed to the contractor", () => {
    const scope = buildQuoteScope(
      {
        ...FULL_SOW,
        next_question: "Ask about the consumer unit",
        wrap_incomplete: true,
        unasked_required: ["crew"],
      },
      [CREW_LINE],
    );
    const serialised = JSON.stringify(scope);

    expect(serialised).not.toContain("Ask about the consumer unit");
    expect(serialised).not.toContain("wrap_incomplete");
    expect(serialised).not.toContain("unasked_required");
    expect(serialised).not.toContain("next_question");
  });

  it("returns null when the call was too thin to describe anything", () => {
    expect(buildQuoteScope({ ...EMPTY_SOW_STATE, job_type: "rewire" }, [CREW_LINE])).toBeNull();
  });

  it("returns a scope on any single populated field", () => {
    expect(
      buildQuoteScope({ ...EMPTY_SOW_STATE, inclusions: ["Making good"] }, [CREW_LINE]),
    ).not.toBeNull();
  });

  it("drops a room that carries neither work items nor dimensions", () => {
    const scope = buildQuoteScope(
      { ...FULL_SOW, rooms: [...FULL_SOW.rooms, { name: "Loft", dimensions: undefined, work_items: [] }] },
      [CREW_LINE],
    );
    expect(scope?.rooms.map((r) => r.name)).not.toContain("Loft");
  });
});

describe("the works line no longer points at nothing", () => {
  it("refers to the scope section when the document has one", () => {
    expect(deriveWorksDescription("rewire", true)).toBe("Rewire works — see Scope of work");
  });

  it("promises nothing when it does not", () => {
    expect(deriveWorksDescription("rewire", false)).toBe("Rewire works");
  });

  it("never emits the dangling phrase, on any input", () => {
    for (const jobType of ["rewire", "", "   ", "plastering"]) {
      for (const hasScope of [true, false]) {
        expect(deriveWorksDescription(jobType, hasScope)).not.toContain("as described");
      }
    }
  });

  it("fixed-price mode still collapses to one priced line, now with a real reference", () => {
    const sow = {
      ...FULL_SOW,
      pricing: { mode: "fixed" as const, fixed_amount: 2000 },
    };
    const active = applyPricingMode([CREW_LINE], sow, true);

    expect(active).toHaveLength(1);
    expect(active[0].description).toBe("Rewire works — see Scope of work");
    expect(active[0].unit_price).toBe(2000);
  });

  it("itemised mode keeps the full breakdown, and gets the scope section too", () => {
    const sow = { ...FULL_SOW, pricing: { mode: "days" as const, fixed_amount: null } };
    const active = applyPricingMode([CREW_LINE], sow, true);

    // Unchanged: the breakdown is the document in this mode.
    expect(active).toEqual([CREW_LINE]);
    // And the scope still renders — itemised quotes shipped with no timeline,
    // no inclusions and no assumptions either.
    expect(buildQuoteScope(sow, active)).not.toBeNull();
  });
});

describe("the payload keeps scope optional, so nothing existing moves", () => {
  it("accepts a payload with no scope at all", () => {
    const payload: QuotePdfPayload = {
      reference: "ABCD1234",
      createdAt: "2026-03-14T09:30:00.000Z",
      lineItems: [CREW_LINE],
      contractor: null,
      customer: null,
    };
    expect(payload.scope).toBeUndefined();
  });
});

describe("the stored path actually loads the column it never read", () => {
  it("renderQuotePdf selects sow_json", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const source = readFileSync(
      path.join(__dirname, "..", "..", "src", "lib", "pdf", "render-quote.ts"),
      "utf8",
    );
    expect(source).toContain("sow_json");
  });

  it("guest quotes carry scope through to their payload", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const source = readFileSync(
      path.join(__dirname, "..", "..", "src", "lib", "guest", "pdf.ts"),
      "utf8",
    );
    expect(source).toContain("scope: quote.scope");
  });
});
