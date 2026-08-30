import { Money } from "@/components/ui/money";

type JobPnLProps = {
  data: {
    invoicedNet: number;
    costsNet: number;
    grossProfit: number;
    marginPct: number | null;
    unpaidCosts: number;
    hasInvoice: boolean;
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
  } = data;

  return (
    <div className="rounded-lg border p-6 space-y-4">
      <h2 className="text-xl font-semibold">Profit & Loss</h2>

      <div className="space-y-3">
        <div className="flex justify-between items-center">
          <span className="text-muted-foreground">Invoiced (net)</span>
          {hasInvoice ? (
            <Money amount={invoicedNet / 100} size="total" />
          ) : (
            <span className="text-muted-foreground italic">Not yet invoiced</span>
          )}
        </div>

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
          <div className="bg-amber-50 border border-amber-200 rounded-md p-3">
            <p className="text-sm text-amber-900">
              <Money amount={unpaidCosts / 100} /> of costs still to pay
            </p>
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground italic">
        Estimate only, not tax advice. Check with your accountant.
      </p>
    </div>
  );
}
