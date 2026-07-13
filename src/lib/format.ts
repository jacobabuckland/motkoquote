// The one money + date formatter for the whole app (G2).
// Amounts are stored in POUNDS (numeric(10,2)) in the database, so formatGBP
// takes pounds directly — never pence.

const GBP = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatGBP(pounds: number): string {
  return GBP.format(Number.isFinite(pounds) ? pounds : 0);
}

const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return DATE.format(date);
}

const DAY_MS = 86_400_000;
const startOfDayUTC = (d: Date) =>
  Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

export function formatRelative(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const days = Math.round(
    (startOfDayUTC(date) - startOfDayUTC(new Date())) / DAY_MS,
  );
  if (days === 0) return "today";
  if (days === -1) return "yesterday";
  if (days === 1) return "tomorrow";
  if (days < 0) return `${-days} days ago`;
  return `in ${days} days`;
}
