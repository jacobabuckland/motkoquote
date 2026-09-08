// Pure date helpers for the contract form's constrained timing fields. No I/O,
// no locale surprises: everything works in UTC on `yyyy-mm-dd` strings (the
// value shape of an <input type="date">), so a contract drafted at 23:00 in
// London can't drift a day. Kept separate from the React form so the
// working-day maths is trivially unit-testable.

export type DurationUnit = "days" | "weeks";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const isIsoDate = (value: string): boolean => {
  if (!ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
};

// Today as `yyyy-mm-dd` in local time — used as the date picker's `min` so a
// start date can't be set in the past. Local (not UTC) so "today" matches the
// contractor's own calendar day.
export const todayIso = (now: Date = new Date()): string => {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const isWeekend = (utcMs: number): boolean => {
  const day = new Date(utcMs).getUTCDay();
  return day === 0 || day === 6; // Sun | Sat
};

const DAY = 86_400_000;

// Estimated completion = start plus `value` working days (weeks × 5), counting
// the start day itself as the first working day and skipping weekends. If the
// start falls on a weekend the count begins from the following Monday. Returns
// "" for an unparseable start or a non-positive duration so callers can leave
// the field blank rather than render a bogus date.
export const deriveCompletionDate = (
  startIso: string,
  value: number,
  unit: DurationUnit,
): string => {
  if (!isIsoDate(startIso) || !Number.isFinite(value) || value <= 0) return "";
  const workingDays = unit === "weeks" ? Math.round(value * 5) : Math.round(value);
  if (workingDays <= 0) return "";

  let cursor = new Date(`${startIso}T00:00:00Z`).getTime();
  // Nudge a weekend start onto the next Monday before counting.
  while (isWeekend(cursor)) cursor += DAY;

  // The start day is the first working day, so we advance (workingDays - 1)
  // further working days.
  let remaining = workingDays - 1;
  while (remaining > 0) {
    cursor += DAY;
    if (!isWeekend(cursor)) remaining -= 1;
  }
  return new Date(cursor).toISOString().slice(0, 10);
};

// Composes the human duration string the contract renders ("3 weeks", "1 day")
// from the structured value + unit. Returns "" when there's no value, so the
// contract's own "To be confirmed" fallback takes over rather than printing a
// bare unit.
export const formatDurationText = (value: string, unit: DurationUnit): string => {
  const n = Number(value);
  if (!value.trim() || !Number.isFinite(n) || n <= 0) return "";
  const rounded = Number.isInteger(n) ? n : Math.round(n * 10) / 10;
  const singular = unit === "weeks" ? "week" : "day";
  return `${rounded} ${rounded === 1 ? singular : `${singular}s`}`;
};

// Seeds the structured duration inputs from a captured number of working days
// (labour_plan.duration_days). Prefers whole weeks when the day count divides
// evenly and is at least a week, so a 10-day estimate prefills as "2 weeks".
export const durationFromDays = (
  days: number | null | undefined,
): { value: string; unit: DurationUnit } | null => {
  if (!days || !Number.isFinite(days) || days <= 0) return null;
  const whole = Math.round(days);
  if (whole >= 5 && whole % 5 === 0) return { value: String(whole / 5), unit: "weeks" };
  return { value: String(whole), unit: "days" };
};

// Builds the "from the call" hint shown under the duration input when only a
// prose timeline was captured (no numeric working-day count to seed the fields
// with). Returns undefined for empty or fallback ("To be confirmed…") timelines
// so we never quote a non-answer back at the contractor — the very leak that put
// "To be confirmed before work begins" into the input.
export const durationHintFromTimeline = (
  timeline: string | null | undefined,
): string | undefined => {
  const t = (timeline ?? "").trim();
  if (!t || /^to be confirmed/i.test(t)) return undefined;
  return `From the call: "${t}" — enter a number of days or weeks.`;
};

// ---------------------------------------------------------------------------
// Reading a start date out of what the contractor said on the call.
//
// `labour_plan.working_dates` is captured on most jobs — "WHEN the work is
// scheduled, in the contractor's own words", per the SOW tool, which
// deliberately keeps it apart from duration and from the deadline. Nothing read
// it, so the contract form's start date opened empty every time and the
// rendered contract said "To be confirmed".
//
// This is the risky direction — a wrong date here goes onto a document somebody
// signs — so the parser refuses much more than it accepts. Explicit day AND
// month, or nothing. Whatever it declines is shown to the contractor as a hint
// in the words that were said, which is strictly better than a blank field and
// carries no risk of being wrong.
// ---------------------------------------------------------------------------

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
] as const;

const MONTH_PATTERN = MONTHS.join("|");
const ORDINAL = "(?:st|nd|rd|th)?";

// "1st October", "12 September", "8th of September".
const DAY_THEN_MONTH = new RegExp(
  `(\\d{1,2})${ORDINAL}\\s+(?:of\\s+)?(${MONTH_PATTERN})\\b`,
  "i",
);
// "October 12th".
const MONTH_THEN_DAY = new RegExp(
  `\\b(${MONTH_PATTERN})\\s+(\\d{1,2})${ORDINAL}\\b`,
  "i",
);
// A range whose month is stated only once, at the end: the "8th to " in "8th to
// 12th of September", or the "1st and " in "between the 1st and 10th of
// October". Anchored to the end, so it only matches immediately before the
// month-bearing day.
const RANGE_LEAD = new RegExp(`(\\d{1,2})${ORDINAL}\\s*(?:to|and|until|–|—|-)\\s+$`, "i");

/**
 * The start date implied by a `working_dates` phrase, as `yyyy-mm-dd`, or null.
 *
 * The year is the next occurrence on or after `reference`: a date said in
 * September naming "3rd March" means next March, and one naming today means
 * today. That also guarantees this never prefills a date in the past, which the
 * form's own `min` would reject anyway.
 */
export const startDateFromWorkingDates = (
  workingDates: string | null | undefined,
  reference: Date = new Date(),
): string | null => {
  const text = (workingDates ?? "").trim();
  if (!text) return null;

  let day: number;
  let monthIndex: number;

  const dayFirst = DAY_THEN_MONTH.exec(text);
  if (dayFirst) {
    day = Number(dayFirst[1]);
    monthIndex = MONTHS.indexOf(dayFirst[2].toLowerCase() as (typeof MONTHS)[number]);

    // A range that named the month once, at the end — the work starts on the
    // LEADING day, not the one the month happens to be attached to.
    const lead = RANGE_LEAD.exec(text.slice(0, dayFirst.index));
    if (lead) {
      const leadDay = Number(lead[1]);
      // A leading day AFTER the month-bearing one crosses a month boundary
      // ("28th to 3rd of October" starts in September), and the earlier month
      // is not stated. Refuse rather than be wrong by five weeks.
      if (leadDay > day) return null;
      day = leadDay;
    }
  } else {
    const monthFirst = MONTH_THEN_DAY.exec(text);
    if (!monthFirst) return null;
    monthIndex = MONTHS.indexOf(monthFirst[1].toLowerCase() as (typeof MONTHS)[number]);
    day = Number(monthFirst[2]);
  }

  if (monthIndex < 0 || day < 1 || day > 31) return null;

  // Reference day at UTC midnight, so "today" compares as a calendar day.
  const todayUtc = Date.UTC(
    reference.getUTCFullYear(),
    reference.getUTCMonth(),
    reference.getUTCDate(),
  );

  for (const year of [reference.getUTCFullYear(), reference.getUTCFullYear() + 1]) {
    const candidate = new Date(Date.UTC(year, monthIndex, day));
    // Rejects 31 February and friends: Date rolls them into the next month, so
    // a candidate whose month moved was never a real date.
    if (candidate.getUTCMonth() !== monthIndex || candidate.getUTCDate() !== day) return null;
    if (candidate.getTime() >= todayUtc) return candidate.toISOString().slice(0, 10);
  }
  return null;
};

/**
 * What to show under the start-date field when the phrase could not be parsed.
 *
 * Mirrors durationHintFromTimeline, including its guard against echoing the
 * "To be confirmed…" fallback prose back at the contractor as though it were
 * something they had said.
 */
export const startDateHintFromWorkingDates = (
  workingDates: string | null | undefined,
): string | undefined => {
  const text = (workingDates ?? "").trim();
  if (!text || /^to be confirmed/i.test(text)) return undefined;
  return `From the call: "${text}" — pick the start date.`;
};
