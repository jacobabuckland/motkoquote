import { Money } from "@/components/ui/money";
import { formatDate } from "@/lib/format";

export type ContractorPayout = {
  stripe_payout_id: string;
  amount_pennies: number;
  status: string;
  arrival_date: string | null;
  created_at: string;
};

type Props = {
  payouts: ContractorPayout[];
};

/**
 * "Deposited" — the second money state.
 *
 * "Paid" means the customer paid. That was the only money state the product
 * had, and it is why "marked as paid but no monies was received" was a sentence
 * whose two halves were both true: the customer had paid, and the money had not
 * moved on. This is the half that was missing.
 *
 * Two rules the copy here exists to keep, and both are the same rule:
 *
 * 1. **Never show the state without the date.** Stripe's `payout.paid` means it
 *    SENT the money, not that it arrived — `arrival_date` is Stripe's own
 *    estimate and BACS can take another working day. "Deposited" on its own
 *    reads as "it is in my account", which is the same overclaim as the green
 *    "Connected ✓" that started all of this.
 * 2. **A failed payout must never read as money received.** It is the same
 *    defect pointed the other way, and it is worse: a trade told they were paid
 *    when the payment bounced will not chase it.
 */
export const PayoutHistorySection = ({ payouts }: Props) => {
  const successful = payouts.filter((p) => p.status === "paid");
  const latest = successful[0];

  return (
    <section>
      <h3 className="mb-1 text-sm font-semibold">Deposits</h3>

      {payouts.length === 0 ? (
        // Says nothing has happened yet rather than rendering an empty space a
        // trade has to interpret. "Nothing here" and "this is broken" look
        // identical when the answer is blank.
        <p className="text-sm text-text-secondary">
          Nothing sent to your bank yet. Once a customer pays, your money is
          sent on and you&apos;ll see it here.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {latest && (
            <div className="flex flex-col gap-0.5">
              <p className="text-lg font-semibold tabular-nums">
                <Money amount={latest.amount_pennies / 100} />
              </p>
              <p className="text-sm text-text-secondary">
                {/* State and date together, always. See the note above. */}
                Sent {formatDate(latest.created_at)}
                {latest.arrival_date
                  ? ` · with you by ${formatDate(latest.arrival_date)}`
                  : " · usually with you within a working day or two"}
              </p>
            </div>
          )}

          {payouts.length > 1 && (
            <ul className="flex flex-col gap-2 border-t border-border pt-3">
              {payouts.slice(1).map((payout) => (
                <li
                  key={payout.stripe_payout_id}
                  className="flex items-baseline justify-between gap-3"
                >
                  <span className="text-sm text-text-secondary">
                    {formatDate(payout.created_at)}
                    {payout.status === "failed" && (
                      // Never folded into the total or the headline figure.
                      <span className="ml-2 font-medium text-error">
                        didn&apos;t go through
                      </span>
                    )}
                  </span>
                  <span
                    className={`text-sm tabular-nums ${
                      payout.status === "failed"
                        ? "text-text-muted line-through"
                        : "font-medium"
                    }`}
                  >
                    <Money amount={payout.amount_pennies / 100} />
                  </span>
                </li>
              ))}
            </ul>
          )}

          {payouts.some((p) => p.status === "failed") && (
            <p className="text-xs text-error">
              A deposit didn&apos;t go through. Check your bank details above,
              then contact support if it happens again.
            </p>
          )}
        </div>
      )}
    </section>
  );
};
