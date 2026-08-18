/**
 * @vitest-environment happy-dom
 */

import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";

describe("LED-2: Cost entry and job-level P&L view", () => {
  it("creates a job_costs migration with required columns", async () => {
    const migrationsDir = path.join(process.cwd(), "supabase/migrations");
    const files = await fs.readdir(migrationsDir);
    const jobCostsMigration = files.find((f) => f.includes("job_costs"));

    expect(jobCostsMigration).toBeDefined();

    const content = await fs.readFile(
      path.join(migrationsDir, jobCostsMigration!),
      "utf-8",
    );

    // Table exists
    expect(content).toMatch(/create table.*job_costs/i);

    // Required columns
    expect(content).toMatch(/job_id.*uuid.*references jobs/i);
    expect(content).toMatch(/description.*text.*not null/i);
    expect(content).toMatch(/amount_pence.*integer.*not null/i);
    expect(content).toMatch(/category.*text/i);
    expect(content).toMatch(/counterparty.*text/i);
    expect(content).toMatch(/incurred_on.*date.*not null/i);
    expect(content).toMatch(/vat_treatment.*text.*not null/i);
    expect(content).toMatch(/paid.*boolean.*not null/i);
    expect(content).toMatch(/paid_on.*date/i);

    // VAT treatment constraint
    expect(content).toMatch(/check.*vat_treatment.*in.*standard.*zero.*exempt/i);

    // RLS enabled
    expect(content).toMatch(/enable row level security.*job_costs/i);

    // Contractor-scoped RLS policy
    expect(content).toMatch(/create policy.*job_costs/i);
    expect(content).toMatch(/contractor.*owner_user_id.*auth\.uid/i);
  });

  it("exports cost action functions", async () => {
    const mod = await import("@/app/jobs/cost-actions");

    expect(mod.addJobCost).toBeDefined();
    expect(mod.updateJobCost).toBeDefined();
    expect(mod.deleteJobCost).toBeDefined();
    expect(mod.markCostPaid).toBeDefined();

    expect(typeof mod.addJobCost).toBe("function");
    expect(typeof mod.updateJobCost).toBe("function");
    expect(typeof mod.deleteJobCost).toBe("function");
    expect(typeof mod.markCostPaid).toBe("function");
  });

  it("exports the P&L computation function", async () => {
    const mod = await import("@/lib/job-financials");

    expect(mod.computeJobPnL).toBeDefined();
    expect(typeof mod.computeJobPnL).toBe("function");
  });

  describe("P&L computation", () => {
    it("computes gross profit correctly with no costs", async () => {
      const { computeJobPnL } = await import("@/lib/job-financials");

      const invoices = [{ amount: 100, invoice_type: "final" as const }];
      const costs: unknown[] = [];

      const result = computeJobPnL(invoices, costs, false);

      expect(result.invoicedNetPence).toBe(10000); // £100 in pence
      expect(result.costsNetPence).toBe(0);
      expect(result.grossProfitPence).toBe(10000);
      expect(result.marginPct).toBeCloseTo(100, 2);
    });

    it("computes gross profit correctly with costs", async () => {
      const { computeJobPnL } = await import("@/lib/job-financials");

      const invoices = [{ amount: 100, invoice_type: "final" as const }];
      const costs = [
        { amount_pence: 3000, vat_treatment: "standard" as const, paid: true },
        { amount_pence: 2000, vat_treatment: "zero" as const, paid: false },
      ];

      const result = computeJobPnL(invoices, costs, false);

      expect(result.invoicedNetPence).toBe(10000);
      expect(result.costsNetPence).toBe(5000); // £50
      expect(result.grossProfitPence).toBe(5000); // £50 profit
      expect(result.marginPct).toBeCloseTo(50, 2);
    });

    it("handles job with no invoice", async () => {
      const { computeJobPnL } = await import("@/lib/job-financials");

      const invoices: unknown[] = [];
      const costs = [{ amount_pence: 3000, vat_treatment: "zero" as const, paid: true }];

      const result = computeJobPnL(invoices, costs, false);

      expect(result.invoicedNetPence).toBe(0);
      expect(result.costsNetPence).toBe(3000);
      expect(result.grossProfitPence).toBe(-3000);
      expect(result.notYetInvoiced).toBe(true);
    });

    it("handles costs exceeding invoiced value (loss)", async () => {
      const { computeJobPnL } = await import("@/lib/job-financials");

      const invoices = [{ amount: 100, invoice_type: "final" as const }];
      const costs = [
        { amount_pence: 8000, vat_treatment: "standard" as const, paid: true },
        { amount_pence: 5000, vat_treatment: "zero" as const, paid: true },
      ];

      const result = computeJobPnL(invoices, costs, false);

      expect(result.invoicedNetPence).toBe(10000);
      expect(result.costsNetPence).toBe(13000);
      expect(result.grossProfitPence).toBe(-3000); // £30 loss
      expect(result.marginPct).toBeCloseTo(-30, 2);
    });

    it("handles negative costs (refunds)", async () => {
      const { computeJobPnL } = await import("@/lib/job-financials");

      const invoices = [{ amount: 100, invoice_type: "final" as const }];
      const costs = [
        { amount_pence: 5000, vat_treatment: "standard" as const, paid: true },
        { amount_pence: -2000, vat_treatment: "standard" as const, paid: true }, // refund
      ];

      const result = computeJobPnL(invoices, costs, false);

      expect(result.costsNetPence).toBe(3000); // £50 - £20 refund
      expect(result.grossProfitPence).toBe(7000); // £70 profit
    });

    it("tracks unpaid costs separately", async () => {
      const { computeJobPnL } = await import("@/lib/job-financials");

      const invoices = [{ amount: 100, invoice_type: "final" as const }];
      const costs = [
        { amount_pence: 3000, vat_treatment: "standard" as const, paid: true },
        { amount_pence: 2000, vat_treatment: "zero" as const, paid: false },
        { amount_pence: 1500, vat_treatment: "standard" as const, paid: false },
      ];

      const result = computeJobPnL(invoices, costs, false);

      expect(result.unpaidCostsPence).toBe(3500); // £35
    });

    it("computes VAT correctly for VAT-registered contractor", async () => {
      const { computeJobPnL } = await import("@/lib/job-financials");

      const invoices = [{ amount: 120, invoice_type: "final" as const }]; // £120 inc VAT = £100 net + £20 VAT
      const costs = [
        { amount_pence: 6000, vat_treatment: "standard" as const, paid: true }, // £60 inc VAT = £50 net + £10 VAT
        { amount_pence: 3000, vat_treatment: "zero" as const, paid: true }, // £30, no VAT
      ];

      const result = computeJobPnL(invoices, costs, true);

      // For VAT-registered: invoice amount is gross, need to extract VAT
      expect(result.vatCollectedPence).toBeGreaterThan(0);
      expect(result.vatOnCostsPence).toBeGreaterThan(0);
      expect(result.vatPositionPence).toBe(
        result.vatCollectedPence - result.vatOnCostsPence,
      );
    });

    it("excludes VAT for non-VAT-registered contractor", async () => {
      const { computeJobPnL } = await import("@/lib/job-financials");

      const invoices = [{ amount: 100, invoice_type: "final" as const }];
      const costs = [{ amount_pence: 5000, vat_treatment: "standard" as const, paid: true }];

      const result = computeJobPnL(invoices, costs, false);

      expect(result.vatCollectedPence).toBe(0);
      expect(result.vatOnCostsPence).toBe(0);
      expect(result.vatPositionPence).toBe(0);
    });
  });

  it("adds cost entry and P&L sections to job page", async () => {
    const jobPagePath = path.join(process.cwd(), "src/app/jobs/[id]/page.tsx");
    const content = await fs.readFile(jobPagePath, "utf-8");

    // Imports the cost components
    expect(content).toMatch(/import.*CostEntryForm.*cost-entry-form/);
    expect(content).toMatch(/import.*CostList.*cost-list/);
    expect(content).toMatch(/import.*PnLPanel.*pnl-panel/);

    // Renders the components
    expect(content).toMatch(/<CostEntryForm/);
    expect(content).toMatch(/<CostList/);
    expect(content).toMatch(/<PnLPanel/);
  });

  it("creates a confirm dialog component (not window.confirm)", async () => {
    const mod = await import("@/components/ui/confirm-dialog");

    expect(mod.ConfirmDialog).toBeDefined();

    // Check that it's a React component (has a displayName or is a function that returns JSX)
    const component = mod.ConfirmDialog;
    expect(typeof component).toBe("function");
  });

  it("renders costs using the Money component", async () => {
    const costListPath = path.join(process.cwd(), "src/app/jobs/[id]/cost-list.tsx");
    const content = await fs.readFile(costListPath, "utf-8");

    // Uses Money component for amounts
    expect(content).toMatch(/import.*Money.*@\/components\/ui\/money/);
    expect(content).toMatch(/<Money/);
  });

  it("renders P&L panel using the Money component", async () => {
    const pnlPanelPath = path.join(process.cwd(), "src/app/jobs/[id]/pnl-panel.tsx");
    const content = await fs.readFile(pnlPanelPath, "utf-8");

    // Uses Money component for all amounts
    expect(content).toMatch(/import.*Money.*@\/components\/ui\/money/);
    expect(content).toMatch(/<Money/);

    // Shows the VAT disclaimer
    expect(content).toMatch(/estimate.*not.*tax.*advice/i);
  });

  it("includes unit tests for P&L computation", async () => {
    const testPath = path.join(process.cwd(), "src/lib/job-financials.test.ts");
    const exists = await fs
      .access(testPath)
      .then(() => true)
      .catch(() => false);

    expect(exists).toBe(true);

    const content = await fs.readFile(testPath, "utf-8");

    // Tests the fixtures mentioned in the spec
    expect(content).toMatch(/no costs/i);
    expect(content).toMatch(/unpaid costs/i);
    expect(content).toMatch(/negative cost|refund/i);
    expect(content).toMatch(/no invoice/i);
    expect(content).toMatch(/costs exceeding|loss/i);
    expect(content).toMatch(/vat.*registered/i);
  });
});
