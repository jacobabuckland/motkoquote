/**
 * The money a contract was RAISED at, not the money its quote says today.
 *
 * PASS-14 SERIOUS 1. The summary box at the top of a public contract page was
 * computed live from the quote; the clause bodies below it are frozen at send
 * time in `rendered_body`. Once the quote moved, the same page stated two
 * different totals:
 *
 *   Summary header   Total £1,800.00   Deposit £600.00
 *   Clause 2 Price   Total £1,440.00
 *   Clause 3 Payment                   Deposit £360.00
 *
 * A customer opening the link they were emailed saw £1,800 in bold at the top
 * of a document whose price clause says £1,440 — the two surfaces disagreeing
 * by £360 on one page, and the bold one is the one that gets read.
 *
 * There is nothing to add to the schema. `contracts.variables_json` has stored
 * the rendered money since the table was created: the clause text is produced
 * from exactly these values, so reading them back is reading the document
 * rather than a second opinion about it.
 *
 * WHY THIS APPLIES TO LIVE CONTRACTS TOO, not only withdrawn and declined ones.
 * A sent, unsigned contract locks its quote against editing, so live and frozen
 * agree and preferring the frozen pair changes nothing. Special-casing dead
 * contracts would leave the divergence one guard-bypass away from returning,
 * for no benefit. The document is the source of truth about itself.
 */

/** What the header needs, in pounds. */
export type ContractMoney = {
  total: number;
  /** Null where the contract was raised with no deposit. */
  deposit: number | null;
  balance: number;
};

/**
 * Reads back a figure this codebase formatted with `formatGBP` — "£1,440.00",
 * and "£-20.00" for the negative it should never see but might.
 *
 * Returns null for the empty string, which is what `deposit_amount` holds when
 * no deposit was agreed, and for anything else it cannot make a number of.
 * Null is never treated as zero: "no deposit" and "a deposit of nothing" differ,
 * and conflating them is how a 100%-deposit contract came to promise a balance.
 */
export const parseFormattedGBP = (value: unknown): number | null => {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[^0-9.-]/g, "");
  if (cleaned === "" || cleaned === "-" || cleaned === ".") return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * @param variables `contracts.variables_json` as stored — `unknown`, because it
 *   crosses an `as unknown as` cast out of the Supabase client and a precise
 *   annotation here would be asserted rather than checked.
 * @param live What the page computes from the quote today. Used only where the
 *   frozen figure is absent or unreadable, so a contract raised before these
 *   variables existed keeps rendering exactly as it does now rather than
 *   showing a blank where a total should be.
 */
export const contractMoney = (
  variables: unknown,
  live: { total: number; deposit: number | null },
): ContractMoney => {
  const frozen =
    variables && typeof variables === "object" ? (variables as Record<string, unknown>) : null;

  const total = parseFormattedGBP(frozen?.total_price) ?? live.total;

  // The deposit is three-valued and the fallback must not flatten it. An empty
  // `deposit_amount` is a POSITIVE statement that no deposit was agreed, so it
  // reads as null rather than falling through to the live figure — otherwise a
  // contract raised with no deposit would start showing one the moment the
  // quote gained it.
  const deposit = frozen && "deposit_amount" in frozen
    ? parseFormattedGBP(frozen.deposit_amount)
    : live.deposit;

  return { total, deposit, balance: total - (deposit ?? 0) };
};
