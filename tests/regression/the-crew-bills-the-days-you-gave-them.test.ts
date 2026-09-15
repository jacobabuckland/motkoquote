/**
 * Days stated per person are the days billed per person.
 *
 * #768 gave the crew a ceiling. A ceiling is a bound, and a bound cannot fix a
 * crew whose TOTAL is right and whose SPLIT is wrong — which is what voice run
 * 16 was. The contractor said 2 / 3 / 1; the draft billed two days each. Six
 * person-days either way, so no ceiling could ever have seen it, and the owner
 * at £250 and the labourer at £150 are not interchangeable: £1,240 billed
 * against £1,310.
 *
 * `labour_plan` had nowhere to put the split — `people_count` and
 * `duration_days` answer how many and how long — so `crew_days` is new. It also
 * gives the ceiling something exact to be: runs 18 and 20 left `people_count`
 * null (18 put the SUM of the person-days into `duration_days`, 20 put the
 * owner's own days there), and the ceiling needs both fields, so the guard was
 * inert in precisely the two runs that overbilled.
 */

import { describe, expect, it } from "vitest";
import {
  applyStatedCrewDays,
  capCrewDaysToStatedPlan,
  crewDaysAreStated,
  type CompileLabourPlan,
} from "@/lib/compile-draft";
import type { LinePerson } from "@/lib/schemas/job";

const OWNER = "Jake";

// What run 16's draft billed: the right number of person-days, shared equally.
const EVEN_SPLIT: LinePerson[] = [
  { label: "Jake", days: 2, day_rate: 250 },
  { label: "Daniel (Plasterer)", days: 2, day_rate: 220 },
  { label: "Liam (Labourer)", days: 2, day_rate: 150 },
];

// What run 16's contractor actually said.
const RUN_16_PLAN: CompileLabourPlan = {
  people_count: 3,
  duration_days: 2,
  crew_description: "Jake, Daniel, and Liam",
  crew_days: [
    { name: "me", days: 2 },
    { name: "Daniel", days: 3 },
    { name: "Liam", days: 1 },
  ],
};

const total = (people: LinePerson[]) =>
  people.reduce((sum, p) => sum + p.days * p.day_rate, 0);

describe("the crew bills the days you gave them", () => {
  it("re-splits a crew whose total was already right", () => {
    const restated = applyStatedCrewDays(EVEN_SPLIT, RUN_16_PLAN, OWNER);

    expect(restated, "2/3/1 was stated and 2/2/2 was billed").not.toBeNull();
    expect(restated?.people.map((p) => p.days)).toEqual([2, 3, 1]);
    expect(total(restated?.people ?? []), "£500 + £660 + £150").toBe(1310);
    expect(total(EVEN_SPLIT), "what the draft would have billed").toBe(1240);
  });

  it("matches the contractor to themselves however they said it", () => {
    // "me" is not a name the compiler knows; the owner's label is.
    const restated = applyStatedCrewDays(
      [{ label: "Jake", days: 9, day_rate: 250 }],
      { people_count: 1, duration_days: null, crew_days: [{ name: "myself", days: 4 }] },
      OWNER,
    );

    expect(restated?.people[0]?.days).toBe(4);
  });

  it("leaves the line alone when the plan describes a different crew", () => {
    // All or nothing: a partial assignment would mix two accounts of the crew
    // and could total something neither of them states.
    const restated = applyStatedCrewDays(EVEN_SPLIT, {
      people_count: 2,
      duration_days: 2,
      crew_days: [
        { name: "me", days: 2 },
        { name: "Priya", days: 3 },
      ],
    }, OWNER);

    expect(restated).toBeNull();
  });

  it("says nothing when the draft already agrees with the plan", () => {
    const restated = applyStatedCrewDays(
      [
        { label: "Jake", days: 2, day_rate: 250 },
        { label: "Daniel (Plasterer)", days: 3, day_rate: 220 },
        { label: "Liam (Labourer)", days: 1, day_rate: 150 },
      ],
      RUN_16_PLAN,
      OWNER,
    );

    expect(restated, "nothing moved, so there is nothing to tell anyone").toBeNull();
  });
});

describe("a per-person plan is a ceiling on its own", () => {
  // Run 20: people_count null, duration_days 4 (the owner's own days), and a
  // stated 4 + 5 + 3 = 12 person-days. The draft billed 13.
  const RUN_20_PLAN: CompileLabourPlan = {
    people_count: null,
    duration_days: 4,
    crew_description: "Jake, Daniel for five days, Liam for three days",
    crew_days: [
      { name: "me", days: 4 },
      { name: "Daniel", days: 5 },
      { name: "Liam", days: 3 },
    ],
  };

  it("bounds a crew that people_count could not", () => {
    const overbilled: LinePerson[] = [
      { label: "Jake", days: 4, day_rate: 250 },
      { label: "Daniel (Plasterer)", days: 6, day_rate: 220 },
      { label: "Liam (Labourer)", days: 3, day_rate: 150 },
    ];

    const capped = capCrewDaysToStatedPlan(overbilled, RUN_20_PLAN);

    expect(capped, "13 person-days against a stated 12").not.toBeNull();
    expect(capped?.ceilingDays).toBe(12);
  });

  it("counts the days as stated even when duration_days is wrong", () => {
    expect(crewDaysAreStated(RUN_20_PLAN, 3)).toBe(true);
    // The same plan without the per-person split is what shipped, and it could
    // not answer: no people_count, so nothing to multiply the duration by.
    expect(capCrewDaysToStatedPlan([{ label: "Jake", days: 99, day_rate: 250 }], {
      people_count: null,
      duration_days: 4,
      crew_description: "Jake, Daniel for five days, Liam for three days",
    })).toBeNull();
  });

  it("still never scales an honest crew up", () => {
    const under: LinePerson[] = [
      { label: "Jake", days: 1, day_rate: 250 },
      { label: "Daniel (Plasterer)", days: 1, day_rate: 220 },
      { label: "Liam (Labourer)", days: 1, day_rate: 150 },
    ];

    expect(capCrewDaysToStatedPlan(under, RUN_20_PLAN)).toBeNull();
  });
});
