// Pure validation for the backdated date a trade may pick when marking an
// invoice paid off-rails. Kept out of the "use server" action file so it's
// directly unit-testable (a server-action module may only export async actions).

// How far back a trade may backdate an off-rails payment. Generous but bounded —
// money paid over three months ago shouldn't be settled through the quick action.
export const MAX_BACKDATE_DAYS = 90;

// Return a yyyy-mm-dd string for the local date at the given epoch timestamp.
// Uses local calendar components by explicitly applying the timezone offset,
// so it reflects the user's timezone and respects mocked offsets in tests.
export const getLocalDateString = (epochMs: number): string => {
  const d = new Date(epochMs);
  // Get the timezone offset in minutes (positive for west of UTC)
  const offsetMinutes = d.getTimezoneOffset();
  // Apply the offset to convert from UTC to local time
  const localMs = epochMs - offsetMinutes * 60 * 1000;
  const localDate = new Date(localMs);
  // Use UTC methods on the offset-adjusted time to get local components
  const year = localDate.getUTCFullYear();
  const month = String(localDate.getUTCMonth() + 1).padStart(2, "0");
  const day = String(localDate.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

// Return a yyyy-mm-dd string for the earliest local date that resolveManualPaidAt
// will accept when called with the same `now` and `days`. The server parses date
// strings at noon UTC, so we compute the threshold (now - days * 86400000) and
// return the date that, at noon UTC, is >= that threshold.
export const getLocalDateBefore = (epochMs: number, days: number): string => {
  // The earliest epoch the server will accept (at noon UTC)
  const thresholdMs = epochMs - days * 86_400_000;
  // Convert threshold to a date at noon UTC, then get the date component
  const thresholdDate = new Date(thresholdMs);
  // If the threshold time is after noon, we need the next day
  // (because that day at noon would be before the threshold)
  const thresholdHour = thresholdDate.getUTCHours();
  const thresholdMinute = thresholdDate.getUTCMinutes();
  const thresholdSecond = thresholdDate.getUTCSeconds();
  const thresholdMilli = thresholdDate.getUTCMilliseconds();
  const isPastNoon =
    thresholdHour > 12 ||
    (thresholdHour === 12 && (thresholdMinute > 0 || thresholdSecond > 0 || thresholdMilli > 0));

  // Get the date, adding 1 if we're past noon
  const d = new Date(thresholdMs);
  const offsetMinutes = d.getTimezoneOffset();
  const localMs = thresholdMs - offsetMinutes * 60 * 1000;
  const localDate = new Date(localMs);
  if (isPastNoon) {
    localDate.setUTCDate(localDate.getUTCDate() + 1);
  }
  const year = localDate.getUTCFullYear();
  const month = String(localDate.getUTCMonth() + 1).padStart(2, "0");
  const day = String(localDate.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

// Resolve a picked yyyy-mm-dd date to a settlement timestamp, rejecting the
// future and anything older than the window. Returns null on an invalid choice;
// an omitted date means "now".
export const resolveManualPaidAt = (
  paidOn: string | undefined,
  now: number,
  maxBackdateDays = MAX_BACKDATE_DAYS,
): string | null => {
  if (!paidOn) return new Date(now).toISOString();
  const picked = new Date(`${paidOn}T12:00:00.000Z`).getTime();
  if (Number.isNaN(picked)) return null;
  if (picked > now) return null;
  if (now - picked > maxBackdateDays * 86_400_000) return null;
  return new Date(picked).toISOString();
};
