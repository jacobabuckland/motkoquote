import { formatGBP } from "@/lib/format";
import { getMoneyPosition } from "./money-position-actions";

/**
 * Money position panel for the dashboard.
 * Shows cross-job aggregates: owed to you, you owe, VAT position, what's left.
 * All amounts server-computed in pence, converted to pounds for display.
 */
export async function MoneyPosition() {
  const position = await getMoneyPosition();

  return (
    <div className="flex flex-col gap-6 rounded-card border border-border bg-surface p-6">
      <h2 className="text-lg font-semibold">Money position</h2>

      {/* Owed to you */}
      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-secondary-text">
          Owed to you
        </h3>
        {position.owedToYou.length === 0 ? (
          <p className="text-sm text-secondary-text">All caught up — no outstanding invoices</p>
        ) : (
          <div className="flex flex-col gap-2">
            {position.owedToYou.map((customer) => (
              <div
                key={customer.customerId}
                className="flex items-baseline justify-between gap-4 text-sm"
              >
                <span className="text-foreground">{customer.customerName}</span>
                <div className="flex items-baseline gap-3">
                  <span className="tabular-nums font-medium text-foreground">
                    {formatGBP(customer.totalOwed / 100)}
                  </span>
                  <span className="text-xs text-secondary-text">
                    {customer.oldestInvoiceAgeDays} days
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* You owe */}
      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-secondary-text">
          You owe
        </h3>
        {position.youOwe.length === 0 ? (
          <p className="text-sm text-secondary-text">All costs paid</p>
        ) : (
          <div className="flex flex-col gap-2">
            {position.youOwe.map((counterparty, idx) => (
              <div
                key={counterparty.counterpartyId ?? `no-counterparty-${idx}`}
                className="flex items-baseline justify-between gap-4 text-sm"
              >
                <span className="text-foreground">
                  {counterparty.counterpartyName ?? "No counterparty specified"}
                </span>
                <div className="flex items-baseline gap-3">
                  <span className="tabular-nums font-medium text-foreground">
                    {formatGBP(counterparty.totalOwed / 100)}
                  </span>
                  {counterparty.jobCount > 1 && (
                    <span className="text-xs text-secondary-text">
                      across {counterparty.jobCount} jobs
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Set aside (VAT) - only shown if VAT-registered */}
      {position.vat && (
        <section className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-secondary-text">
            Set aside
          </h3>
          <div className="flex flex-col gap-2 text-sm">
            <div className="flex items-baseline justify-between gap-4">
              <span className="text-foreground">VAT collected</span>
              <span className="tabular-nums font-medium text-foreground">
                {formatGBP(position.vat.collected / 100)}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <span className="text-foreground">VAT on costs</span>
              <span className="tabular-nums font-medium text-foreground">
                {formatGBP(position.vat.onCosts / 100)}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-4 border-t border-border pt-2">
              <span className="font-medium text-foreground">VAT position</span>
              <span className="tabular-nums font-semibold text-foreground">
                {formatGBP(position.vat.position / 100)}
              </span>
            </div>
          </div>
          <p className="mt-1 text-xs text-secondary-text">
            Estimate only, not tax advice. This assumes standard-rate VAT on a cash accounting
            basis and does not account for flat-rate scheme, CIS reverse charge, or partial
            exemption. Check with your accountant.
          </p>
        </section>
      )}

      {/* What's left */}
      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-secondary-text">
          What&rsquo;s left
        </h3>
        <div className="flex items-baseline justify-between gap-4">
          <span className="text-sm text-foreground">Money collected, minus costs you&rsquo;ve paid</span>
          <span className="tabular-nums text-lg font-semibold text-foreground">
            {formatGBP(position.whatsLeft / 100)}
          </span>
        </div>
      </section>
    </div>
  );
}
