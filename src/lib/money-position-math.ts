/**
 * Money position aggregation functions.
 * All amounts in pence (integer). Invoices are converted from pounds to pence.
 */

type UnpaidCost = {
  id: string;
  counterpartyId: string | null;
  counterpartyName: string | null;
  amountNet: number; // pence
  vatAmount: number | null; // pence
  jobId: string;
  paid: boolean;
};

type UnpaidInvoice = {
  id: string;
  customerId: string;
  customerName: string;
  amount: number; // pounds (numeric from DB)
  createdAt: string; // ISO timestamp
  paid: boolean;
};

type PaidInvoiceForVAT = {
  id: string;
  amount: number; // pounds
  vatAmount: number; // pounds
};

type PaidCostForVAT = {
  id: string;
  vatAmount: number | null; // pence
};

export type CounterpartyAggregate = {
  counterpartyId: string | null;
  counterpartyName: string | null;
  totalOwed: number; // pence
  jobCount: number;
  costIds: string[];
};

export type CustomerAggregate = {
  customerId: string;
  customerName: string;
  totalOwed: number; // pence
  oldestInvoiceAgeDays: number;
  unpaidInvoiceIds: string[];
};

export type VATPosition = {
  collected: number; // pence
  onCosts: number; // pence
  position: number; // pence
};

/**
 * Aggregates unpaid costs by counterparty.
 * Costs with counterpartyId = null are grouped together.
 * Costs marked as paid are excluded.
 */
export function aggregateByCounterparty(costs: UnpaidCost[]): CounterpartyAggregate[] {
  // Filter to unpaid costs only
  const unpaid = costs.filter((c) => !c.paid);

  // Group by counterparty ID (null is a valid group)
  const grouped = new Map<string | null, UnpaidCost[]>();
  for (const cost of unpaid) {
    const key = cost.counterpartyId;
    const existing = grouped.get(key) ?? [];
    existing.push(cost);
    grouped.set(key, existing);
  }

  // Aggregate each group
  const result: CounterpartyAggregate[] = [];
  for (const [counterpartyId, groupCosts] of grouped) {
    const totalOwed = groupCosts.reduce((sum, c) => {
      const net = c.amountNet;
      const vat = c.vatAmount ?? 0;
      return sum + net + vat;
    }, 0);

    const uniqueJobs = new Set(groupCosts.map((c) => c.jobId));
    const costIds = groupCosts.map((c) => c.id);

    result.push({
      counterpartyId,
      counterpartyName: groupCosts[0]?.counterpartyName ?? null,
      totalOwed,
      jobCount: uniqueJobs.size,
      costIds,
    });
  }

  // Sort by totalOwed descending
  return result.sort((a, b) => b.totalOwed - a.totalOwed);
}

/**
 * Aggregates unpaid invoices by customer.
 * Converts invoice amounts from pounds to pence.
 * Calculates oldest invoice age in days relative to `today` (ISO date string).
 */
export function aggregateByCustomer(
  invoices: UnpaidInvoice[],
  today: string,
): CustomerAggregate[] {
  // Filter to unpaid invoices only
  const unpaid = invoices.filter((i) => !i.paid);

  // Group by customer ID
  const grouped = new Map<string, UnpaidInvoice[]>();
  for (const invoice of unpaid) {
    const key = invoice.customerId;
    const existing = grouped.get(key) ?? [];
    existing.push(invoice);
    grouped.set(key, existing);
  }

  // Aggregate each group
  const result: CustomerAggregate[] = [];

  for (const [customerId, groupInvoices] of grouped) {
    // Convert pounds to pence (multiply by 100)
    const totalOwed = groupInvoices.reduce((sum, i) => sum + Math.round(i.amount * 100), 0);

    // Find oldest invoice
    const oldest = groupInvoices.reduce((oldest, i) =>
      new Date(i.createdAt) < new Date(oldest.createdAt) ? i : oldest,
    );

    // Calculate age in calendar days (not 24-hour periods)
    // Strip time component from both dates to count full days
    const oldestDate = new Date(oldest.createdAt).toISOString().split("T")[0] as string;
    const oldestMs = new Date(oldestDate).getTime();
    const todayMs = new Date(today).getTime();
    const oldestInvoiceAgeDays = Math.round((todayMs - oldestMs) / (1000 * 60 * 60 * 24));

    const unpaidInvoiceIds = groupInvoices.map((i) => i.id);

    result.push({
      customerId,
      customerName: groupInvoices[0]?.customerName ?? "",
      totalOwed,
      oldestInvoiceAgeDays,
      unpaidInvoiceIds,
    });
  }

  // Sort by totalOwed descending
  return result.sort((a, b) => b.totalOwed - a.totalOwed);
}

/**
 * Computes VAT position from paid invoices and paid costs.
 * Invoice amounts are in pounds, cost vat_amount is in pence.
 * Returns all values in pence.
 */
export function computeVATPosition(
  paidInvoices: PaidInvoiceForVAT[],
  paidCosts: PaidCostForVAT[],
): VATPosition {
  // VAT collected: sum of vatAmount on paid invoices, convert to pence
  const collected = paidInvoices.reduce((sum, i) => sum + Math.round(i.vatAmount * 100), 0);

  // VAT on costs: sum of vat_amount on paid costs (already in pence)
  const onCosts = paidCosts.reduce((sum, c) => sum + (c.vatAmount ?? 0), 0);

  const position = collected - onCosts;

  return {
    collected,
    onCosts,
    position,
  };
}
