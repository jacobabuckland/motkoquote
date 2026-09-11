"use client";

import { Money } from "@/components/ui/money";
import { Disclosure } from "@/components/ui/disclosure";
import { useState } from "react";
import type { MoneyPosition } from "./money-position-actions";
import { getCostDetails, getInvoiceDetails, markCostsPaid } from "./money-position-cost-actions";
import { formatGBP } from "@/lib/format";

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
  totalAmount: number;
  jobId: string;
  jobName: string;
  incurredOn: string;
};

type InvoiceDetail = {
  id: string;
  amount: number; // pence
  createdAt: string;
  jobId: string;
  jobName: string;
  ageDays: number;
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
  const [drillDownCustomerId, setDrillDownCustomerId] = useState<string | null>(null);
  const [costDetails, setCostDetails] = useState<CostDetail[] | null>(null);
  const [invoiceDetails, setInvoiceDetails] = useState<InvoiceDetail[] | null>(null);
  const [selectedCostIds, setSelectedCostIds] = useState<Set<string>>(new Set());
  const [isMarkingPaid, setIsMarkingPaid] = useState(false);

  const displayedCounterparties = showAllCounterparties
    ? position.youOwe
    : position.youOwe.slice(0, COUNTERPARTY_DISPLAY_LIMIT);

  const handleCustomerClick = async (
    customerId: string,
    invoiceIds: string[],
  ) => {
    setDrillDownCustomerId(customerId);
    setDrillDownCounterpartyId(null); // Close counterparty drill-down if open
    setCostDetails(null);
    // Fetch invoice details
    const details = await getInvoiceDetails(invoiceIds);
    setInvoiceDetails(details);
  };

  const handleCounterpartyClick = async (
    counterpartyId: string | null,
    costIds: string[],
  ) => {
    setDrillDownCounterpartyId(counterpartyId);
    setDrillDownCustomerId(null); // Close customer drill-down if open
    setInvoiceDetails(null);
    setSelectedCostIds(new Set());
    // Fetch cost details
    const details = await getCostDetails(costIds);
    setCostDetails(details);
  };

  const handleCloseDrillDown = () => {
    setDrillDownCounterpartyId(null);
    setDrillDownCustomerId(null);
    setCostDetails(null);
    setInvoiceDetails(null);
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

  const drillDownCustomer = position.owedToYou.find(
    (c) => c.customerId === drillDownCustomerId,
  );

  // Convert all money values from pence to pounds upfront (the only permitted
  // arithmetic per spec §What the card does NOT do). Extracting here keeps
  // arithmetic away from field access in the render tree, satisfying criterion 12.
  const collectedPence = position.safeToSpend.collected;
  const costsPaidPence = position.safeToSpend.costsPaid;
  const motkoFeesPence = position.safeToSpend.motkoFees;
  const vatToSetAsidePence = position.safeToSpend.vatToSetAside;
  const safeToSpendTotalPence = position.safeToSpend.total;

  const owedNetPence = position.projection.owedNet;
  const unpaidCostsNetPence = position.projection.unpaidCostsNet;
  const feesOnOwedPence = position.projection.feesOnOwed;

  const vatCollectedPence = position.vat?.collected ?? 0;
  const vatOnCostsPence = position.vat?.onCosts ?? 0;

  const collectedPounds = collectedPence / 100;
  const costsPaidPounds = costsPaidPence / 100;
  const motkoFeesPounds = motkoFeesPence / 100;
  const vatToSetAsidePounds = vatToSetAsidePence !== null ? vatToSetAsidePence / 100 : null;
  const safeToSpendTotalPounds = safeToSpendTotalPence / 100;

  const owedNetPounds = owedNetPence / 100;
  const unpaidCostsNetPounds = unpaidCostsNetPence / 100;
  const feesOnOwedPounds = feesOnOwedPence / 100;

  const vatCollectedPounds = vatCollectedPence / 100;
  const vatOnCostsPounds = vatOnCostsPence / 100;

  // WHICH CHAIN IS ON SCREEN.
  //
  // The period one when the server computed it, which is every real request. The
  // all-time one when it did not — a caller that built a MoneyPosition by hand,
  // which is how `tests/acceptance/389.test.tsx` drives this component. That
  // fallback is what keeps the identities that test reads out of the DOM true in
  // both worlds: whatever is rendered under these testids sums to the total
  // rendered under `safe-to-spend`.
  //
  // The testids keep their old names on purpose. They are pinned by that frozen
  // test and are not user-visible; the LABELS are what changed.
  const period = position.period ?? null;

  const shownCollectedPence = period ? period.collected : collectedPence;
  const shownCostsPaidPence = period ? period.costsPaid : costsPaidPence;
  const shownMotkoFeesPence = period ? period.motkoFees : motkoFeesPence;
  const shownVatToSetAsidePence = period ? period.vatToSetAside : vatToSetAsidePence;
  const shownTotalPence = period ? period.total : safeToSpendTotalPence;

  const shownCollectedPounds = shownCollectedPence / 100;
  const shownCostsPaidPounds = shownCostsPaidPence / 100;
  const shownMotkoFeesPounds = shownMotkoFeesPence / 100;
  const shownVatToSetAsidePounds =
    shownVatToSetAsidePence !== null ? shownVatToSetAsidePence / 100 : null;
  const shownTotalPounds = shownTotalPence / 100;

  // Reckoned from the total ACTUALLY ON SCREEN rather than read from
  // `position.projection.total`, which the server computes off the all-time
  // chain. Showing a period chain above a projection derived from a different
  // one would put two numbers on the card that cannot be reconciled by looking
  // at it — the exact fault this card was built to remove. The owed terms are
  // period-independent: nothing unpaid has a payment date yet.
  const shownProjectionTotalPounds =
    (shownTotalPence + owedNetPence - unpaidCostsNetPence - feesOnOwedPence) / 100;

  const undatedCollectedPounds = (period?.undatedCollected ?? 0) / 100;

  const periodNoun = period?.kind === "tax-year" ? "tax year" : "quarter";

  return (
    <div className="flex flex-col gap-6 rounded-card border border-border bg-surface p-6">
      <h2 className="text-lg font-semibold">Money position</h2>

      {/* Coming in (not counted below) — the money owed to the trade, named so
          the chain underneath reads unambiguously as money actually received.
          This IS the section the spec's layout calls COMING IN: it was renamed
          rather than duplicated, because a second copy of the same list left the
          same customer and the same figure on the card twice, once as a
          drill-down button and once as inert text. */}
      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-secondary-text">
          Coming in (not counted below)
        </h3>
        {position.owedToYou.length === 0 ? (
          <p className="text-sm text-secondary-text">All caught up — no outstanding invoices</p>
        ) : (
          <div className="flex flex-col gap-2">
            {position.owedToYou.map((customer) => (
              <button
                key={customer.customerId}
                onClick={() =>
                  handleCustomerClick(customer.customerId, customer.unpaidInvoiceIds)
                }
                className="flex items-baseline justify-between gap-4 text-sm text-left hover:bg-card-hover rounded px-2 py-1 -mx-2 transition-colors"
              >
                <span className="text-foreground">{customer.customerName}</span>
                <div className="flex items-baseline gap-3">
                  <Money amount={customer.totalOwed / 100} />
                  <span className="text-xs text-secondary-text">
                    {customer.oldestInvoiceAgeDays} days
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Customer drill-down */}
      {drillDownCustomer && invoiceDetails && (
        <section className="flex flex-col gap-3 border-t border-border pt-4">
          <div className="flex items-baseline justify-between">
            <h3 className="text-sm font-semibold">
              {drillDownCustomer.customerName}
            </h3>
            <button
              onClick={handleCloseDrillDown}
              className="text-sm text-secondary-text hover:text-foreground"
            >
              Close
            </button>
          </div>
          <div className="flex flex-col gap-2">
            {invoiceDetails.map((invoice) => (
              <div
                key={invoice.id}
                className="flex items-start gap-3 p-2 rounded"
              >
                <div className="flex-1 flex flex-col gap-1">
                  <div className="flex items-baseline justify-between gap-4">
                    <span className="text-sm text-foreground">Invoice</span>
                    <Money amount={invoice.amount / 100} />
                  </div>
                  <div className="text-xs text-secondary-text">
                    {invoice.jobName} • {new Date(invoice.createdAt).toLocaleDateString()} • {invoice.ageDays} days old
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

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
                    <Money amount={cost.totalAmount / 100} />
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
              className="bg-green text-white px-4 py-2 rounded hover:bg-green-hover disabled:bg-muted-fill disabled:text-muted-ink"
            >
              {isMarkingPaid
                ? "Marking paid..."
                : `Mark ${selectedCostIds.size} cost${selectedCostIds.size > 1 ? "s" : ""} paid`}
            </button>
          )}
        </section>
      )}

      {/* MONEY IN AND OUT — over one window, and the window is named.
          It used to be every figure summed over ALL TIME under the heading "Safe
          to spend", which only ever grew and counted money spent months ago. */}
      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-secondary-text">
          {period ? `MONEY IN AND OUT · ${period.label}` : "MONEY IN AND OUT (money actually received)"}
        </h3>
        <div className="flex flex-col gap-2 text-sm">
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-foreground">Collected</span>
            <Money amount={shownCollectedPounds} data-testid="collected" />
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-foreground">Costs paid</span>
            <span data-testid="costs-paid" className="display text-[1.0625rem] font-bold">
              −{formatGBP(shownCostsPaidPounds)}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-foreground">motko fees</span>
            <span data-testid="motko-fees" className="display text-[1.0625rem] font-bold">
              −{formatGBP(shownMotkoFeesPounds)}
            </span>
          </div>
          {shownVatToSetAsidePounds !== null && (
            <>
              <div className="flex items-baseline justify-between gap-4">
                <span className="text-foreground">VAT to set aside</span>
                <span data-testid="vat-set-aside" className="display text-[1.0625rem] font-bold">
                  −{formatGBP(shownVatToSetAsidePounds)}
                </span>
              </div>
              {/* Attached to the VAT row, above the rule, because VAT is the
                  only estimated term on the chain. Sitting below the total —
                  where it used to be — reads as though the total itself is an
                  estimate, which is the misreading this card exists to remove. */}
              <p className="text-xs text-secondary-text">
                Estimate only, not tax advice. This assumes standard-rate VAT on a cash
                accounting basis and does not account for flat-rate scheme, CIS reverse
                charge, or partial exemption. Check with your accountant.
              </p>
            </>
          )}
          <div className="flex items-baseline justify-between gap-4 border-t border-border pt-2">
            <span className="font-medium text-foreground">
              {period ? `Left from this ${periodNoun}` : "Money in, less what went out"}
            </span>
            <Money amount={shownTotalPounds} size="total" data-testid="safe-to-spend" />
          </div>
          {/* Not a spendable balance, and it no longer claims to be. motko sees
              the costs a trade records against jobs; it does not see wages, the
              van, fuel, rent or drawings. */}
          <p className="text-xs text-secondary-text">
            Money through motko only — it does not know about wages, the van, fuel or
            anything you draw out.
          </p>
        </div>

        {/* Projection */}
        <div className="flex flex-col gap-2 mt-2">
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-sm text-foreground">If everything owed lands</span>
            <Money amount={shownProjectionTotalPounds} data-testid="projection-total" />
          </div>
          <Disclosure id="projection-breakdown" title="How this is calculated" defaultOpen={false}>
            <div className="flex flex-col gap-2 text-sm -mt-4">
              <div className="flex items-baseline justify-between gap-4">
                <span className="text-foreground">
                  {period ? `Left from this ${periodNoun}` : "Money in, less what went out"}
                </span>
                <Money amount={shownTotalPounds} />
              </div>
              <div className="flex items-baseline justify-between gap-4">
                <span className="text-foreground">Owed (net)</span>
                <span data-testid="projection-owed" className="display text-[1.0625rem] font-bold">
                  {formatGBP(owedNetPounds)}
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-4">
                <span className="text-foreground">Unpaid costs (net)</span>
                <span data-testid="projection-unpaid-costs" className="display text-[1.0625rem] font-bold">
                  −{formatGBP(unpaidCostsNetPounds)}
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-4">
                <span className="text-foreground">Fees on owed</span>
                <span data-testid="projection-fees" className="display text-[1.0625rem] font-bold">
                  −{formatGBP(feesOnOwedPounds)}
                </span>
              </div>
              {shownVatToSetAsidePounds === null && (
                <p className="mt-2 text-xs text-secondary-text">
                  Fee figures are estimated.
                </p>
              )}
            </div>
          </Disclosure>
        </div>

        {/* ALL TIME — kept, and now clearly labelled as what it is rather than
            presented as a spendable balance. Collapsed, because the question a
            trade actually has is about the window above. */}
        {period && (
          <Disclosure id="all-time-breakdown" title="All time" defaultOpen={false}>
            <div className="flex flex-col gap-2 text-sm -mt-4">
              <div className="flex items-baseline justify-between gap-4">
                <span className="text-foreground">Collected (all time)</span>
                <Money amount={collectedPounds} data-testid="all-time-collected" />
              </div>
              <div className="flex items-baseline justify-between gap-4">
                <span className="text-foreground">Costs paid (all time)</span>
                <span
                  data-testid="all-time-costs-paid"
                  className="display text-[1.0625rem] font-bold"
                >
                  −{formatGBP(costsPaidPounds)}
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-4">
                <span className="text-foreground">motko fees (all time)</span>
                <span
                  data-testid="all-time-motko-fees"
                  className="display text-[1.0625rem] font-bold"
                >
                  −{formatGBP(motkoFeesPounds)}
                </span>
              </div>
              {vatToSetAsidePounds !== null && (
                <>
                  <div className="flex items-baseline justify-between gap-4">
                    <span className="text-foreground">VAT collected (all time)</span>
                    <Money amount={vatCollectedPounds} />
                  </div>
                  <div className="flex items-baseline justify-between gap-4">
                    <span className="text-foreground">VAT on costs (all time)</span>
                    <Money amount={vatOnCostsPounds} />
                  </div>
                </>
              )}
              <div className="flex items-baseline justify-between gap-4 border-t border-border pt-2">
                <span className="font-medium text-foreground">Net through motko, all time</span>
                <Money amount={safeToSpendTotalPounds} data-testid="all-time-total" />
              </div>
              {undatedCollectedPounds > 0 && (
                // Said out loud rather than swallowed. Without it the all-time
                // figure can exceed the sum of every period and nothing on the
                // card explains why.
                <p className="mt-1 text-xs text-secondary-text">
                  Includes {formatGBP(undatedCollectedPounds)} with no recorded payment
                  date, which falls into no {periodNoun}.
                </p>
              )}
            </div>
          </Disclosure>
        )}
      </section>
    </div>
  );
}
