/**
 * A crew plan that cannot be true does not set the labour line.
 *
 * #772 taught the compiler to SET a labour line's days from `crew_days` rather
 * than merely bound them. That is right when the plan is real, and it fixed
 * four of five runs. On the fifth it made things considerably worse.
 *
 * Voice run 19's contractor described three evening shifts of about five hours
 * each. Intake wrote the HOURS into `crew_days` as though they were days:
 *
 *   crew_days: me 15, Daniel 11, Liam 8     duration_days: 5
 *
 * Fifteen days of work inside a five-day job. The guard trusted it, expanded
 * the draft's own 15 person-days to 34, and priced the line at £7,370 against a
 * correct £1,437.82. The mechanism built to stop the model over-billing was
 * handed a worse number than the model's and preferred it.
 *
 * The test is the crew's TOTAL against everyone working every day —
 * `duration × head count`, the ceiling this file already derives elsewhere. A
 * per-person test was the first attempt and it was too strict: round 4 captured
 * the same script as run 16 with `duration_days: 2` and a correct 2/3/1 split,
 * so Daniel's three days exceeded the recorded duration and a good plan would
 * have been discarded. `duration_days` is captured no more reliably than
 * `crew_days`, and a guard that assumes one of them is right will be wrong
 * whenever it picks the wrong one. The sum does not have to choose.
 *
 * The plan is then rejected WHOLE. A total that large means the capture
 * confused hours for days, and the individual figures are no more trustworthy
 * than the total that gave it away.
 */

import { describe, expect, it } from "vitest";
import {
  applyStatedCrewDays,
  capCrewDaysToStatedPlan,
  crewDaysExceedTheJob,
  impossibleCrewDaysFlag,
  statedCrewDays,
  type CompileLabourPlan,
} from "@/lib/compile-draft";
import type { LinePerson } from "@/lib/schemas/job";

/** Run 19 exactly as production captured it. */
const RUN_19: CompileLabourPlan = {
  people_count: null,
  duration_days: 5,
  crew_description: "Me, Daniel and Liam",
  crew_days: [
    { name: "me", days: 15 },
    { name: "Daniel", days: 11 },
    { name: "Liam", days: 8 },
  ],
};

const CREW: LinePerson[] = [
  { label: "Jake", days: 5, day_rate: 250 },
  { label: "Daniel (Plasterer)", days: 5, day_rate: 220 },
  { label: "Liam (Apprentice)", days: 5, day_rate: 150 },
];

describe("hours recorded as days", () => {
  it("is recognised as impossible", () => {
    expect(crewDaysExceedTheJob(RUN_19)).toBe(true);
  });

  it("does not set the labour line", () => {
    expect(
      applyStatedCrewDays(CREW, RUN_19, "Jake"),
      "34 person-days inside a five-day job, priced at £7,370",
    ).toBeNull();
  });

  it("is not usable as a ceiling either", () => {
    // The sum would be 34, which bounds nothing. Falling back to duration ×
    // head count is the conservative answer; here head count is null too, so
    // there is no ceiling at all — the pre-#772 position, and the safe floor.
    expect(statedCrewDays(RUN_19)).toEqual([]);
    expect(capCrewDaysToStatedPlan(CREW, RUN_19)).toBeNull();
  });

  it("tells the contractor, naming the figures that gave it away", () => {
    const flag = impossibleCrewDaysFlag(RUN_19);
    expect(flag).toContain("34 person-days");
    expect(flag).toContain("5-day job");
    expect(flag, "names the likely cause so it can be corrected").toContain("hours");
  });
});

describe("the four runs the guard must not touch", () => {
  // Every other plan from round 5, unchanged. A bound that fires on an honest
  // plan is worse than no bound.
  const CREDIBLE: Array<[string, CompileLabourPlan]> = [
    ["16", { people_count: 3, duration_days: 3, crew_days: [
      { name: "me", days: 2 }, { name: "Daniel", days: 3 }, { name: "Liam", days: 1 }] }],
    ["20", { people_count: null, duration_days: 5, crew_days: [
      { name: "me", days: 4 }, { name: "Daniel", days: 5 }, { name: "Liam", days: 3 }] }],
    ["24", { people_count: null, duration_days: 5, crew_days: [
      { name: "me", days: 3 }, { name: "Daniel", days: 3 }, { name: "Liam", days: 2 }] }],
    ["25", { people_count: null, duration_days: 2, crew_days: [
      { name: "me", days: 2 }, { name: "Daniel", days: 2 }] }],
  ];

  for (const [run, plan] of CREDIBLE) {
    it(`leaves run ${run}'s plan usable`, () => {
      expect(crewDaysExceedTheJob(plan)).toBe(false);
      expect(statedCrewDays(plan)).toHaveLength(plan.crew_days?.length ?? 0);
    });
  }

  it("still re-splits run 16's crew", () => {
    const evenSplit: LinePerson[] = [
      { label: "Jake", days: 2, day_rate: 250 },
      { label: "Daniel (Plasterer)", days: 2, day_rate: 220 },
      { label: "Liam (Apprentice)", days: 2, day_rate: 150 },
    ];
    const restated = applyStatedCrewDays(evenSplit, CREDIBLE[0]![1], "Jake");

    expect(restated?.people.map((p) => p.days)).toEqual([2, 3, 1]);
  });
});

describe("a plan the duration disagrees with, but only just", () => {
  // Round 4 captured the SAME script as run 16 with `duration_days: 2`, where
  // round 5 captured 3. The split 2/3/1 was right both times, so a per-person
  // test would have thrown away a correct plan on the strength of a field
  // captured no more reliably than the one it was judging.
  const DURATION_UNDERSTATED: CompileLabourPlan = {
    people_count: 3,
    duration_days: 2,
    crew_days: [
      { name: "me", days: 2 },
      { name: "Daniel", days: 3 },
      { name: "Liam", days: 1 },
    ],
  };

  it("is kept, because the total still fits everyone working every day", () => {
    expect(crewDaysExceedTheJob(DURATION_UNDERSTATED)).toBe(false);
    expect(statedCrewDays(DURATION_UNDERSTATED)).toHaveLength(3);
  });
});

describe("with no duration to check against", () => {
  it("says nothing, because absence is not evidence", () => {
    const noDuration: CompileLabourPlan = {
      people_count: null,
      duration_days: null,
      crew_days: [{ name: "me", days: 15 }],
    };

    expect(crewDaysExceedTheJob(noDuration)).toBe(false);
    expect(statedCrewDays(noDuration)).toHaveLength(1);
  });
});
