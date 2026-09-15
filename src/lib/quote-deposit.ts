// The deposit, as a thing agreed when the price is agreed.
//
// Deposits existed only as `contracts.deposit_pct`, a number entered after the
// customer had already accepted. Seven production contracts carry it and two
// are at 1% on £7-8k jobs — £72 and £81, figures typed to clear a required
// field. The quote the customer reads never mentioned a deposit at all.
//
// Migration 81 adds `quotes.deposit_pennies`, and this is the whole of the
// arithmetic: parsing what the trade typed, and deciding which of the two
// sources a signature should read.

/** The Pay by Bank ceiling a single payment cannot exceed. */
import { PAY_BY_BANK_LIMIT_PENNIES } from "@/app/i/[id]/pay-panel";

export type DepositParse =
  | { ok: true; pennies: number | null }
  | { ok: false; error: string };

const PERCENT = /^(\d{1,3}(?:\.\d{1,2})?)\s*%$/;
const AMOUNT = /^£?\s*(\d{1,9}(?:,\d{3})*(?:\.\d{1,2})?)$/;

/**
 * What the trade typed, against the quote total, in pennies.
 *
 * Accepts a percentage ("25%", "12.5%") or an amount ("£500", "500", "1,250.00").
 * Both are common ways to say the same thing and a trade should not have to
 * know which the field wants.
 *
 * RETURNS NULL PENNIES FOR AN EMPTY FIELD, and that is not the same as zero.
 * Null is "no deposit on this quote", the ordinary case. Zero is "we agreed a
 * deposit of nothing", which is an answer — and it is recorded, so that a job
 * which deliberately took no deposit is distinguishable from one where nobody
 * asked. The same distinction migration 80 draws for VAT.
 *
 * ERRORS ARE RETURNED, NEVER THROWN. This runs against a field a person is
 * typing into, and a half-typed "2" on the way to "25%" must not explode.
 */
export function parseDeposit(raw: string | null | undefined, totalPennies: number): DepositParse {
  const text = (raw ?? "").trim();
  if (text === "") return { ok: true, pennies: null };

  const percentMatch = PERCENT.exec(text);
  const amountMatch = AMOUNT.exec(text);

  let pennies: number;
  if (percentMatch) {
    const pct = Number(percentMatch[1]);
    if (pct > 100) return { ok: false, error: "A deposit can't be more than 100% of the quote." };
    // Rounded to the penny at the end, so 33.33% of £740 is one figure and not
    // a repeating decimal the invoice would then re-round differently.
    pennies = Math.round(totalPennies * (pct / 100));
  } else if (amountMatch) {
    pennies = Math.round(Number(amountMatch[1].replace(/,/g, "")) * 100);
  } else {
    return { ok: false, error: "Enter an amount like £500, or a percentage like 25%." };
  }

  if (pennies > totalPennies) {
    return { ok: false, error: "A deposit can't be more than the quote total." };
  }
  if (pennies > PAY_BY_BANK_LIMIT_PENNIES) {
    // Not a validation nicety: a single payment over the ceiling cannot be
    // taken on the rail at all, so the customer would be sent a demand they
    // have no way to pay.
    return {
      ok: false,
      error: `A single payment can't be more than £${PAY_BY_BANK_LIMIT_PENNIES / 100}. Split the job into stages instead.`,
    };
  }

  return { ok: true, pennies };
}

export type DepositSource = "quote" | "contract";

export type ResolvedDeposit = {
  /** The authoritative figure, in pennies. */
  pennies: number;
  /** The same figure in POUNDS — what `invoices.amount` and the documents use. */
  amount: number;
  source: DepositSource;
  /**
   * The percentage to name in a label, and ONLY where the contract stated one.
   *
   * A deposit agreed on the quote may be a flat amount — £500 on a £740 job is
   * 67.57%, a figure nobody typed and nobody should read on a contract. So a
   * quote-sourced deposit carries no percentage and is labelled plainly.
   */
  statedPct: number | null;
};

/**
 * THE ONE RESOLVER. Every surface that states a deposit calls this.
 *
 * The rule (Jacob, 15 Sep, after the pass-7 review): the quote's deposit wins;
 * `contracts.deposit_pct` applies only where the quote records none; a recorded
 * zero means no deposit and is never overridden.
 *
 * `quotes.deposit_pennies` WINS because it is what the customer was shown and
 * agreed to. `contracts.deposit_pct` is the fallback for the seven rows that
 * predate the column, and it stays — the point is to stop NEW deposits being
 * invented on the contract, not to invalidate the old ones.
 *
 * A RECORDED ZERO RESOLVES TO NOTHING, and that is the whole reason zero is
 * storable. It means the trade was asked and said no deposit, so nothing must
 * fall through to a percentage typed on the contract to clear a field. Null
 * falls through; zero does not.
 *
 * WHY THIS EXISTS RATHER THAN THREE COPIES OF THE ARITHMETIC. Until 15 Sep the
 * signature trigger read this rule and the contract DOCUMENT did not: the
 * contract body, the /c/ page and the PDF each recomputed from `deposit_pct`
 * alone. A deposit set on the quote was therefore invisible to the contract
 * the customer signed — the document said the full amount was due on
 * completion — and then authoritative for the invoice raised seconds later.
 * Reported on a £3,600 job whose customer signed for "Balance on completion
 * £3,600.00" and was billed £900 on signature, with automated chasing attached.
 */
export function resolveDeposit(
  quote: { total: number; deposit_pennies?: number | null },
  contract: { deposit_pct?: number | null } | null | undefined,
): ResolvedDeposit | null {
  const recorded = quote.deposit_pennies;
  if (recorded != null) {
    if (recorded === 0) return null;
    const pennies = Math.round(recorded);
    return { pennies, amount: pennies / 100, source: "quote", statedPct: null };
  }

  const pct = contract?.deposit_pct;
  if (!pct) return null;
  const amount = Math.round(quote.total * (pct / 100) * 100) / 100;
  return { pennies: Math.round(amount * 100), amount, source: "contract", statedPct: pct };
}

/** How a resolved deposit is labelled on a document. See `statedPct`. */
export const depositRowLabel = (deposit: ResolvedDeposit): string =>
  deposit.statedPct != null ? `Deposit (${deposit.statedPct}%)` : "Deposit";

/**
 * The deposit to invoice when the customer signs, and which source said so.
 *
 * A narrowing of `resolveDeposit` to the two fields the trigger needs. Kept as
 * its own export because `tests/acceptance/722.test.ts` pins this exact shape
 * with `toEqual`, and because the signature path has no use for a label.
 *
 * Returns pounds, because that is the unit `invoices.amount` and
 * `createInvoiceRecord` both use. The pennies live in the column and stop here.
 */
export function depositAtSignature(
  quote: { total: number; deposit_pennies?: number | null },
  contract: { deposit_pct?: number | null },
): { amount: number; source: DepositSource } | null {
  const resolved = resolveDeposit(quote, contract);
  return resolved ? { amount: resolved.amount, source: resolved.source } : null;
}

/**
 * How the deposit reads on the customer's own quote page.
 *
 * Null where there is nothing to say — no deposit agreed, or one agreed at
 * nothing. A line reading "Deposit: £0.00 due on acceptance" is noise on a
 * document whose job is to be signed.
 */
export function depositLine(depositPennies: number | null | undefined): string | null {
  if (depositPennies == null || depositPennies <= 0) return null;
  const pounds = (depositPennies / 100).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `Deposit of £${pounds} due on acceptance`;
}
