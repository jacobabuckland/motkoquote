"use client";

import { Money } from "@/components/ui/money";
import { useState } from "react";
import type { MoneyPosition } from "./money-position-actions";
import { getCostDetails, markCostsPaid } from "./money-position-cost-actions";

/**
 * Top N counterparties to show before "See all" expansion.
 * Threshold determined by testing at 390px width per spec §Edge cases #2.
 */
const COUNTERPARTY_DISPLAY_LIMIT = 10;

type CostDetail = {
  id: string;
  description: string;
  amountNet: number;
  vatAmount: number | null;
  jobId: string;
  jobName: string;
  incurredOn: string;
};

type MoneyPositionClientProps = {
  position: MoneyPosition;
};

/**
 * Money position panel for the dashboard (client component).
 * Shows cross-job aggregates: owed to you, you owe, VAT position, what's left.
 * All amounts server-computed in pence, converted to pounds for display.
 */
export function MoneyPositionClient({ position }: MoneyPositionClientProps) {
  const [showAllCounterparties, setShowAllCounterparties] = useState(false);
  const [drillDownCounterpartyId, setDrillDownCounterpartyId] = useState<string | null>(null);
  const [costDetails, setCostDetails] = useState<CostDetail[] | null>(null);
  const [selectedCostIds, setSelectedCostIds] = useState<Set<string>>(new Set());
  const [isMarkingPaid, setIsMarkingPaid] = useState(false);

  const displayedCounterparties = showAllCounterparties
    ? position.youOwe
    : position.youOwe.slice(0, COUNTERPARTY_DISPLAY_LIMIT);

  const handleCounterpartyClick = async (
    counterpartyId: string | null,
    costIds: string[],
  ) => {
    setDrillDownCounterpartyId(counterpartyId);
    setSelectedCostIds(new Set());
    // Fetch cost details
    const details = await getCostDetails(costIds);
    setCostDetails(details);
  };

  const handleCloseDrillDown = () => {
    setDrillDownCounterpartyId(null);
    setCostDetails(null);
    setSelectedCostIds(new Set());
  };

  const handleToggleCost = (costId: string) => {
    const newSelection = new Set(selectedCostIds);
    if (newSelection.has(costId)) {
      newSelection.delete(costId);
    } else {
      newSelection.add(costId);
    }
    setSelectedCostIds(newSelection);
  };

  const handleMarkPaid = async () => {
    if (selectedCostIds.size === 0) return;

    setIsMarkingPaid(true);
    const today = new Date().toISOString().split("T")[0] as string;
    const result = await markCostsPaid(Array.from(selectedCostIds), today);

    if (result.ok) {
      // Reload the page to show updated money position
      window.location.reload();
    } else {
      alert(`Failed to mark costs as paid: ${result.error}`);
      setIsMarkingPaid(false);
    }
  };

  const drillDownCounterparty = position.youOwe.find(
    (c) => c.counterpartyId === drillDownCounterpartyId,
  );

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
                  <Money amount={customer.totalOwed / 100} />
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
          <>
            <div className="flex flex-col gap-2">
              {displayedCounterparties.map((counterparty, idx) => (
                <button
                  key={counterparty.counterpartyId ?? `no-counterparty-${idx}`}
                  onClick={() =>
                    handleCounterpartyClick(counterparty.counterpartyId, counterparty.costIds)
                  }
                  className="flex items-baseline justify-between gap-4 text-sm text-left hover:bg-card-hover rounded px-2 py-1 -mx-2 transition-colors"
                >
                  <span className="text-foreground">
                    {counterparty.counterpartyName ?? "No counterparty specified"}
                  </span>
                  <div className="flex items-baseline gap-3">
                    <Money amount={counterparty.totalOwed / 100} />
                    {counterparty.jobCount > 1 && (
                      <span className="text-xs text-secondary-text">
                        across {counterparty.jobCount} jobs
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
            {position.youOwe.length > COUNTERPARTY_DISPLAY_LIMIT && (
              <button
                onClick={() => setShowAllCounterparties(!showAllCounterparties)}
                className="text-sm text-green hover:underline self-start"
              >
                {showAllCounterparties
                  ? "Show less"
                  : `See all ${position.youOwe.length} counterparties`}
              </button>
            )}
          </>
        )}
      </section>

      {/* Counterparty drill-down */}
      {drillDownCounterparty && costDetails && (
        <section className="flex flex-col gap-3 border-t border-border pt-4">
          <div className="flex items-baseline justify-between">
            <h3 className="text-sm font-semibold">
              {drillDownCounterparty.counterpartyName ?? "No counterparty specified"}
            </h3>
            <button
              onClick={handleCloseDrillDown}
              className="text-sm text-secondary-text hover:text-foreground"
            >
              Close
            </button>
          </div>
          <div className="flex flex-col gap-2">
            {costDetails.map((cost) => (
              <label
                key={cost.id}
                className="flex items-start gap-3 p-2 hover:bg-card-hover rounded cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selectedCostIds.has(cost.id)}
                  onChange={() => handleToggleCost(cost.id)}
                  className="mt-1"
                />
                <div className="flex-1 flex flex-col gap-1">
                  <div className="flex items-baseline justify-between gap-4">
                    <span className="text-sm text-foreground">{cost.description}</span>
                    <Money
                      amount={
                        (cost.amountNet + (cost.vatAmount ?? 0)) / 100
                      }
                    />
                  </div>
                  <div className="text-xs text-secondary-text">
                    {cost.jobName} • {new Date(cost.incurredOn).toLocaleDateString()}
                  </div>
                </div>
              </label>
            ))}
          </div>
          {selectedCostIds.size > 0 && (
            <button
              onClick={handleMarkPaid}
              disabled={isMarkingPaid}
              className="bg-green text-white px-4 py-2 rounded hover:bg-green-hover disabled:opacity-50"
            >
              {isMarkingPaid
                ? "Marking paid..."
                : `Mark ${selectedCostIds.size} cost${selectedCostIds.size > 1 ? "s" : ""} paid`}
            </button>
          )}
        </section>
      )}

      {/* Set aside (VAT) - only shown if VAT-registered */}
      {position.vat && (
        <section className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-secondary-text">
            Set aside
          </h3>
          <div className="flex flex-col gap-2 text-sm">
            <div className="flex items-baseline justify-between gap-4">
              <span className="text-foreground">VAT collected</span>
              <Money amount={position.vat.collected / 100} />
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <span className="text-foreground">VAT on costs</span>
              <Money amount={position.vat.onCosts / 100} />
            </div>
            <div className="flex items-baseline justify-between gap-4 border-t border-border pt-2">
              <span className="font-medium text-foreground">VAT position</span>
              <Money amount={position.vat.position / 100} size="total" />
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
          <span className="text-sm text-foreground">
            Money collected, minus costs you&rsquo;ve paid
          </span>
          <Money amount={position.whatsLeft / 100} size="total" />
        </div>
      </section>
    </div>
  );
}
