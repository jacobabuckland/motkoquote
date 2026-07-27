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
