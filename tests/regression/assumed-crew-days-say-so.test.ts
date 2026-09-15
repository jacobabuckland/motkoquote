/**
 * A labour line whose DAY COUNT nobody stated must say so.
 *
 * The labour line is priced from the contractor's own day rates, so its figure
 * has always been theirs. Its day count is the drafting model's, and nothing
 * distinguished a duration the contractor gave from one the model filled in:
 * both came out `assumed: false` with `provenance: contractor`.
 *
 * Voice run 05 (15 Sep 2026) had `labour_plan` null outright — no duration, no
 * crew — and the quote carried three people at eight days each, priced at real
 * rates and attributed to the contractor. Run 01 billed 13 person-days across
 * an owner, a plasterer and a labourer off a `crew_description` that never
 * counted them.
 *
 * This is the asymmetry D16 left open: a material with no price behind it comes
 * out flagged and unpriced, while the largest line on most quotes did not. The
 * fix labels the line rather than zeroing it — unlike a material, a labour line
 * has a real rate and a defensible figure, and replacing a number worth
 * checking with no number at all would be the worse trade.
 */

import { describe, expect, it } from "vitest";
import {
  ASSUMED_CREW_DAYS_NOTE,
  compileDraftToLineItems,
  crewDaysAreStated,
  hasAssumedCrewDaysFlag,
  type CompileContext,
  type CompileLabourPlan,
} from "@/lib/compile-draft";
import { lineItemTotal } from "@/lib/quote-math";
import type { DraftLineItem } from "@/lib/schemas/job";

const context = (labourPlan: CompileLabourPlan | null): CompileContext => ({
  day_rate: 250,
  overtime_rate: null,
  markup_pct: 20,
  team_members: [{ id: "tm-liam", name: "Liam", role: "Apprentice", day_rate: 120 }],
  rate_cards: [],
  known_material_prices: [],
  owner_label: "Owner",
  has_pricing_history: true,
  labour_plan: labourPlan,
});

const soloDraft: DraftLineItem[] = [
  {
    kind: "labour",
    description: "Skim walls and ceilings",
    people: [{ ref: "owner", days: 4 }],
    overtime: false,
    includes_tasks: [],
  },
];

const crewDraft: DraftLineItem[] = [
  {
    kind: "labour",
    description: "Skim walls and ceilings",
    people: [
      { ref: "owner", days: 4 },
      { ref: "tm-liam", days: 4 },
    ],
    overtime: false,
    includes_tasks: [],
  },
];

const labourLineFrom = (drafts: DraftLineItem[], plan: CompileLabourPlan | null) => {
  const result = compileDraftToLineItems(drafts, context(plan), [], []);
  const line = result.lineItems.find((item) => item.category === "labour");
  expect(line, "the fixture must produce a labour line").toBeDefined();
  return { line: line!, flags: result.contractorFlags };
};

describe("a labour line whose days nobody stated says so", () => {
  it("stays the contractor's when intake captured how long the job takes", () => {
    const { line, flags } = labourLineFrom(soloDraft, {
      people_count: 1,
      duration_days: 4,
      crew_description: null,
    });

    expect(line.assumed).toBe(false);
    expect(line.provenance?.source).toBe("contractor");
    expect(line.assumption_note ?? "").not.toContain(ASSUMED_CREW_DAYS_NOTE);
    expect(hasAssumedCrewDaysFlag(flags)).toBe(false);
  });

  it("is labelled an assumption when no labour plan was captured at all", () => {
    // Voice run 05: materials_supply, labour_plan and pricing all null, and the
    // quote still carried a confident multi-day crew.
    const { line, flags } = labourLineFrom(crewDraft, null);

    expect(line.assumed).toBe(true);
    expect(line.provenance?.source).toBe("system-generated");
    expect(line.assumption_note).toBe(ASSUMED_CREW_DAYS_NOTE);
    expect(hasAssumedCrewDaysFlag(flags)).toBe(true);
  });

  it("is labelled an assumption when a crew appears that nobody described", () => {
    // Run 01: a duration was captured, so the days look sourced — but the split
    // across three people came from nowhere.
    const { line } = labourLineFrom(crewDraft, {
      people_count: null,
      duration_days: 4,
      crew_description: null,
    });

    expect(line.assumed).toBe(true);
    expect(line.provenance?.source).toBe("system-generated");
  });

  it("does not demand a crew description for a one-person line", () => {
    // A single-person line is the contractor themselves. Requiring them to have
    // said so would flag almost every sole-trader quote.
    const { line } = labourLineFrom(soloDraft, {
      people_count: null,
      duration_days: 4,
      crew_description: null,
    });

    expect(line.assumed).toBe(false);
    expect(line.provenance?.source).toBe("contractor");
  });

  it("changes the label and nothing about the money", () => {
    // The point of labelling rather than zeroing: the figure is still the
    // contractor's rates over the model's days, and it stays on the quote to be
    // checked. A £0 here would read as "included at no charge".
    const stated = labourLineFrom(crewDraft, {
      people_count: 2,
      duration_days: 4,
      crew_description: "me and Liam",
    });
    const assumed = labourLineFrom(crewDraft, null);

    expect(lineItemTotal(assumed.line)).toBe(lineItemTotal(stated.line));
    expect(lineItemTotal(assumed.line)).toBe(4 * 250 + 4 * 120);
    expect(assumed.line.unpriced).toBeUndefined();
  });
});

describe("crewDaysAreStated", () => {
  it("requires a duration, and treats working dates as no substitute", () => {
    // `working_dates` records WHEN, not HOW LONG. Run 01's "four days" was
    // sitting there precisely because it is scheduling prose.
    expect(crewDaysAreStated(null, 1)).toBe(false);
    expect(crewDaysAreStated({ people_count: 2, duration_days: null }, 1)).toBe(false);
    expect(crewDaysAreStated({ people_count: null, duration_days: 4 }, 1)).toBe(true);
  });

  it("requires a crew only once the line carries more than one person", () => {
    const noCrew = { people_count: null, duration_days: 4, crew_description: "  " };

    expect(crewDaysAreStated(noCrew, 1)).toBe(true);
    expect(crewDaysAreStated(noCrew, 2)).toBe(false);
    expect(crewDaysAreStated({ ...noCrew, people_count: 2 }, 2)).toBe(true);
    expect(crewDaysAreStated({ ...noCrew, crew_description: "me and Liam" }, 2)).toBe(true);
  });
});
