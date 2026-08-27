// The date a contract reached its terminal state, written the way it is read
// aloud: "Signed 14 Aug", "Declined yesterday".
//
// Why not formatRelative (src/lib/format.ts)? Two reasons, and both matter for
// this list specifically.
//
// It answers a different question. formatRelative says "3 days ago", which is
// what you want for a deadline — how long have I got. This list is a history a
// contractor scans for a specific job, and "14 Aug" is the thing they can match
// against a diary or an invoice. "37 days ago" is not.
//
// And it is pinned to Europe/London. That is correct where it is used, but this
// runs in the browser against whatever timezone the device is in, so it uses
// the device's own day boundary. A contract signed at 23:30 must show that day,
// not the next one, wherever the trade happens to be.

const DAY_MS = 86_400_000;

/** Local midnight for the day `d` falls on, in the runtime's own timezone. */
const startOfLocalDay = (d: Date): number =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/**
 * "today" | "yesterday" | "14 Aug" | "14 Aug 2025".
 *
 * The year appears only when the date is NOT in the current calendar year —
 * "14 Aug 2025" reads as deliberately old, while stamping the year on every row
 * makes this year's dates longer for no information.
 *
 * Returns "" for an unparseable or absent date, so a caller can render nothing
 * rather than "Invalid Date".
 */
export const formatStatusDate = (
  iso: string | null | undefined,
  now: Date = new Date(),
): string => {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";

  const days = Math.round(
    (startOfLocalDay(date) - startOfLocalDay(now)) / DAY_MS,
  );
  if (days === 0) return "today";
  if (days === -1) return "yesterday";

  // en-GB fixes day-before-month. Left to the browser's own formatter rather
  // than a hand-rolled month table so the abbreviations stay whatever the
  // platform says they are.
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
};

/** "Signed 14 Aug" / "Declined yesterday". Empty when there is no date. */
export const statusDateLabel = (
  status: string,
  iso: string | null | undefined,
  now: Date = new Date(),
): string => {
  const when = formatStatusDate(iso, now);
  if (!when) return "";
  // Capitalised because it opens the line, not because it is a proper noun.
  const verb = status === "signed" ? "Signed" : "Declined";
  return `${verb} ${when}`;
};
