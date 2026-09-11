/**
 * The window the money card reckons over.
 *
 * WHY THIS EXISTS. Every figure on the money position was a LIFETIME total —
 * `collected` summed every paid invoice ever, `costsPaid` every paid cost ever,
 * `vatToSetAside` the VAT on every paid invoice ever. Reported 11 Sep: the number
 * only ever grows, so it becomes less useful the longer a trade uses motko.
 *
 * It is worse than merely growing, and in two directions at once:
 *
 *   NOT VAT-REGISTERED — drifts UP. A trade's real outgoings (wages, van, fuel,
 *   rent, their own drawings) never enter `job_costs`, so collected outruns costs
 *   forever and a figure labelled "safe to spend" counts money spent months ago.
 *
 *   VAT-REGISTERED — drifts DOWN. `vatToSetAside` is the VAT on every paid
 *   invoice ever and is never reduced by the VAT returns actually filed, so it
 *   keeps setting aside money already paid over to HMRC.
 *
 * Scoping to a period fixes the VAT term outright — only the unfiled quarter is
 * still owed — and makes the rest answer a question a trade actually has ("how
 * did this quarter go?") rather than one nobody asked.
 *
 * THE STAGGER IS ASSUMED, and this is the one thing here worth revisiting. HMRC
 * puts a business in one of three quarterly stagger groups (ending Mar/Jun/Sep/Dec,
 * Jan/Apr/Jul/Oct, or Feb/May/Aug/Nov) and motko does not store which. Calendar
 * quarters are stagger group 1, the most common, and are what this assumes. A
 * trade on another stagger sees a window one or two months out from their real
 * return period. Storing the stagger needs a column and a setting; until then the
 * period is always NAMED on the card, so a trade can see which window they are
 * being shown rather than having to infer it.
 *
 * Dates are compared as ISO `yyyy-mm-dd` strings, which order lexicographically,
 * so there is no timezone arithmetic to get wrong. A row with no date is NOT in
 * any period — see `isWithinPeriod`.
 */

export type MoneyPeriodKind = "vat-quarter" | "tax-year";

export type MoneyPeriod = {
  kind: MoneyPeriodKind;
  /** Inclusive, `yyyy-mm-dd`. */
  start: string;
  /** Inclusive, `yyyy-mm-dd`. */
  end: string;
  /** How the card names it, e.g. "1 Jul – 30 Sep 2026". */
  label: string;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const pad = (value: number): string => String(value).padStart(2, "0");

const iso = (year: number, month: number, day: number): string =>
  `${year}-${pad(month)}-${pad(day)}`;

/** Last day of a 1-indexed month. Day 0 of the next month is that day. */
const lastDayOf = (year: number, month: number): number =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();

/**
 * The calendar quarter containing `now`.
 *
 * Calendar quarters rather than the trade's real VAT stagger — see the note at
 * the top of this file. Named on the card either way.
 */
export const currentVatQuarter = (now: Date): MoneyPeriod => {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const startMonth = month - ((month - 1) % 3);
  const endMonth = startMonth + 2;
  const endDay = lastDayOf(year, endMonth);

  return {
    kind: "vat-quarter",
    start: iso(year, startMonth, 1),
    end: iso(year, endMonth, endDay),
    label: `1 ${MONTHS[startMonth - 1]} – ${endDay} ${MONTHS[endMonth - 1]} ${year}`,
  };
};

/**
 * The UK tax year containing `now` — 6 April to 5 April, which is the rhythm a
 * sole trader's self-assessment runs on.
 */
export const currentTaxYear = (now: Date): MoneyPeriod => {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const day = now.getUTCDate();

  // On or after 6 April the year starts this calendar year; before it, last.
  const startYear = month > 4 || (month === 4 && day >= 6) ? year : year - 1;

  return {
    kind: "tax-year",
    start: iso(startYear, 4, 6),
    end: iso(startYear + 1, 4, 5),
    label: `6 Apr ${startYear} – 5 Apr ${startYear + 1}`,
  };
};

/**
 * The window to reckon over: the VAT quarter for a registered trade, the tax year
 * for everyone else.
 *
 * A trade who is not VAT-registered has no quarter that means anything to them,
 * and a tax year is the period they will actually be asked about.
 */
export const currentMoneyPeriod = (now: Date, isVatRegistered: boolean): MoneyPeriod =>
  isVatRegistered ? currentVatQuarter(now) : currentTaxYear(now);

/**
 * Whether a recorded date falls inside the period.
 *
 * A MISSING DATE IS NOT IN ANY PERIOD, deliberately. A row that does not say when
 * it was paid cannot be placed in a window, and guessing would put money in a
 * quarter on no evidence. It drops out of the period figures and stays in the
 * all-time ones, where it is still counted and still visible.
 *
 * Accepts a full timestamp or a bare date; only the first ten characters are
 * read, so `2026-08-01T09:13:00.000Z` and `2026-08-01` behave identically.
 */
export const isWithinPeriod = (
  date: string | null | undefined,
  period: MoneyPeriod,
): boolean => {
  if (!date) return false;
  const day = date.slice(0, 10);
  if (day.length !== 10) return false;
  return day >= period.start && day <= period.end;
};
