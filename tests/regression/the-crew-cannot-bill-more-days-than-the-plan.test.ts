/**
 * The drafting model may not bill more days than the contractor described.
 *
 * #762 labels days nobody stated. This is the other half, and it is the one
 * that costs real money: days the contractor DID state, which the model then
 * ignored. On voice run 11 the contractor said owner 3.5, Daniel 5, Liam 2 —
 * ten and a half person-days — and the quote billed TEN DAYS EACH for all
 * three. £6,200 against £2,275, on a line that looked entirely sourced: a
 * duration and a crew had both been captured, so nothing flagged.
 *
 * `labour_plan` records how long and how many, never the per-person split, so
 * the most it yields is a CEILING — everyone on site every day. That
 * over-counts a staggered crew on purpose: a ceiling is a guard, not a
 * correction, and it must never pull an honest quote down.
 */

import { describe, expect, it } from "vitest";
import {
  CAPPED_CREW_DAYS_NOTE,
  capCrewDaysToStatedPlan,
  compileDraftToLineItems,
  hasCappedCrewDaysFlag,
  type CompileContext,
  type CompileLabourPlan,
} from "@/lib/compile-draft";
import { lineItemTotal } from "@/lib/quote-math";
import type { DraftLineItem, LinePerson } from "@/lib/schemas/job";

const context = (labourPlan: CompileLabourPlan | null): CompileContext => ({
  day_rate: 250,
  overtime_rate: null,
  markup_pct: 0,
  team_members: [
    { id: "tm-daniel", name: "Daniel", role: "Plasterer", day_rate: 220 },
    { id: "tm-liam", name: "Liam", role: "Apprentice", day_rate: 150 },
  ],
  rate_cards: [],
  known_material_prices: [],
  owner_label: "Owner",
  has_pricing_history: true,
  labour_plan: labourPlan,
});

// What run 11's draft actually produced: ten days for everyone.
const runawayDraft: DraftLineItem[] = [
  {
    kind: "labour",
    description: "Plastering labour",
    people: [
      { ref: "owner", days: 10 },
      { ref: "tm-daniel", days: 10 },
      { ref: "tm-liam", days: 10 },
    ],
    overtime: false,
    includes_tasks: [],
  },
];

const compile = (drafts: DraftLineItem[], plan: CompileLabourPlan | null) => {
  const result = compileDraftToLineItems(drafts, context(plan), [], []);
  const line = result.lineItems.find((item) => item.category === "labour");
  expect(line, "the fixture must produce a labour line").toBeDefined();
  return { line: line!, flags: result.contractorFlags };
};

describe("the crew cannot bill more days than the plan allows", () => {
  it("scales a runaway crew back to the stated ceiling", () => {
    // Three people over five days is at most fifteen person-days. The draft
    // asked for thirty.
    const { line } = compile(runawayDraft, {
      people_count: 3,
      duration_days: 5,
      crew_description: "me, Daniel and Liam",
    });

    expect(line.people?.reduce((sum, p) => sum + p.days, 0)).toBe(15);
    // Half of what the draft wanted, so half the money: the uncapped line
    // billed 10×250 + 10×220 + 10×150 = £6,200.
    expect(lineItemTotal(line)).toBe(3100);
  });

  it("says so, on the line and to the contractor", () => {
    const { line, flags } = compile(runawayDraft, {
      people_count: 3,
      duration_days: 5,
      crew_description: "me, Daniel and Liam",
    });

    expect(line.assumed).toBe(true);
    expect(line.assumption_note).toBe(CAPPED_CREW_DAYS_NOTE);
    expect(line.provenance?.source).toBe("system-generated");
    expect(hasCappedCrewDaysFlag(flags)).toBe(true);
    expect(flags.find((f) => f.startsWith("Labour days were reduced:"))).toContain("15");
  });

  it("leaves an honest quote completely alone", () => {
    // Owner 3.5, Daniel 5, Liam 2 — what run 11's contractor actually said.
    // Ten and a half person-days against a ceiling of fifteen.
    const honest: DraftLineItem[] = [
      {
        kind: "labour",
        description: "Plastering labour",
        people: [
          { ref: "owner", days: 3.5 },
          { ref: "tm-daniel", days: 5 },
          { ref: "tm-liam", days: 2 },
        ],
        overtime: false,
        includes_tasks: [],
      },
    ];
    const { line, flags } = compile(honest, {
      people_count: 3,
      duration_days: 5,
      crew_description: "me, Daniel and Liam",
    });

    expect(lineItemTotal(line)).toBe(3.5 * 250 + 5 * 220 + 2 * 150);
    expect(line.assumed).toBe(false);
    expect(line.provenance?.source).toBe("contractor");
    expect(hasCappedCrewDaysFlag(flags)).toBe(false);
  });
});

describe("capCrewDaysToStatedPlan", () => {
  const crew: LinePerson[] = [
    { label: "Owner", days: 10, day_rate: 250 },
    { label: "Daniel", days: 10, day_rate: 220 },
  ];

  it("does nothing without both a duration and a head count", () => {
    expect(capCrewDaysToStatedPlan(crew, null)).toBeNull();
    expect(capCrewDaysToStatedPlan(crew, { people_count: 2, duration_days: null })).toBeNull();
    expect(capCrewDaysToStatedPlan(crew, { people_count: null, duration_days: 5 })).toBeNull();
  });

  it("never scales a crew UP", () => {
    // Fewer days than the plan allows is a deliberate choice, not an error.
    const lean: LinePerson[] = [{ label: "Owner", days: 1, day_rate: 250 }];
    expect(capCrewDaysToStatedPlan(lean, { people_count: 2, duration_days: 5 })).toBeNull();
  });

  it("tolerates a small overshoot rather than firing on rounding", () => {
    // Ceiling 10, and 10.4 is within the 5% the guard allows.
    const nearly: LinePerson[] = [{ label: "Owner", days: 10.4, day_rate: 250 }];
    expect(capCrewDaysToStatedPlan(nearly, { people_count: 2, duration_days: 5 })).toBeNull();
  });

  it("scales every person by the same factor", () => {
    // The split is exactly what the compiler does not know, so it does not
    // invent a new one.
    const capped = capCrewDaysToStatedPlan(crew, { people_count: 2, duration_days: 5 });

    expect(capped?.ceilingDays).toBe(10);
    expect(capped?.proposedDays).toBe(20);
    expect(capped?.people.map((p) => p.days)).toEqual([5, 5]);
  });
});
