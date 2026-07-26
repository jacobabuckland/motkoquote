// The single source of truth for "is this invoice overdue, and by how many
// days" — shared by the chase cron (chase-plan), the job detail page
// (job-stages) and the dashboard so all three agree to the day. Previously each
// compared `new Date(due_date).getTime() < Date.now()`, which measures a UTC
// instant: a customer whose invoice fell due "today" was flagged overdue from
// the stroke of UTC-midnight, and around BST/GMT the day count could be off by
// one either side of London midnight. We instead compare LONDON CALENDAR DAYS
// with end-of-day semantics — an invoice is overdue only once London has ticked
// past the whole of its due date.

const DAY_MS = 86_400_000;

// London calendar-day index (days since the Unix epoch) for an instant. Uses
// the en-CA locale (which formats as YYYY-MM-DD) pinned to Europe/London so DST
// is handled by the runtime's tz database rather than a hand-rolled offset.
const londonDayIndex = (epochMs: number): number => {
  const [year, month, day] = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(new Date(epochMs))
    .split("-")
    .map(Number);
  return Date.UTC(year!, month! - 1, day!) / DAY_MS;
};

// Calendar-day index for a due date. `due_date` is a Postgres DATE column, so
// the value is "YYYY-MM-DD" (a plain calendar day with no time zone) — we read
// the date components directly rather than round-tripping through an instant,
// so 2026-06-01 always means the 1st regardless of the reader's clock.
const dueDayIndex = (dueDate: string): number => {
  const [year, month, day] = dueDate.slice(0, 10).split("-").map(Number);
  return Date.UTC(year!, month! - 1, day!) / DAY_MS;
};

// Whole London calendar days elapsed since the due date. 0 on the due date
// itself, 1 the following day, and so on. Never negative-clamped — a future due
// date returns a negative count, which the chase planner reads as "not due".
export const daysOverdue = (dueDate: string, now: number): number =>
  londonDayIndex(now) - dueDayIndex(dueDate);

// End-of-day overdue test: an invoice is overdue only once London has moved on
// to the day AFTER its due date. Due "today" is not yet overdue.
export const isDateOverdue = (dueDate: string | null, now: number): boolean =>
  dueDate !== null && daysOverdue(dueDate, now) >= 1;
