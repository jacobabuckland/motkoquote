/**
 * A contract awaiting signature on motko.app, 20 Sep, under clause 6:
 *
 *     Estimated start: 8 Sept 2027
 *     Estimated duration: 4 days
 *     Estimated completion: 13 Sept 2027
 *
 * Sixteen lines above, in the same document: "This Agreement is made on
 * 18 September 2026". The job was captured on the 4th and its statement of
 * work gives working dates of the 8th to the 12th — of 2026.
 *
 * The arithmetic is internally consistent for 2027, which is what made it read
 * as deliberate rather than broken: 8 Sept 2027 is a Wednesday and four
 * working days lands on Monday the 13th. Only the year is wrong, and a
 * customer signing it is agreeing to work starting in twelve months.
 *
 * `startDateFromWorkingDates` took the next occurrence on or after today, so a
 * date ten days gone rolled a year. That rule was written for "3rd March said
 * in September" and is right about March; nothing in the phrase separates the
 * two cases, and only the distance into the past does. A threshold there is a
 * guess that is wrong at its own boundary, so a date that has passed is
 * declined and the contractor is asked — the decision of 20 Sep 2026.
 */
import { describe, expect, it } from "vitest";
import {
  startDateFromWorkingDates,
  startDateHintFromWorkingDates,
} from "@/lib/contracts/dates";

/** The day the contract was raised. */
const CONTRACT_DAY = new Date("2026-09-18T10:00:00Z");

describe("working dates that have already gone", () => {
  it("does not put next year in front of a customer", () => {
    expect(startDateFromWorkingDates("8th to 12th of September", CONTRACT_DAY)).toBeNull();
  });

  it("declines a date one single day past", () => {
    // The boundary the old rule got most wrong: yesterday became next year.
    expect(startDateFromWorkingDates("17th September", CONTRACT_DAY)).toBeNull();
  });

  it("asks the contractor instead, quoting what they said", () => {
    // Declining is only correct because this exists — otherwise the contract
    // loses the dates entirely and nobody is told.
    expect(startDateHintFromWorkingDates("8th to 12th of September")).toBe(
      'From the call: "8th to 12th of September" — pick the start date.',
    );
  });
});

describe("what still prefills", () => {
  it("today itself", () => {
    expect(startDateFromWorkingDates("18th September", CONTRACT_DAY)).toBe("2026-09-18");
  });

  it("a date later the same month", () => {
    expect(startDateFromWorkingDates("28th September", CONTRACT_DAY)).toBe("2026-09-28");
  });

  it("a date later in the year", () => {
    expect(startDateFromWorkingDates("starting October 12th", CONTRACT_DAY)).toBe("2026-10-12");
  });

  it("the first day of a range, as it always did", () => {
    expect(startDateFromWorkingDates("20th to 24th of October", CONTRACT_DAY)).toBe("2026-10-20");
  });
});
