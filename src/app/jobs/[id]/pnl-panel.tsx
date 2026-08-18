import { Money } from "@/components/ui/money";
import type { JobPnL } from "@/lib/job-financials";

type PnLPanelProps = {
  pnl: JobPnL;
  vatRegistered: boolean;
};

export function PnLPanel({ pnl, vatRegistered }: PnLPanelProps) {
  const {
    invoicedNetPence,
    costsNetPence,
    grossProfitPence,
    marginPct,
    vatCollectedPence,
    vatOnCostsPence,
    vatPositionPence,
    unpaidCostsPence,
    notYetInvoiced,
  } = pnl;

  const isLoss = grossProfitPence < 0;

  return (
    <div className="space-y-4">
      {/* Unpaid costs callout */}
      {unpaidCostsPence > 0 && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-sm text-sm">
          <Money amount={unpaidCostsPence / 100} /> of costs still to pay
        </div>
      )}

      {/* Main P&L */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-ink-secondary">Invoiced (net)</span>
          {notYetInvoiced ? (
            <span className="text-sm text-ink-secondary">Not yet invoiced</span>
          ) : (
            <Money amount={invoicedNetPence / 100} />
          )}
        </div>

        <div className="flex items-center justify-between">
          <span className="text-sm text-ink-secondary">Costs (net)</span>
          <Money amount={costsNetPence / 100} />
        </div>

        <div className="border-t border-line pt-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-ink">Gross profit</span>
            {notYetInvoiced ? (
              <span className="text-sm text-ink-secondary">—</span>
            ) : (
              <div className="flex items-center gap-2">
                <Money
                  amount={grossProfitPence / 100}
                  className={isLoss ? "text-red-600" : ""}
                />
                <span
                  className={`text-sm font-semibold ${isLoss ? "text-red-600" : "text-ink-secondary"}`}
                >
                  ({marginPct.toFixed(1)}%)
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* VAT section - only for VAT-registered contractors */}
      {vatRegistered && (
        <>
          <div className="border-t border-line-strong pt-4 mt-4" />
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-ink-secondary">VAT collected</span>
              <Money amount={vatCollectedPence / 100} />
            </div>

            <div className="flex items-center justify-between">
              <span className="text-sm text-ink-secondary">VAT on costs</span>
              <Money amount={vatOnCostsPence / 100} />
            </div>

            <div className="border-t border-line pt-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-ink">VAT position</span>
                <Money amount={vatPositionPence / 100} />
              </div>
            </div>

            <div className="mt-4 p-3 bg-neutral-50 rounded-sm text-xs text-ink-secondary">
              This is an estimate for your information, not tax advice. Consult your
              accountant for VAT liability.
            </div>
          </div>
        </>
      )}
    </div>
  );
}
