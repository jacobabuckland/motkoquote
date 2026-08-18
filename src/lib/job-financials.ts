// LED-2: Job-level P&L computation
//
// All amounts are in pence for exact integer arithmetic. The function is the
// single source of truth for "did I make money" and must be correct.

export type JobCost = {
  amount_pence: number;
  vat_treatment: "standard" | "zero" | "exempt";
  paid: boolean;
};

export type Invoice = {
  amount: number; // in pounds
  invoice_type: string;
};

export type JobPnL = {
  invoicedNetPence: number;
  costsNetPence: number;
  grossProfitPence: number;
  marginPct: number;
  vatCollectedPence: number;
  vatOnCostsPence: number;
  vatPositionPence: number;
  unpaidCostsPence: number;
  notYetInvoiced?: boolean; // true when invoicedNetPence === 0
};

const VAT_RATE = 0.2; // 20% UK VAT

export function computeJobPnL(
  invoices: unknown[],
  costs: unknown[],
  vatRegistered: boolean,
): JobPnL {
  // Cast to proper types for internal use
  const typedInvoices = invoices as Invoice[];
  const typedCosts = costs as JobCost[];

  // Sum all invoices (convert pounds to pence)
  const invoicedGrossPence = typedInvoices.reduce(
    (sum, inv) => sum + Math.round(inv.amount * 100),
    0,
  );

  // For VAT-registered contractors, invoices are gross (inc VAT)
  // Extract VAT: gross / 1.2 = net, gross - net = VAT
  const invoicedNetPence = vatRegistered
    ? Math.round(invoicedGrossPence / (1 + VAT_RATE))
    : invoicedGrossPence;

  const vatCollectedPence = vatRegistered
    ? invoicedGrossPence - invoicedNetPence
    : 0;

  // Sum all costs (already in pence)
  const costsNetPence = typedCosts.reduce((sum, cost) => sum + cost.amount_pence, 0);

  // VAT on costs (only standard-rated costs have VAT)
  const vatOnCostsPence = vatRegistered
    ? typedCosts
        .filter((c) => c.vat_treatment === "standard")
        .reduce((sum, cost) => {
          // Cost is gross if contractor is VAT registered, extract VAT
          const net = Math.round(cost.amount_pence / (1 + VAT_RATE));
          return sum + (cost.amount_pence - net);
        }, 0)
    : 0;

  // Gross profit
  const grossProfitPence = invoicedNetPence - costsNetPence;

  // Margin (as percentage)
  const marginPct =
    invoicedNetPence > 0 ? (grossProfitPence / invoicedNetPence) * 100 : 0;

  // VAT position
  const vatPositionPence = vatCollectedPence - vatOnCostsPence;

  // Unpaid costs
  const unpaidCostsPence = typedCosts
    .filter((c) => !c.paid)
    .reduce((sum, cost) => sum + cost.amount_pence, 0);

  return {
    invoicedNetPence,
    costsNetPence,
    grossProfitPence,
    marginPct,
    vatCollectedPence,
    vatOnCostsPence,
    vatPositionPence,
    unpaidCostsPence,
    notYetInvoiced: invoicedNetPence === 0,
  };
}
