import { Money } from "@/components/ui/money";

type JobPnLProps = {
  data: {
    invoicedNet: number;
    costsNet: number;
    grossProfit: number;
    marginPct: number | null;
    unpaidCosts: number;
    hasInvoice: boolean;
    costCount?: number;
    netIsExact?: boolean;
  } | null;
  contractorVatRegistered: boolean;
};

export function JobPnL({ data, contractorVatRegistered }: JobPnLProps) {
  if (!data) {
    return (
      <div className="rounded-lg border p-6">
        <h2 className="text-xl font-semibold mb-4">Profit & Loss</h2>
        <p className="text-muted-foreground">Unable to load P&L data.</p>
      </div>
    );
  }

  const {
    invoicedNet,
    costsNet,
    grossProfit,
    marginPct,
    unpaidCosts,
    hasInvoice,
    costCount,
    netIsExact,
  } = data;

  // THE LABEL IS A CLAIM ABOUT THE FIGURE, so it only makes it where the
  // figure supports it. `netIsExact` is false when any invoice on the job has
  // no recorded VAT, in which case the amount above is that row's gross and
  // "(net)" would be the same assertion that made "Invoiced (net) £3,620.28"
  // read against a net of £3,016.90 on 14 Sep.
  //
  // Only an EXPLICIT false drops the label. `getJobPnL` is the sole producer
  // of this shape and always sets the flag, so `undefined` never reaches here
  // from the app — it is a caller written before the flag existed, and
  // `tests/acceptance/457.test.tsx` froze one. Treating that as "cannot vouch
  // for it" would have broken a frozen assertion this item's card does not
  // name, which AGENTS.md is explicit about: that is a defect in the fix, not
  // a retirement candidate.
  const netClaimHolds = netIsExact !== false;

  // Use costCount if available (distinguishes "no costs" from "costs that sum to zero"),
  // otherwise fall back to costsNet for backward compatibility with frozen tests
  const isEmpty = !hasInvoice && (costCount !== undefined ? costCount === 0 : costsNet === 0);

  return (
    <div className="rounded-lg border p-6 space-y-4">
      <h2 className="text-xl font-semibold">Profit & Loss</h2>

      {isEmpty ? (
        <p className="text-muted-foreground">
          Nothing invoiced and no costs recorded yet. Add costs as the job runs
          to track profit and loss.
        </p>
      ) : (
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">
              {netClaimHolds ? "Invoiced (net)" : "Invoiced"}
            </span>
            {hasInvoice ? (
              <Money amount={invoicedNet / 100} size="total" />
            ) : (
              <span className="text-ink-secondary">Not yet invoiced</span>
            )}
          </div>

          {hasInvoice && !netClaimHolds && (
            <p className="text-xs text-ink-secondary">
              VAT wasn&apos;t recorded on this job&apos;s invoices, so this is the amount
              invoiced including any VAT. Profit below may be overstated by that VAT.
            </p>
          )}

          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Costs (net)</span>
            <Money amount={costsNet / 100} size="total" />
          </div>

          <div className="border-t pt-3">
            <div className="flex justify-between items-center">
              <span className="font-semibold">Gross profit</span>
              {hasInvoice ? (
                <div className="text-right">
                  <Money amount={grossProfit / 100} size="total" />
                  {marginPct !== null && (
                    <div className="text-sm text-muted-foreground">
                      {marginPct.toFixed(1)}%
                    </div>
                  )}
                </div>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </div>
          </div>

          {unpaidCosts > 0 && (
            <div className="rounded-md border border-amber bg-amber-tint p-3">
              <p className="text-sm text-amber-ink">
                <Money amount={unpaidCosts / 100} /> of costs still to pay
              </p>
            </div>
          )}
        </div>
      )}

      <p className="text-xs text-ink-secondary">
        Estimate only, not tax advice. Check with your accountant.
      </p>
    </div>
  );
}
