// The dashboard's "Signed & declined contracts" list showed a name, a pill and
// a link, and nothing else. A repeat customer therefore produced several
// identical rows — the same name three times — and the only way to tell which
// contract was which was to open each one.
//
// These cover the date that fixes it. `now` is injected rather than mocked so
// the boundaries are exact and the tests do not drift with the calendar.
import { describe, expect, it } from "vitest";
import { formatStatusDate, statusDateLabel } from "@/lib/contract-status-date";

// Local noon, so a test can move a few hours either way without crossing a day
// boundary by accident. Constructed via the local-time Date constructor
// deliberately: the formatter works in the runtime's timezone, and building
// these from a UTC string would test something else.
const localNoon = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12, 0, 0);

describe("formatStatusDate", () => {
  const now = localNoon(2026, 8, 27);

  it("says today rather than the date", () => {
    expect(formatStatusDate(localNoon(2026, 8, 27).toISOString(), now)).toBe("today");
  });

  it("says yesterday rather than the date", () => {
    expect(formatStatusDate(localNoon(2026, 8, 26).toISOString(), now)).toBe("yesterday");
  });

  it("gives day and short month within the current year", () => {
    expect(formatStatusDate(localNoon(2026, 8, 14).toISOString(), now)).toBe("14 Aug");
  });

  it("adds the year once the date is not in the current one", () => {
    // Not "how long ago" — 31 Dec 2025 is eight months back and still earns a
    // year, because the rule is the calendar year and not an interval.
    expect(formatStatusDate(localNoon(2025, 12, 31).toISOString(), now)).toBe("31 Dec 2025");
    expect(formatStatusDate(localNoon(2025, 8, 14).toISOString(), now)).toBe("14 Aug 2025");
  });

  it("puts the day before the month", () => {
    // en-GB, explicitly. Under the default locale of a US-configured runtime
    // this would render "Aug 14" and read as a different date entirely to the
    // trade holding the phone.
    expect(formatStatusDate(localNoon(2026, 3, 4).toISOString(), now)).toBe("4 Mar");
  });

  it("uses the local day boundary, so a late-evening signature keeps its date", () => {
    // 23:30 local on the 26th is "yesterday" from noon on the 27th. Computed
    // against local midnight rather than UTC: in any timezone ahead of UTC this
    // instant is already the 27th in UTC, and a UTC comparison would call it
    // "today" and show the wrong day to the person who signed it.
    const lateLastNight = new Date(2026, 7, 26, 23, 30, 0);
    expect(formatStatusDate(lateLastNight.toISOString(), now)).toBe("yesterday");
  });

  it("renders nothing rather than Invalid Date", () => {
    // A declined contract created before declined_at existed has no date at
    // all. The row must simply omit the line.
    expect(formatStatusDate(null, now)).toBe("");
    expect(formatStatusDate(undefined, now)).toBe("");
    expect(formatStatusDate("not a date", now)).toBe("");
  });
});

describe("statusDateLabel", () => {
  const now = localNoon(2026, 8, 27);

  it("names the event, not just the date", () => {
    expect(statusDateLabel("signed", localNoon(2026, 8, 14).toISOString(), now)).toBe(
      "Signed 14 Aug",
    );
    expect(statusDateLabel("declined", localNoon(2026, 8, 2).toISOString(), now)).toBe(
      "Declined 2 Aug",
    );
  });

  it("reads naturally against the relative words", () => {
    expect(statusDateLabel("signed", localNoon(2026, 8, 27).toISOString(), now)).toBe(
      "Signed today",
    );
    expect(statusDateLabel("declined", localNoon(2026, 8, 26).toISOString(), now)).toBe(
      "Declined yesterday",
    );
  });

  it("is empty when there is no date, so no bare verb is rendered", () => {
    // "Declined" on its own line, with nothing after it, would read as a second
    // status pill rather than a missing date.
    expect(statusDateLabel("declined", null, now)).toBe("");
  });
});
