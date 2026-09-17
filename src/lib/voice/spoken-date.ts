/**
 * The day a cost was incurred, from the contractor's own words.
 *
 * Voice cost capture had no field for this at all. `incurredOn` was set to the
 * client's clock and nothing else, so "I paid him in cash yesterday" saved
 * today's date — and a cost dated to the wrong day lands in the wrong VAT
 * quarter, which is the sort of error nobody notices until a return is filed.
 * Measured on 16 Sep: a £160 helper paid on the 15th saved as the 16th.
 *
 * Same division of labour as the amount and the VAT basis: the model reports
 * the WORDS, and code decides what they mean. Nothing here trusts a date the
 * model computed.
 *
 * Deliberately small. It resolves the handful of phrases a trade actually uses
 * about a receipt in their pocket, and answers `null` to everything else so the
 * caller falls back to today. A wrong date is worse than today's date, and
 * "null" is cheap.
 */

/**
 * Days back from today, for the phrases that name one directly.
 *
 * Each pattern LEADS the phrase and may be followed by anything. A contractor
 * who dates a cost twice -- "yesterday, the 16th of September" -- is being more
 * precise, not less, and requiring the phrase to be the relative word ALONE
 * turned that into no answer at all: `resolveSpokenDate` returned null, the
 * caller fell back to `today`, and run 107 of the 17 Sep tranche filed a cost
 * incurred and paid on the 16th as the 17th. The words were captured correctly
 * the whole way down; only this match failed.
 *
 * The leading anchor is what keeps it safe, and it is doing real work:
 * "day before yesterday" does not START with "yesterday", so it still reaches
 * its own entry two lines below rather than being read as one day back, and
 * "not yesterday" matches nothing at all.
 */
const RELATIVE_TAIL = "(?:\\s+.+)?\\s*$";
const RELATIVE_DAYS: Array<[RegExp, number]> = [
  [new RegExp(`^\\s*(?:today|this\\s+morning|this\\s+afternoon|this\\s+evening|just\\s+now)${RELATIVE_TAIL}`, "i"), 0],
  [new RegExp(`^\\s*yesterday(?:\\s+(?:morning|afternoon|evening))?${RELATIVE_TAIL}`, "i"), 1],
  [new RegExp(`^\\s*(?:the\\s+)?day\\s+before\\s+yesterday${RELATIVE_TAIL}`, "i"), 2],
];

const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

/**
 * How far back a weekday name is allowed to reach.
 *
 * "Last Tuesday" means the Tuesday just gone, not one in the spring. Six days
 * is the most a named weekday can be behind today without meaning a different
 * week, and a cost older than that deserves the contractor typing the date.
 */
const MAX_WEEKDAY_LOOKBACK = 6;

const iso = (date: Date): string => date.toISOString().split("T")[0]!;

/**
 * Resolve spoken words to an ISO date, or null when they name no day we are
 * sure of.
 *
 * `today` is passed in rather than read from the clock so the caller owns the
 * timezone and the function stays pure.
 */
export function resolveSpokenDate(
  words: string | null | undefined,
  today: string,
): string | null {
  if (!words || words.trim().length === 0) return null;

  const said = words.trim().toLowerCase().replace(/[.,!?]/g, "");
  const base = new Date(`${today}T00:00:00Z`);
  if (Number.isNaN(base.getTime())) return null;

  const back = (days: number): string => {
    const when = new Date(base);
    when.setUTCDate(when.getUTCDate() - days);
    return iso(when);
  };

  for (const [pattern, days] of RELATIVE_DAYS) {
    if (pattern.test(said)) return back(days);
  }

  // "last Friday", "on Friday", "Friday". All mean the most recent one that has
  // already happened — never a future day, because a cost has been incurred.
  const weekday = /(?:^|\s)(?:last\s+|on\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\s*$/i.exec(
    said,
  );
  if (weekday) {
    const target = WEEKDAYS.indexOf(weekday[1]!.toLowerCase());
    const todayIndex = base.getUTCDay();
    // 0 would be today; a trade saying "Friday" ON Friday means today.
    const delta = (todayIndex - target + 7) % 7;
    if (delta <= MAX_WEEKDAY_LOOKBACK) return back(delta);
  }

  return null;
}
