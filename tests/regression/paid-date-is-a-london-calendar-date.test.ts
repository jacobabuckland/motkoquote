/**
 * `paid_at` follows a written rule, and the rule is about calendar dates.
 *
 *   A business-local calendar date in Europe/London, inclusive of today,
 *   extending ninety days back.
 *
 * The old implementation compared INSTANTS: it parsed the picked date at noon
 * UTC and asked whether that instant was in the future. That is wrong in both
 * directions, every single day.
 *
 *   - Today was unselectable until 12:00 UTC — 13:00 BST — because noon-today
 *     is in the future all morning. A trade marking a cash job paid at 07:00 on
 *     8 Sep 2026 was told to "pick a date from the last 90 days, not in the
 *     future". The date was today.
 *   - A payment taken at 00:30 BST happened at 23:30 UTC the day before. The
 *     trade picks today, correctly; the old rule anchored it to noon UTC today,
 *     still ahead of `now`, and refused it.
 *
 * The window edge moved with the time of day for the same reason, so the
 * ninetieth day was in or out depending on when the form was opened.
 *
 * These tests are written in UTC instants and assert LONDON dates, because that
 * is the whole substance of the rule: the two differ by an hour for seven
 * months of the year, and every defect above lives in that hour.
 */

import { describe, expect, it } from "vitest";

import {
  MAX_BACKDATE_DAYS,
  getLocalDateBefore,
  getLocalDateString,
  resolveManualPaidAt,
} from "@/lib/mark-paid-date";

// 8 September 2026, 07:03 UTC — the exact moment from the incident, inside BST.
const THE_MORNING_IT_FAILED = Date.UTC(2026, 8, 8, 7, 3, 0);

describe("today is selectable at every hour", () => {
  it.each([
    ["00:30 BST (23:30 UTC the day before)", Date.UTC(2026, 8, 7, 23, 30), "2026-09-08"],
    ["07:03 BST — the reported failure", THE_MORNING_IT_FAILED, "2026-09-08"],
    ["noon UTC", Date.UTC(2026, 8, 8, 12, 0), "2026-09-08"],
    ["23:00 BST", Date.UTC(2026, 8, 8, 22, 0), "2026-09-08"],
  ])("accepts today at %s", (_label, now, expectedToday) => {
    // The London date is the claim. At 23:30 UTC on the 7th, London is already
    // on the 8th — which is why this cannot be computed in UTC.
    expect(getLocalDateString(now)).toBe(expectedToday);
    expect(resolveManualPaidAt(expectedToday, now)).not.toBeNull();
  });

  it("records today at the real instant, never a future one", () => {
    // Anchoring today at noon would store a timestamp five hours ahead of the
    // moment the trade pressed the button.
    const result = resolveManualPaidAt("2026-09-08", THE_MORNING_IT_FAILED);

    expect(result).toBe(new Date(THE_MORNING_IT_FAILED).toISOString());
    expect(new Date(result!).getTime()).toBeLessThanOrEqual(THE_MORNING_IT_FAILED);
  });

  it("still refuses tomorrow", () => {
    expect(resolveManualPaidAt("2026-09-09", THE_MORNING_IT_FAILED)).toBeNull();
  });
});

describe("both ends of the ninety-day window", () => {
  it("accepts the ninetieth day and refuses the ninety-first", () => {
    const earliest = getLocalDateBefore(THE_MORNING_IT_FAILED, MAX_BACKDATE_DAYS);
    const oneTooFar = getLocalDateBefore(THE_MORNING_IT_FAILED, MAX_BACKDATE_DAYS + 1);

    expect(resolveManualPaidAt(earliest, THE_MORNING_IT_FAILED)).not.toBeNull();
    expect(resolveManualPaidAt(oneTooFar, THE_MORNING_IT_FAILED)).toBeNull();
  });

  it("puts the edge on the same date at every hour of the same London day", () => {
    // The bug this pins: under instant comparison the window boundary slid with
    // the time of day, so the same calendar date was accepted in the morning
    // and refused in the evening.
    //
    // Capped at 22:30 UTC deliberately. 23:30 UTC in BST is 00:30 the NEXT day
    // in London, so the edge moving there is the rule working, not drifting —
    // the window is relative to today's London date, and by then it is
    // tomorrow. Including it was this test being wrong, not the code.
    const hours = [0, 6, 12, 18, 22].map((hour) => Date.UTC(2026, 8, 8, hour, 30));

    expect(new Set(hours.map(getLocalDateString)).size, "not all one London day").toBe(1);

    const edges = hours.map((now) => getLocalDateBefore(now, MAX_BACKDATE_DAYS));
    expect(new Set(edges).size, `edges drifted: ${edges.join(", ")}`).toBe(1);

    for (const now of hours) {
      expect(resolveManualPaidAt(edges[0]!, now), `at ${new Date(now).toISOString()}`).not.toBeNull();
    }
  });

  it("moves the whole window when the London day rolls over", () => {
    // The other half of the same fact, stated positively so nobody later
    // "fixes" the boundary into being time-of-day invariant across midnight.
    const lateOn8th = Date.UTC(2026, 8, 8, 22, 30); // 23:30 BST, still the 8th
    const justAfter = Date.UTC(2026, 8, 8, 23, 30); // 00:30 BST, now the 9th

    expect(getLocalDateString(lateOn8th)).toBe("2026-09-08");
    expect(getLocalDateString(justAfter)).toBe("2026-09-09");
    expect(getLocalDateBefore(justAfter, MAX_BACKDATE_DAYS)).not.toBe(
      getLocalDateBefore(lateOn8th, MAX_BACKDATE_DAYS),
    );
  });

  it("offers a window exactly ninety days wide", () => {
    const today = getLocalDateString(THE_MORNING_IT_FAILED);
    const earliest = getLocalDateBefore(THE_MORNING_IT_FAILED, MAX_BACKDATE_DAYS);
    const days = (Date.parse(today) - Date.parse(earliest)) / 86_400_000;

    expect(days).toBe(MAX_BACKDATE_DAYS);
  });
});

describe("the BST/GMT boundary", () => {
  // British Summer Time ends at 02:00 BST on Sunday 25 October 2026. A window
  // that shifts instants by 86,400,000ms crosses that boundary and lands an
  // hour out, which is a whole day wrong either side of midnight.
  const CLOCKS_GO_BACK = "2026-10-25";

  it("reads the London date correctly on either side of the change", () => {
    // 00:30 UTC on the 25th is 01:30 BST — still the 25th.
    expect(getLocalDateString(Date.UTC(2026, 9, 25, 0, 30))).toBe("2026-10-25");
    // 23:30 UTC on the 24th is 00:30 BST on the 25th.
    expect(getLocalDateString(Date.UTC(2026, 9, 24, 23, 30))).toBe("2026-10-25");
    // 23:30 UTC on the 25th is 23:30 GMT — the clocks have gone back.
    expect(getLocalDateString(Date.UTC(2026, 9, 25, 23, 30))).toBe("2026-10-25");
  });

  it("counts whole calendar days across the transition", () => {
    // From 1 November (GMT) back 30 days crosses the change. Naive millisecond
    // subtraction gains an hour here and can report 2 October instead of the 2nd
    // at a different time — or the 1st, depending on the hour.
    const fromNovember = Date.UTC(2026, 10, 1, 12, 0);

    expect(getLocalDateBefore(fromNovember, 30)).toBe("2026-10-02");
    expect(getLocalDateBefore(fromNovember, 7)).toBe("2026-10-25");
  });

  it("accepts a payment dated on the transition day itself", () => {
    // Sitting inside the window from a November vantage point.
    const now = Date.UTC(2026, 10, 10, 9, 0);

    expect(resolveManualPaidAt(CLOCKS_GO_BACK, now)).not.toBeNull();
  });

  it("anchors a past date so it renders as that same London day", () => {
    // Noon UTC is 12:00 GMT / 13:00 BST — the same calendar day in London
    // either way. Midnight would be 01:00 BST, and a UTC-rendered display of it
    // shows the previous day.
    const stored = resolveManualPaidAt(CLOCKS_GO_BACK, Date.UTC(2026, 10, 10, 9, 0));

    expect(getLocalDateString(Date.parse(stored!))).toBe(CLOCKS_GO_BACK);
  });
});

describe("input that is not a date", () => {
  it("refuses junk and impossible dates", () => {
    // 2026-02-31 is the one worth having: it parses under a naive Date and
    // silently becomes 3 March, so a refusal has to be explicit.
    for (const bad of ["not-a-date", "2026-02-31", "26-09-08", "2026-9-8"]) {
      expect(resolveManualPaidAt(bad, THE_MORNING_IT_FAILED), bad).toBeNull();
    }
  });

  it("treats an omitted or cleared date as now", () => {
    const expected = new Date(THE_MORNING_IT_FAILED).toISOString();

    expect(resolveManualPaidAt(undefined, THE_MORNING_IT_FAILED)).toBe(expected);
    // A cleared date input submits "", which means "I didn't pick one" rather
    // than "I picked something invalid". Long-standing behaviour, pinned here
    // because it is a judgement call rather than an obvious one.
    expect(resolveManualPaidAt("", THE_MORNING_IT_FAILED)).toBe(expected);
  });
});
