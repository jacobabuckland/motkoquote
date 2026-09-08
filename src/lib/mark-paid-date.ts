// Which date a trade may record an off-rails payment against.
//
// THE RULE, written down before the code, because it was never stated and the
// implementation drifted from what anyone would have said out loud:
//
//   `paid_at` is a business-local calendar date in Europe/London, inclusive of
//   today, extending ninety days back. A date is valid if it falls on or before
//   today's London date and on or after the London date ninety days prior.
//
// Everything here is CALENDAR arithmetic in one named timezone. The previous
// version compared instants: it parsed the picked date at noon UTC and then
// asked whether that instant was in the future. That was wrong in both
// directions, every day:
//
//   - Today was unselectable until 12:00 UTC, because noon-today is in the
//     future all morning. In BST that is 13:00 local — most of a working day.
//     This is the defect a trade hit on 8 Sep, marking a cash job paid at 07:00.
//   - A payment taken at 00:30 BST happened at 23:30 UTC the previous day. The
//     trade correctly picks today; the old rule anchored it to noon UTC today,
//     which is still ahead of `now`, and refused it.
//
// And the window edge drifted with the time of day, so the ninetieth day was
// sometimes in and sometimes out depending on when the form was opened.
//
// Kept out of the "use server" action file so it is directly unit-testable (a
// server-action module may only export async actions).

// How far back a trade may backdate an off-rails payment. Generous but bounded —
// money paid over three months ago shouldn't be settled through the quick action.
export const MAX_BACKDATE_DAYS = 90;

// The business runs on London time. Named explicitly rather than read from the
// host: the old helpers used `getTimezoneOffset()`, which is the SERVER's
// offset. That happens to be UTC on Vercel, so the bug was invisible in
// production and would have surfaced as soon as anything ran anywhere else.
const BUSINESS_TIMEZONE = "Europe/London";

// `formatToParts` rather than a locale that happens to emit ISO order — the
// parts are named, so this cannot silently reorder under a different ICU build.
const londonParts = new Intl.DateTimeFormat("en-GB", {
  timeZone: BUSINESS_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const pad = (value: number): string => String(value).padStart(2, "0");

/** The London calendar date at a given instant, as yyyy-mm-dd. */
export const getLocalDateString = (epochMs: number): string => {
  const parts = londonParts.formatToParts(new Date(epochMs));
  const get = (type: "year" | "month" | "day") =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
};

/**
 * Shifts a yyyy-mm-dd date by whole calendar days.
 *
 * Done in UTC deliberately. A date has no time, so the shift must not go
 * through a timezone at all — arithmetic on UTC midnight is exact, whereas
 * adding 86,400,000ms to a local instant loses or gains an hour across a DST
 * boundary and can land on the wrong day. 25 October 2026 (BST → GMT) is the
 * date that catches the naive version.
 */
const shiftCalendarDays = (isoDate: string, days: number): string => {
  const [year, month, day] = isoDate.split("-").map(Number);
  const shifted = new Date(Date.UTC(year!, month! - 1, day!) + days * 86_400_000);
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
};

/**
 * The earliest London date still inside the window at a given instant.
 *
 * This is what bounds the picker's `min`, and it must agree exactly with
 * `resolveManualPaidAt` — a picker offering a date the server then refuses is
 * the worst of both.
 */
export const getLocalDateBefore = (epochMs: number, days: number): string =>
  shiftCalendarDays(getLocalDateString(epochMs), -days);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Rejects both unparseable input and impossible dates like 2026-02-31. */
const isRealDate = (isoDate: string): boolean => {
  if (!ISO_DATE.test(isoDate)) return false;
  const [year, month, day] = isoDate.split("-").map(Number);
  const asUtc = new Date(Date.UTC(year!, month! - 1, day!));
  return (
    asUtc.getUTCFullYear() === year &&
    asUtc.getUTCMonth() === month! - 1 &&
    asUtc.getUTCDate() === day
  );
};

/**
 * Resolves a picked yyyy-mm-dd to the settlement timestamp, or null if the date
 * is outside the window. An omitted date means "now".
 *
 * Comparison is on CALENDAR DATES, as strings — ISO dates sort lexicographically,
 * so `paidOn > today` is exactly "is this date after today in London" with no
 * instant arithmetic to get wrong.
 */
export const resolveManualPaidAt = (
  paidOn: string | undefined,
  now: number,
  maxBackdateDays = MAX_BACKDATE_DAYS,
): string | null => {
  if (!paidOn) return new Date(now).toISOString();
  if (!isRealDate(paidOn)) return null;

  const today = getLocalDateString(now);
  const earliest = shiftCalendarDays(today, -maxBackdateDays);

  if (paidOn > today) return null;
  if (paidOn < earliest) return null;

  // Today keeps the real instant. Anchoring today at noon would store a
  // timestamp several hours in the future for anyone settling in the morning,
  // which is a lie about when the money moved and would skew any "paid in the
  // last N hours" read.
  if (paidOn === today) return new Date(now).toISOString();

  // A past date has no time of day to preserve, so it is anchored at noon UTC —
  // which lands on the same London calendar day under both BST (13:00) and GMT
  // (12:00). Midnight would not: in BST it is 01:00 local, and a UTC-rendered
  // display of it shows the previous day.
  const [year, month, day] = paidOn.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day!, 12)).toISOString();
};
