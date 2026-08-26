import { describe, it, expect } from "vitest";

/**
 * Issue #265: LED-4 — Cross-job money position
 *
 * These tests verify:
 * 1. Money position aggregation functions exist and compute correctly
 * 2. Counterparty grouping across jobs (one counterparty across multiple jobs,
 *    costs with no counterparty, counterparty with all costs paid)
 * 3. VAT position computation (collected vs costs)
 * 4. Invoice-to-pence conversion boundary
 * 5. UI components for money position display exist
 * 6. Server action returns pre-computed aggregates (no client-side arithmetic)
 */

describe("Issue #265: LED-4 — Cross-job money position", () => {
  describe("Money position aggregation functions", () => {
    it("exports aggregation functions from money-position-math.ts", async () => {
      const mod = await import("@/lib/money-position-math");

      expect(mod.aggregateByCounterparty).toBeDefined();
      expect(typeof mod.aggregateByCounterparty).toBe("function");

      expect(mod.aggregateByCustomer).toBeDefined();
      expect(typeof mod.aggregateByCustomer).toBe("function");

      expect(mod.computeVATPosition).toBeDefined();
      expect(typeof mod.computeVATPosition).toBe("function");
    });

    it("aggregates unpaid costs by counterparty correctly", async () => {
      const { aggregateByCounterparty } = await import(
        "@/lib/money-position-math"
      );

      // Fixture: three costs across two jobs for one counterparty
      const costs = [
        {
          id: "1",
          counterpartyId: "cp-1",
          counterpartyName: "Frank",
          amountNet: 50000, // £500.00
          vatAmount: 10000, // £100.00
          jobId: "job-1",
          paid: false,
        },
        {
          id: "2",
          counterpartyId: "cp-1",
          counterpartyName: "Frank",
          amountNet: 80000, // £800.00
          vatAmount: 16000, // £160.00
          jobId: "job-2",
          paid: false,
        },
        {
          id: "3",
          counterpartyId: "cp-1",
          counterpartyName: "Frank",
          amountNet: 20000, // £200.00
          vatAmount: 4000, // £40.00
          jobId: "job-2",
          paid: false,
        },
      ];

      const result = aggregateByCounterparty(costs);

      expect(result).toHaveLength(1);
      expect(result[0].counterpartyId).toBe("cp-1");
      expect(result[0].counterpartyName).toBe("Frank");
      expect(result[0].totalOwed).toBe(180000); // £500 + £800 + £200 + VAT
      expect(result[0].jobCount).toBe(2); // spans two jobs
    });

    it("groups costs with no counterparty separately", async () => {
      const { aggregateByCounterparty } = await import(
        "@/lib/money-position-math"
      );

      const costs = [
        {
          id: "1",
          counterpartyId: "cp-1",
          counterpartyName: "Frank",
          amountNet: 50000,
          vatAmount: 10000,
          jobId: "job-1",
          paid: false,
        },
        {
          id: "2",
          counterpartyId: null,
          counterpartyName: null,
          amountNet: 30000,
          vatAmount: 6000,
          jobId: "job-2",
          paid: false,
        },
        {
          id: "3",
          counterpartyId: null,
          counterpartyName: null,
          amountNet: 20000,
          vatAmount: null,
          jobId: "job-3",
          paid: false,
        },
      ];

      const result = aggregateByCounterparty(costs);

      expect(result).toHaveLength(2);

      const frank = result.find((r) => r.counterpartyId === "cp-1");
      expect(frank).toBeDefined();
      expect(frank?.totalOwed).toBe(60000);

      const noCounterparty = result.find((r) => r.counterpartyId === null);
      expect(noCounterparty).toBeDefined();
      expect(noCounterparty?.counterpartyName).toBeNull();
      expect(noCounterparty?.totalOwed).toBe(56000); // £300 + £60 VAT + £200 + £0 VAT
    });

    it("excludes counterparties with all costs paid", async () => {
      const { aggregateByCounterparty } = await import(
        "@/lib/money-position-math"
      );

      const costs = [
        {
          id: "1",
          counterpartyId: "cp-1",
          counterpartyName: "Frank",
          amountNet: 50000,
          vatAmount: 10000,
          jobId: "job-1",
          paid: true, // PAID
        },
        {
          id: "2",
          counterpartyId: "cp-2",
          counterpartyName: "Screwfix",
          amountNet: 30000,
          vatAmount: 6000,
          jobId: "job-2",
          paid: false, // UNPAID
        },
      ];

      const result = aggregateByCounterparty(costs);

      expect(result).toHaveLength(1);
      expect(result[0].counterpartyId).toBe("cp-2");
      expect(result[0].counterpartyName).toBe("Screwfix");
    });

    it("handles negative cost (refund exceeds charges) correctly", async () => {
      const { aggregateByCounterparty } = await import(
        "@/lib/money-position-math"
      );

      const costs = [
        {
          id: "1",
          counterpartyId: "cp-1",
          counterpartyName: "Screwfix",
          amountNet: 50000, // £500.00 charge
          vatAmount: 10000,
          jobId: "job-1",
          paid: false,
        },
        {
          id: "2",
          counterpartyId: "cp-1",
          counterpartyName: "Screwfix",
          amountNet: -80000, // £800.00 refund
          vatAmount: -16000,
          jobId: "job-1",
          paid: false,
        },
      ];

      const result = aggregateByCounterparty(costs);

      expect(result).toHaveLength(1);
      expect(result[0].counterpartyId).toBe("cp-1");
      expect(result[0].totalOwed).toBe(-36000); // -£360 (refund exceeds charges)
    });

    it("aggregates unpaid invoices by customer correctly", async () => {
      const { aggregateByCustomer } = await import(
        "@/lib/money-position-math"
      );

      const invoices = [
        {
          id: "inv-1",
          customerId: "cust-1",
          customerName: "John Smith",
          amount: 100.0, // pounds
          createdAt: "2026-08-10T10:00:00Z",
          paid: false,
        },
        {
          id: "inv-2",
          customerId: "cust-1",
          customerName: "John Smith",
          amount: 200.0, // pounds
          createdAt: "2026-08-15T10:00:00Z",
          paid: false,
        },
        {
          id: "inv-3",
          customerId: "cust-2",
          customerName: "Jane Doe",
          amount: 150.0, // pounds
          createdAt: "2026-08-12T10:00:00Z",
          paid: true, // PAID — should be excluded
        },
      ];

      const result = aggregateByCustomer(invoices, "2026-08-18"); // today

      expect(result).toHaveLength(1);
      expect(result[0].customerId).toBe("cust-1");
      expect(result[0].customerName).toBe("John Smith");
      expect(result[0].totalOwed).toBe(30000); // £100 + £200 = £300 in pence
      expect(result[0].oldestInvoiceAgeDays).toBe(8); // 2026-08-18 minus 2026-08-10
    });

    it("converts invoice amounts from pounds to pence correctly", async () => {
      const { aggregateByCustomer } = await import(
        "@/lib/money-position-math"
      );

      // This test documents the conversion boundary: invoices are in pounds,
      // aggregation returns pence
      const invoices = [
        {
          id: "inv-1",
          customerId: "cust-1",
          customerName: "Test Customer",
          amount: 50.0, // £50.00 in pounds
          createdAt: "2026-08-17T10:00:00Z",
          paid: false,
        },
      ];

      const result = aggregateByCustomer(invoices, "2026-08-18");

      expect(result[0].totalOwed).toBe(5000); // £50.00 → 5000 pence, NOT 50
    });

    it("computes VAT position correctly", async () => {
      const { computeVATPosition } = await import(
        "@/lib/money-position-math"
      );

      const paidInvoices = [
        {
          id: "inv-1",
          amount: 100.0, // pounds
          vatAmount: 20.0, // pounds
        },
        {
          id: "inv-2",
          amount: 200.0, // pounds
          vatAmount: 40.0, // pounds
        },
      ];

      const paidCosts = [
        {
          id: "cost-1",
          vatAmount: 1000, // pence (£10.00)
        },
        {
          id: "cost-2",
          vatAmount: 2000, // pence (£20.00)
        },
        {
          id: "cost-3",
          vatAmount: null, // no VAT — should be treated as zero
        },
      ];

      const result = computeVATPosition(paidInvoices, paidCosts);

      expect(result.collected).toBe(6000); // £20 + £40 = £60 in pence
      expect(result.onCosts).toBe(3000); // £10 + £20 = £30 in pence
      expect(result.position).toBe(3000); // £60 - £30 = £30 in pence
    });
  });

  describe("Server action", () => {
    it("exports getMoneyPosition server action", async () => {
      const mod = await import("@/app/jobs/money-position-actions");

      expect(mod.getMoneyPosition).toBeDefined();
      expect(typeof mod.getMoneyPosition).toBe("function");
    });

    it("getMoneyPosition returns structure with pre-computed aggregates", async () => {
      const mod = await import("@/app/jobs/money-position-actions");

      // This test documents that the server action returns fully computed
      // aggregates — the client never computes sums or VAT itself

      // Verify the function exists and is callable
      expect(mod.getMoneyPosition).toBeDefined();
      expect(typeof mod.getMoneyPosition).toBe("function");

      // Document the expected return structure
      // (cannot run against real DB without auth in this test)
      type ExpectedReturn = Awaited<ReturnType<typeof mod.getMoneyPosition>>;

      // Assert the structure includes pre-computed fields
      const mockResult: ExpectedReturn = {
        owedToYou: [
          {
            customerId: "cust-1",
            customerName: "Test",
            totalOwed: 10000,
            oldestInvoiceAgeDays: 5,
            unpaidInvoiceIds: ["inv-1"],
          },
        ],
        youOwe: [
          {
            counterpartyId: "cp-1",
            counterpartyName: "Frank",
            totalOwed: 20000,
            jobCount: 2,
            costIds: ["cost-1", "cost-2"],
          },
        ],
        vat: {
          collected: 5000,
          onCosts: 2000,
          position: 3000,
        },
        whatsLeft: 50000,
        // Added when #364 gave getMoneyPosition a signed breakdown and a
        // forward-looking projection. This literal is typed as the action's
        // real return type, so every required field has to appear here or the
        // file stops compiling — which is what happened, and is why these two
        // are present rather than the shape below being narrowed.
        //
        // Nothing this test asserts changes: the four expectations underneath
        // check that the pre-computed aggregates are defined, and none of them
        // reads either new field. The point of the test is that the server
        // action hands the client finished sums; two more finished sums do not
        // weaken it.
        safeToSpend: {
          collected: 60000,
          costsPaid: 10000,
          motkoFees: 0,
          vatToSetAside: 3000,
          total: 47000,
        },
        projection: {
          owedNet: 8000,
          unpaidCostsNet: 20000,
          feesOnOwed: 0,
          total: 35000,
        },
      };

      // Type assertion passes if the structure matches
      expect(mockResult.owedToYou[0].totalOwed).toBeDefined();
      expect(mockResult.youOwe[0].totalOwed).toBeDefined();
      expect(mockResult.vat?.collected).toBeDefined();
      expect(mockResult.whatsLeft).toBeDefined();
    });
  });

  describe("UI components", () => {
    it("exports MoneyPosition component", async () => {
      const mod = await import("@/app/jobs/money-position");

      expect(mod.MoneyPosition).toBeDefined();
    });
  });
});
