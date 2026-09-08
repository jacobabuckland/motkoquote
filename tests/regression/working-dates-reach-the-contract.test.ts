/**
 * The call captures WHEN the work is scheduled. Nothing read it.
 *
 * `labour_plan.working_dates` is described in the SOW tool as "WHEN the work is
 * scheduled, in the contractor's own words", it is distinguished there from
 * duration and from the deadline, and the model fills it reliably — four of the
 * six jobs recorded since 1 Sep carry one. It reaches no consumer at all. So
 * the contract form's start date opened empty on every contract ever sent, and
 * `build-variables.ts:180` printed "To be confirmed" in its place.
 *
 * The 8 Sep test job is the whole case in one row: duration_days 10,
 * working_dates "1st October to 5th October, then two days off, then final five
 * days after that", deadline.job_by "before the end of October" — three real
 * answers, and a contract that read "on or around To be confirmed and to take
 * approximately To be confirmed".
 *
 * Parsing prose into a date that lands on a contract is the risky half, so the
 * parser refuses far more than it accepts. It reads an explicit day-and-month
 * only. It never resolves anything relative ("next Wednesday"), never guesses a
 * month, and never returns a date in the past. Everything it declines is shown
 * to the contractor as a hint under the field instead, in the words that were
 * actually said — the same bargain `durationHintFromTimeline` already strikes.
 */

import { describe, expect, it } from "vitest";

import {
  startDateFromWorkingDates,
  startDateHintFromWorkingDates,
} from "@/lib/contracts/dates";

// A fixed "now" so the year resolution is deterministic. 8 Sep 2026.
const NOW = new Date("2026-09-08T10:00:00Z");

describe("reading a start date out of what the contractor said", () => {
  it("takes the first date of a range stated month-first", () => {
    // The 8 Sep test job, verbatim.
    expect(
      startDateFromWorkingDates(
        "1st October to 5th October, then two days off, then final five days after that",
        NOW,
      ),
    ).toBe("2026-10-01");
  });

  it("takes the FIRST day when a range names the month once, at the end", () => {
    // "8th to 12th of September" — the month attaches to the 12th, but the work
    // starts on the 8th. Reading the month-anchored day would put the contract
    // four days late.
    expect(startDateFromWorkingDates("8th to 12th of September", NOW)).toBe("2026-09-08");
  });

  it("handles 'between the Nth and the Mth of Month'", () => {
    expect(
      startDateFromWorkingDates("between the 1st and 10th of October", NOW),
    ).toBe("2026-10-01");
  });

  it("reads a month-then-day phrasing", () => {
    expect(startDateFromWorkingDates("starting October 12th", NOW)).toBe("2026-10-12");
  });

  it("rolls to next year when the day and month have already passed", () => {
    // Said in September, "3rd March" cannot mean six months ago.
    expect(startDateFromWorkingDates("3rd March", NOW)).toBe("2027-03-03");
  });

  it("keeps today itself, rather than pushing it a year out", () => {
    expect(startDateFromWorkingDates("8th September", NOW)).toBe("2026-09-08");
  });
});

describe("what the parser refuses", () => {
  const refuses = (phrase: string | null | undefined) =>
    expect(startDateFromWorkingDates(phrase, NOW), String(phrase)).toBeNull();

  it("refuses anything relative, because it cannot know the reference", () => {
    // A real captured value: job 30faef2a.
    refuses("next Wednesday to Friday");
    refuses("a week on Monday");
    refuses("as soon as the scaffolding is up");
  });

  it("refuses a month with no day", () => {
    // "before the end of October" is a DEADLINE, and it is stored in a
    // different field. Reading a start date out of it would invent one.
    refuses("before the end of October");
    refuses("sometime in October");
  });

  it("refuses a cross-month range, where the leading day's month is unstated", () => {
    // "28th to 3rd of October" starts in September. The month is not stated for
    // the 28th, and picking October would be wrong by five weeks.
    refuses("28th to 3rd of October");
  });

  it("refuses an invalid date rather than rolling it over", () => {
    refuses("31st February");
    refuses("");
    refuses(null);
    refuses(undefined);
  });
});

describe("what the contractor is shown when the parser declines", () => {
  it("quotes what was said, so the field is not merely blank", () => {
    const hint = startDateHintFromWorkingDates("next Wednesday to Friday");

    expect(hint).toContain("next Wednesday to Friday");
    expect(hint).toMatch(/from the call/i);
  });

  it("says nothing when nothing was captured", () => {
    expect(startDateHintFromWorkingDates("")).toBeUndefined();
    expect(startDateHintFromWorkingDates(null)).toBeUndefined();
    expect(startDateHintFromWorkingDates("   ")).toBeUndefined();
  });

  it("never quotes a non-answer back at the contractor", () => {
    // The same guard durationHintFromTimeline carries, for the same reason:
    // "To be confirmed before work begins" is the fallback prose, and echoing
    // it as though it were something the contractor said is the leak that put
    // that sentence into an input in the first place.
    expect(startDateHintFromWorkingDates("To be confirmed before work begins.")).toBeUndefined();
  });
});

describe("what the contract form is handed, for both routes to it", () => {
  // The 8 Sep test job's captured labour_plan, verbatim. Three real answers on
  // a job whose contract read "on or around To be confirmed and to take
  // approximately To be confirmed".
  const jobAsCaptured = {
    sow_json: {
      labour_plan: {
        people_count: 3,
        duration_days: 10,
        working_dates: "1st October to 5th October, then two days off, then final five days after that",
        crew_description: "Me, Dan, and Liam",
      },
      deadline: { job_by: "before the end of October" },
    },
    extracted_json: { timeline: "Approx. 10 working days, 3-person team" },
  };

  it("carries both the duration and the start date through", async () => {
    const { contractTimingFromJob } = await import("@/lib/contract-prefill");

    const timing = contractTimingFromJob(jobAsCaptured);

    expect(timing.initialDuration).toEqual({ value: "2", unit: "weeks" });
    expect(timing.initialStartDate).toBe("2026-10-01");
  });

  it("never sends a hint alongside the value it would duplicate", async () => {
    const { contractTimingFromJob } = await import("@/lib/contract-prefill");

    const timing = contractTimingFromJob(jobAsCaptured);

    expect(timing.durationHint).toBeUndefined();
    expect(timing.startDateHint).toBeUndefined();
  });

  it("falls back to the hint when the dates were said in relative terms", async () => {
    const { contractTimingFromJob } = await import("@/lib/contract-prefill");

    // Job 30faef2a: a working_dates with no month, and no duration at all.
    const timing = contractTimingFromJob({
      sow_json: {
        labour_plan: { people_count: null, duration_days: null, working_dates: "next Wednesday to Friday" },
      },
      extracted_json: { timeline: "To be confirmed before work begins." },
    });

    expect(timing.initialStartDate).toBeUndefined();
    expect(timing.startDateHint).toContain("next Wednesday to Friday");
    // And the timeline fallback prose is still never quoted back.
    expect(timing.durationHint).toBeUndefined();
  });

  it("degrades to nothing captured on a job with no SOW at all", async () => {
    const { contractTimingFromJob } = await import("@/lib/contract-prefill");

    expect(contractTimingFromJob(null)).toEqual({
      initialDuration: undefined,
      durationHint: undefined,
      initialStartDate: undefined,
      startDateHint: undefined,
    });
  });

  it("survives a SOW written under an older shape rather than throwing", async () => {
    const { contractTimingFromJob } = await import("@/lib/contract-prefill");

    // A contract form is not the place to discover that sow_json is stale.
    expect(() =>
      contractTimingFromJob({ sow_json: { labour_plan: "two lads for a week" } }),
    ).not.toThrow();
  });
});
