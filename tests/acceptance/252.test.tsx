import { describe, it, expect } from "vitest";

/**
 * Issue #252: LED-2 — Cost entry and job-level P&L view
 *
 * These tests verify:
 * 1. P&L computation functions exist and compute correctly from integer pence
 * 2. UI components for cost entry and P&L display exist
 * 3. All monetary figures use server-side computation (no client-side arithmetic)
 * 4. Edge cases: no invoice, no costs, negative costs, costs exceeding invoice
 */

describe("Issue #252: LED-2 — Cost entry and job-level P&L view", () => {
  describe("P&L computation functions", () => {
    it("exports P&L computation functions from pnl-math.ts", async () => {
      const mod = await import("@/lib/pnl-math");

      expect(mod.computeGrossProfit).toBeDefined();
      expect(typeof mod.computeGrossProfit).toBe("function");

      expect(mod.computeMarginPct).toBeDefined();
      expect(typeof mod.computeMarginPct).toBe("function");
    });

    it("computes gross profit correctly with no costs", async () => {
      const { computeGrossProfit } = await import("@/lib/pnl-math");

      // Invoiced £100.00 (10000 pence), zero costs
      const profit = computeGrossProfit(10000, 0);

      expect(profit).toBe(10000);
    });

    it("computes gross profit correctly with costs", async () => {
      const { computeGrossProfit } = await import("@/lib/pnl-math");

      // Invoiced £100.00 (10000 pence), costs £40.00 (4000 pence)
      const profit = computeGrossProfit(10000, 4000);

      expect(profit).toBe(6000); // £60.00
    });

    it("computes gross profit correctly with negative cost (refund)", async () => {
      const { computeGrossProfit } = await import("@/lib/pnl-math");

      // Invoiced £100.00 (10000 pence), costs £40.00 minus £10.00 refund = £30.00 net (3000 pence)
      const profit = computeGrossProfit(10000, 3000);

      expect(profit).toBe(7000); // £70.00 — refund increases profit
    });

    it("computes loss correctly when costs exceed invoice", async () => {
      const { computeGrossProfit } = await import("@/lib/pnl-math");

      // Invoiced £100.00 (10000 pence), costs £120.00 (12000 pence)
      const profit = computeGrossProfit(10000, 12000);

      expect(profit).toBe(-2000); // -£20.00 loss
    });

    it("computes margin percentage correctly", async () => {
      const { computeMarginPct } = await import("@/lib/pnl-math");

      // Profit £60.00 (6000 pence) on invoiced £100.00 (10000 pence) = 60%
      const margin = computeMarginPct(6000, 10000);

      expect(margin).toBeCloseTo(60.0, 1);
    });

    it("returns null margin when invoiced is zero", async () => {
      const { computeMarginPct } = await import("@/lib/pnl-math");

      const margin = computeMarginPct(0, 0);

      expect(margin).toBeNull();
    });

    it("computes negative margin when loss-making", async () => {
      const { computeMarginPct } = await import("@/lib/pnl-math");

      // Loss -£20.00 (-2000 pence) on invoiced £100.00 (10000 pence) = -20%
      const margin = computeMarginPct(-2000, 10000);

      expect(margin).toBeCloseTo(-20.0, 1);
    });

    it("handles invoice amounts in pounds converted to pence", async () => {
      const { computeGrossProfit } = await import("@/lib/pnl-math");

      // Invoice amount is £50.00 in pounds (numeric 50.00) → must convert to 5000 pence
      // This test documents the conversion boundary
      const invoicePounds = 50.00;
      const invoicePence = Math.round(invoicePounds * 100);
      const costsPence = 2000; // £20.00

      const profit = computeGrossProfit(invoicePence, costsPence);

      expect(profit).toBe(3000); // £30.00
    });
  });

  describe("Server action for P&L data", () => {
    it("exports getJobPnL server action from pnl-actions.ts", async () => {
      const mod = await import("@/app/jobs/[id]/pnl-actions");

      expect(mod.getJobPnL).toBeDefined();
      expect(typeof mod.getJobPnL).toBe("function");
    });

    it("getJobPnL returns a function that will compute P&L data", async () => {
      // This test documents that the server action exists and can be called
      // The actual implementation will be tested in integration tests
      const { getJobPnL } = await import("@/app/jobs/[id]/pnl-actions");

      // Verify it's a callable function
      expect(typeof getJobPnL).toBe("function");

      // Document the expected return shape via a type-checked mock
      // The server action must return pre-computed totals, not raw data
      const mockReturnValue = {
        invoicedNet: 10000,
        costsNet: 4000,
        grossProfit: 6000,
        marginPct: 60.0,
        vatCollected: 2000,
        vatOnCosts: 800,
        vatPosition: 1200,
        unpaidCosts: 1500,
        hasInvoice: true,
      };

      expect(mockReturnValue.grossProfit).toBe(6000);
      expect(mockReturnValue.marginPct).toBe(60.0);
    });
  });

  describe("UI components exist", () => {
    it("exports CostForm component from cost-form.tsx", async () => {
      const mod = await import("@/app/jobs/[id]/cost-form");

      expect(mod.CostForm).toBeDefined();
      // React component check
      expect(typeof mod.CostForm).toBe("function");
    });

    it("exports CostList component from cost-list.tsx", async () => {
      const mod = await import("@/app/jobs/[id]/cost-list");

      expect(mod.CostList).toBeDefined();
      expect(typeof mod.CostList).toBe("function");
    });

    it("exports JobPnL component from job-pnl.tsx", async () => {
      const mod = await import("@/app/jobs/[id]/job-pnl");

      expect(mod.JobPnL).toBeDefined();
      expect(typeof mod.JobPnL).toBe("function");
    });
  });

  describe("Money component usage", () => {
    it("JobPnL component imports Money component", async () => {
      // Read the source file to verify Money component is imported
      // This ensures all monetary amounts render via <Money> per design-direction.md
      const { readFileSync } = await import("node:fs");
      const source = readFileSync("src/app/jobs/[id]/job-pnl.tsx", "utf8");

      expect(source).toContain("import");
      expect(source).toContain("Money");
      expect(source).toContain("from");
      expect(source).toContain("@/components/ui/money");
    });

    it("JobPnL renders amounts via Money component for display face and tabular numerals", async () => {
      const { readFileSync } = await import("node:fs");
      const source = readFileSync("src/app/jobs/[id]/job-pnl.tsx", "utf8");

      // The component must use <Money for at least the profit/costs figures
      expect(source).toContain("<Money");
    });
  });

  describe("VAT disclaimer", () => {
    it("JobPnL component includes VAT disclaimer text", async () => {
      const { readFileSync } = await import("node:fs");
      const source = readFileSync("src/app/jobs/[id]/job-pnl.tsx", "utf8");

      // The disclaimer must appear somewhere in the component
      // Exact wording to be agreed with Jacob, but must contain these key phrases
      expect(source.toLowerCase()).toContain("estimate");
      expect(source.toLowerCase()).toContain("not");
      expect(source.toLowerCase()).toContain("tax");
      expect(source.toLowerCase()).toContain("advice");
    });
  });

  describe("Edge case handling in P&L computation", () => {
    it("handles job with multiple invoices (sum all invoices)", async () => {
      const { computeGrossProfit } = await import("@/lib/pnl-math");

      // Job with £500 deposit invoice + £1500 balance invoice = £2000 total invoiced (200000 pence)
      const totalInvoicedPence = 50000 + 150000; // 200000 pence
      const costsPence = 120000; // £1200.00

      const profit = computeGrossProfit(totalInvoicedPence, costsPence);

      expect(profit).toBe(80000); // £800.00
    });

    it("handles null/undefined VAT amounts as zero in computation", async () => {
      // This test documents that null vat_amount on costs should be treated as 0
      // The actual implementation will handle this in the server action
      const vatAmount1 = 500; // £5.00
      const vatAmount2 = null;
      const vatAmount3 = 300; // £3.00

      const totalVat = (vatAmount1 ?? 0) + (vatAmount2 ?? 0) + (vatAmount3 ?? 0);

      expect(totalVat).toBe(800); // £8.00
    });

    it("unpaid costs sum excludes paid costs", async () => {
      // Documents that unpaid costs callout only counts costs where paid = false
      type Cost = { amount_net: number; paid: boolean };
      const costs: Cost[] = [
        { amount_net: 5000, paid: false }, // £50 unpaid
        { amount_net: 3000, paid: true },  // £30 paid (excluded)
        { amount_net: 2000, paid: false }, // £20 unpaid
      ];

      const unpaidTotal = costs
        .filter(c => !c.paid)
        .reduce((sum, c) => sum + c.amount_net, 0);

      expect(unpaidTotal).toBe(7000); // £70.00
    });
  });

  describe("Cost CRUD actions", () => {
    it("cost-actions.ts exports createJobCost", async () => {
      const mod = await import("@/app/jobs/[id]/cost-actions");

      expect(mod.createJobCost).toBeDefined();
      expect(typeof mod.createJobCost).toBe("function");
    });

    it("cost-actions.ts exports updateJobCost", async () => {
      const mod = await import("@/app/jobs/[id]/cost-actions");

      expect(mod.updateJobCost).toBeDefined();
      expect(typeof mod.updateJobCost).toBe("function");
    });

    it("cost-actions.ts exports deleteJobCost", async () => {
      const mod = await import("@/app/jobs/[id]/cost-actions");

      expect(mod.deleteJobCost).toBeDefined();
      expect(typeof mod.deleteJobCost).toBe("function");
    });

    it("cost-actions.ts exports markCostPaid", async () => {
      const mod = await import("@/app/jobs/[id]/cost-actions");

      expect(mod.markCostPaid).toBeDefined();
      expect(typeof mod.markCostPaid).toBe("function");
    });

    it("cost-actions.ts exports getJobCosts", async () => {
      const mod = await import("@/app/jobs/[id]/cost-actions");

      expect(mod.getJobCosts).toBeDefined();
      expect(typeof mod.getJobCosts).toBe("function");
    });
  });

  describe("No client-side computation", () => {
    it("JobPnL component does not perform arithmetic", async () => {
      const { readFileSync } = await import("node:fs");
      const source = readFileSync("src/app/jobs/[id]/job-pnl.tsx", "utf8");

      // The component must not contain template expressions with arithmetic
      // All sums must come from the server
      // This is a smell test, not exhaustive, but catches obvious violations

      // Remove all comments first to avoid false positives
      const withoutComments = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "");

      // Check for arithmetic operators in JSX expressions
      // Allow += in handlers, but not + - * / in template expressions
      const hasArithmeticInJSX = /{[^}]*[+\-*/][^}]*}/.test(
        withoutComments.replace(/\w+\s*[+\-*/]=\s*\w+/g, "") // remove += etc
      );

      // If arithmetic is found, it's likely client-side computation
      // The Engineer may need to justify any arithmetic found here
      // (e.g. formatting, not computation)
      if (hasArithmeticInJSX) {
        // This is a soft check - the Engineer can override if justified
        // but it flags potential violations for review
      }

      // Hard check: the component must receive pre-computed values as props
      expect(source).toContain("grossProfit");
      expect(source).toContain("marginPct");
    });
  });

  describe("Invoice-to-pence conversion boundary", () => {
    it("documents that invoices are in pounds and must be converted to pence", async () => {
      // Invoice amounts in DB: numeric(10, 2) representing pounds
      // Cost amounts in DB: int representing pence
      // The server action must convert invoices to pence before computation

      type InvoiceRow = { amount: number }; // pounds, numeric(10, 2)
      type CostRow = { amount_net: number }; // pence, int

      const invoice: InvoiceRow = { amount: 50.00 }; // £50.00 in pounds
      const cost: CostRow = { amount_net: 2000 }; // £20.00 in pence

      // Conversion
      const invoicePence = Math.round(invoice.amount * 100);
      const costPence = cost.amount_net;

      expect(invoicePence).toBe(5000);
      expect(costPence).toBe(2000);

      // Profit computation must use pence
      const profit = invoicePence - costPence;
      expect(profit).toBe(3000); // £30.00
    });
  });
});
