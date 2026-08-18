import { describe, it, expect } from "vitest";
import { computeJobPnL } from "./job-financials";

describe("computeJobPnL", () => {
  it("handles job with no costs", () => {
    const invoices = [{ amount: 100, invoice_type: "final" }];
    const costs: never[] = [];

    const result = computeJobPnL(invoices, costs, false);

    expect(result.invoicedNetPence).toBe(10000);
    expect(result.costsNetPence).toBe(0);
    expect(result.grossProfitPence).toBe(10000);
    expect(result.marginPct).toBe(100);
    expect(result.unpaidCostsPence).toBe(0);
  });

  it("handles unpaid costs", () => {
    const invoices = [{ amount: 100, invoice_type: "final" }];
    const costs = [
      { amount_pence: 3000, vat_treatment: "standard" as const, paid: false },
      { amount_pence: 2000, vat_treatment: "zero" as const, paid: false },
    ];

    const result = computeJobPnL(invoices, costs, false);

    expect(result.costsNetPence).toBe(5000);
    expect(result.unpaidCostsPence).toBe(5000);
  });

  it("handles negative cost (refund)", () => {
    const invoices = [{ amount: 100, invoice_type: "final" }];
    const costs = [
      { amount_pence: 5000, vat_treatment: "standard" as const, paid: true },
      { amount_pence: -2000, vat_treatment: "standard" as const, paid: true },
    ];

    const result = computeJobPnL(invoices, costs, false);

    expect(result.costsNetPence).toBe(3000);
    expect(result.grossProfitPence).toBe(7000);
  });

  it("handles job with no invoice", () => {
    const invoices: never[] = [];
    const costs = [{ amount_pence: 3000, vat_treatment: "zero" as const, paid: true }];

    const result = computeJobPnL(invoices, costs, false);

    expect(result.invoicedNetPence).toBe(0);
    expect(result.costsNetPence).toBe(3000);
    expect(result.grossProfitPence).toBe(-3000);
    expect(result.notYetInvoiced).toBe(true);
  });

  it("handles costs exceeding invoiced value (loss)", () => {
    const invoices = [{ amount: 100, invoice_type: "final" }];
    const costs = [
      { amount_pence: 8000, vat_treatment: "standard" as const, paid: true },
      { amount_pence: 5000, vat_treatment: "zero" as const, paid: true },
    ];

    const result = computeJobPnL(invoices, costs, false);

    expect(result.invoicedNetPence).toBe(10000);
    expect(result.costsNetPence).toBe(13000);
    expect(result.grossProfitPence).toBe(-3000);
    expect(result.marginPct).toBeCloseTo(-30, 2);
  });

  it("computes VAT correctly for VAT-registered contractor", () => {
    const invoices = [{ amount: 120, invoice_type: "final" }];
    const costs = [
      { amount_pence: 6000, vat_treatment: "standard" as const, paid: true },
      { amount_pence: 3000, vat_treatment: "zero" as const, paid: true },
    ];

    const result = computeJobPnL(invoices, costs, true);

    expect(result.vatCollectedPence).toBeGreaterThan(0);
    expect(result.vatOnCostsPence).toBeGreaterThan(0);
    expect(result.vatPositionPence).toBe(
      result.vatCollectedPence - result.vatOnCostsPence,
    );
  });

  it("excludes VAT for non-VAT-registered contractor", () => {
    const invoices = [{ amount: 100, invoice_type: "final" }];
    const costs = [{ amount_pence: 5000, vat_treatment: "standard" as const, paid: true }];

    const result = computeJobPnL(invoices, costs, false);

    expect(result.vatCollectedPence).toBe(0);
    expect(result.vatOnCostsPence).toBe(0);
    expect(result.vatPositionPence).toBe(0);
  });
});
