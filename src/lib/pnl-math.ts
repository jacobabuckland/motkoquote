/**
 * P&L computation functions for job-level profit and margin calculations.
 * All amounts are in integer pence.
 */

/**
 * Compute gross profit from invoiced and cost amounts.
 * @param invoicedNet - Total invoiced amount in pence
 * @param costsNet - Total costs in pence
 * @returns Gross profit in pence (may be negative for loss-making jobs)
 */
export function computeGrossProfit(invoicedNet: number, costsNet: number): number {
  return invoicedNet - costsNet;
}

/**
 * Compute margin percentage from profit and invoiced amounts.
 * @param profit - Gross profit in pence
 * @param invoiced - Total invoiced amount in pence
 * @returns Margin as a percentage, or null if invoiced is zero
 */
export function computeMarginPct(profit: number, invoiced: number): number | null {
  if (invoiced === 0) return null;
  return (profit / invoiced) * 100;
}
