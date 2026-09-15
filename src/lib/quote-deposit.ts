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

/**
 * The deposit to invoice when the customer signs, and which source said so.
 *
 * `quotes.deposit_pennies` WINS when it is set, because it is what the
 * customer was shown and agreed to. `contracts.deposit_pct` is the fallback
 * for the seven rows that predate the column, and it stays — the point of the
 * change is to stop NEW deposits being invented on the contract, not to
 * invalidate the old ones.
 *
 * A RECORDED ZERO RAISES NO INVOICE, and that is the whole reason zero is
 * storable. It means the trade was asked and said no deposit, so the signature
 * must not fall through to a percentage typed on the contract to clear a
 * field. Null falls through; zero does not.
 *
 * Returns pounds, because that is the unit `invoices.amount` and
 * `createInvoiceRecord` both use. The pennies live in the column and stop here.
 */
export function depositAtSignature(
  quote: { total: number; deposit_pennies?: number | null },
  contract: { deposit_pct?: number | null },
): { amount: number; source: "quote" | "contract" } | null {
  const recorded = quote.deposit_pennies;
  if (recorded != null) {
    if (recorded === 0) return null;
    return { amount: Math.round(recorded) / 100, source: "quote" };
  }

  const pct = contract.deposit_pct;
  if (!pct) return null;
  return {
    amount: Math.round(quote.total * (pct / 100) * 100) / 100,
    source: "contract",
  };
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
