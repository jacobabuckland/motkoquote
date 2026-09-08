import { describe, it, expect } from "vitest";

describe("STAGE-2: Staged payment schedule on a job", () => {
  describe("Stage schedule creation", () => {
    it("creates a two-stage schedule splitting a £14,000 job under the ceiling", async () => {
      const { createPaymentStages } = await import("@/lib/payment-stages");

      const stages = createPaymentStages(1400000); // £14,000 in pence

      expect(stages).toHaveLength(2);
      expect(stages[0].stage_number).toBe(1);
      expect(stages[0].amount_pennies).toBeLessThanOrEqual(1000000); // deposit <= £10k
      expect(stages[1].stage_number).toBe(2);
      expect(stages[1].amount_pennies).toBeLessThanOrEqual(1000000); // balance <= £10k
      expect(stages[0].amount_pennies + stages[1].amount_pennies).toBe(1400000);
    });

    it("accepts exactly £20,000 split into two £10,000 stages", async () => {
      const { createPaymentStages } = await import("@/lib/payment-stages");

      const stages = createPaymentStages(2000000); // £20,000

      expect(stages).toHaveLength(2);
      expect(stages[0].amount_pennies).toBe(1000000);
      expect(stages[1].amount_pennies).toBe(1000000);
    });

    it("refuses a £20,001 job that cannot be split under the ceiling", async () => {
      const { createPaymentStages } = await import("@/lib/payment-stages");

      expect(() => createPaymentStages(2000100)).toThrow(/exceeds the maximum/i);
    });

    it("refuses a £25,000 job with a descriptive error", async () => {
      const { createPaymentStages } = await import("@/lib/payment-stages");

      expect(() => createPaymentStages(2500000)).toThrow(/exceeds the maximum that two stages can cover/i);
    });
  });

  describe("Job completion with stages", () => {
    it("marks a job paid only when all stages are settled", async () => {
      const { deriveJobClosed } = await import("@/lib/job-stages");

      const stagesPartial = [
        { stage_number: 1, amount_pennies: 700000, settled_at: "2026-09-01T10:00:00Z" },
        { stage_number: 2, amount_pennies: 700000, settled_at: null },
      ];

      expect(deriveJobClosed(stagesPartial)).toBe(false);
    });

    it("marks a job paid when both stages are settled", async () => {
      const { deriveJobClosed } = await import("@/lib/job-stages");

      const stagesComplete = [
        { stage_number: 1, amount_pennies: 700000, settled_at: "2026-09-01T10:00:00Z" },
        { stage_number: 2, amount_pennies: 700000, settled_at: "2026-09-05T14:30:00Z" },
      ];

      expect(deriveJobClosed(stagesComplete)).toBe(true);
    });

    it("marks a single-payment job (no stages) as paid when its invoice is paid", async () => {
      const { deriveJobClosed } = await import("@/lib/job-stages");

      // Empty stages array = no staging, ordinary single-payment job
      expect(deriveJobClosed([])).toBe(true);
    });

    it("keeps a job awaiting payment when neither stage is settled", async () => {
      const { deriveJobClosed } = await import("@/lib/job-stages");

      const stagesUnsettled = [
        { stage_number: 1, amount_pennies: 700000, settled_at: null },
        { stage_number: 2, amount_pennies: 700000, settled_at: null },
      ];

      expect(deriveJobClosed(stagesUnsettled)).toBe(false);
    });
  });

  describe("Stage status visibility", () => {
    it("displays each stage's settlement state without arithmetic", async () => {
      // This tests the derived data structure the UI will render, not the JSX
      const { deriveStageStatuses } = await import("@/lib/payment-stages");

      const stages = [
        {
          stage_number: 1,
          amount_pennies: 700000,
          settled_at: "2026-09-01T10:00:00Z",
          invoice_id: "inv-1"
        },
        {
          stage_number: 2,
          amount_pennies: 700000,
          settled_at: null,
          invoice_id: "inv-2"
        },
      ];

      const statuses = deriveStageStatuses(stages);

      expect(statuses).toHaveLength(2);
      expect(statuses[0]).toMatchObject({
        stage_number: 1,
        amount: "£7,000.00",
        status: "paid",
        label: "Paid ✓",
      });
      expect(statuses[1]).toMatchObject({
        stage_number: 2,
        amount: "£7,000.00",
        status: "awaiting_payment",
        label: "Awaiting payment",
      });
    });

    it("shows a stage as not yet invoiced when invoice_id is null", async () => {
      const { deriveStageStatuses } = await import("@/lib/payment-stages");

      const stages = [
        { stage_number: 1, amount_pennies: 700000, settled_at: null, invoice_id: null },
      ];

      const statuses = deriveStageStatuses(stages);

      expect(statuses[0]).toMatchObject({
        status: "not_invoiced",
        label: "Not yet invoiced",
      });
    });
  });

  describe("Stage-to-invoice linking", () => {
    it("populates invoice_id when an invoice is raised for a stage", async () => {
      const { linkInvoiceToStage } = await import("@/lib/payment-stages");

      // Simulating the action: contractor raises invoice for stage 1
      const updated = await linkInvoiceToStage({
        jobId: "job-123",
        stageNumber: 1,
        invoiceId: "inv-abc",
      });

      expect(updated.invoice_id).toBe("inv-abc");
      expect(updated.settled_at).toBeNull(); // not settled yet, just linked
    });

    it("stamps settled_at when the linked invoice is paid", async () => {
      const { settlePaymentStage } = await import("@/lib/payment-stages");

      // Simulating webhook: invoice inv-abc paid
      const settled = await settlePaymentStage({
        invoiceId: "inv-abc",
        paidAt: "2026-09-05T14:30:00Z",
      });

      expect(settled.settled_at).toBe("2026-09-05T14:30:00Z");
    });
  });

  describe("Validation at creation, not at payment", () => {
    it("refuses a split where deposit alone would exceed the ceiling", async () => {
      const { createPaymentStages } = await import("@/lib/payment-stages");

      // If someone tried to create a 90% deposit on a £14k job, that's £12.6k
      // This is the "split that would leave a stage above it is refused at creation" requirement
      // For now, the two-stage default is fixed, but the validation exists
      expect(() => {
        const stages = createPaymentStages(1400000);
        // Manually forcing a bad split to test the validation
        stages[0].amount_pennies = 1260000; // £12.6k - over ceiling
        stages[1].amount_pennies = 140000;  // £1.4k
        return stages;
      }).not.toThrow(); // the manual forcing doesn't throw, but...

      // The actual validation should prevent this. Let's test the validator directly:
      const { validateStageAmounts } = await import("@/lib/payment-stages");

      expect(() => validateStageAmounts([
        { stage_number: 1, amount_pennies: 1260000 },
        { stage_number: 2, amount_pennies: 140000 },
      ])).toThrow(/stage 1.*exceeds.*ceiling/i);
    });

    it("validates that balance stage is also under ceiling", async () => {
      const { validateStageAmounts } = await import("@/lib/payment-stages");

      expect(() => validateStageAmounts([
        { stage_number: 1, amount_pennies: 500000 },  // £5k - fine
        { stage_number: 2, amount_pennies: 1500000 }, // £15k - over ceiling
      ])).toThrow(/stage 2.*exceeds.*ceiling/i);
    });

    it("accepts a valid split with both stages under ceiling", async () => {
      const { validateStageAmounts } = await import("@/lib/payment-stages");

      expect(() => validateStageAmounts([
        { stage_number: 1, amount_pennies: 700000 },
        { stage_number: 2, amount_pennies: 700000 },
      ])).not.toThrow();
    });
  });

  describe("Integration with existing pipeline", () => {
    it("integrates with deriveSituation to keep job unpaid until all stages settle", async () => {
      const { deriveSituation } = await import("@/lib/job-stages");

      const quote = { status: "accepted", sent_at: "2026-09-01", viewed_at: "2026-09-01", accepted_at: "2026-09-02", declined_at: null };
      const contract = { id: "c1", status: "signed", sent_at: "2026-09-02", signed_at: "2026-09-03", deposit_pct: null };
      const invoices = [
        { id: "i1", status: "paid", invoice_type: "deposit", due_date: "2026-09-10", created_at: "2026-09-03", paid_at: "2026-09-04" },
        { id: "i2", status: "sent", invoice_type: "final", due_date: "2026-09-20", created_at: "2026-09-03", paid_at: null },
      ];
      const stages = [
        { stage_number: 1, settled_at: "2026-09-04T10:00:00Z" },
        { stage_number: 2, settled_at: null },
      ];

      // deriveSituation should now consult stages when present
      const { situation } = deriveSituation(quote, contract, invoices, Date.now(), null, stages);

      // Not "paid" because stage 2 isn't settled, even though invoice i1 is paid
      expect(situation).not.toBe("paid");
      expect(situation).toMatch(/invoice_unpaid|invoice_overdue/);
    });

    it("marks a fully-settled staged job as paid", async () => {
      const { deriveSituation } = await import("@/lib/job-stages");

      const quote = { status: "accepted", sent_at: "2026-09-01", viewed_at: "2026-09-01", accepted_at: "2026-09-02", declined_at: null };
      const contract = { id: "c1", status: "signed", sent_at: "2026-09-02", signed_at: "2026-09-03", deposit_pct: null };
      const invoices = [
        { id: "i1", status: "paid", invoice_type: "deposit", due_date: "2026-09-10", created_at: "2026-09-03", paid_at: "2026-09-04" },
        { id: "i2", status: "paid", invoice_type: "final", due_date: "2026-09-20", created_at: "2026-09-03", paid_at: "2026-09-05" },
      ];
      const stages = [
        { stage_number: 1, settled_at: "2026-09-04T10:00:00Z" },
        { stage_number: 2, settled_at: "2026-09-05T14:30:00Z" },
      ];

      const { situation } = deriveSituation(quote, contract, invoices, Date.now(), null, stages);

      expect(situation).toBe("paid");
    });
  });

  describe("Module and migration existence", () => {
    it("can import payment-stages module", async () => {
      const mod = await import("@/lib/payment-stages");

      expect(mod).toBeDefined();
      expect(mod.createPaymentStages).toBeInstanceOf(Function);
      expect(mod.getPaymentStages).toBeInstanceOf(Function);
      expect(mod.validateStageAmounts).toBeInstanceOf(Function);
      expect(mod.deriveStageStatuses).toBeInstanceOf(Function);
    });

    it("migration creates payment_stages table with expected columns", async () => {
      const fs = await import("node:fs");
      const path = await import("node:path");

      const migrationsDir = path.join(process.cwd(), "supabase/migrations");
      const files = fs.readdirSync(migrationsDir);
      const migrationFile = files.find((f) => f.includes("payment_stages"));

      expect(migrationFile, "Migration file for payment_stages should exist").toBeDefined();

      const content = fs.readFileSync(
        path.join(migrationsDir, migrationFile!),
        "utf-8"
      );

      expect(content).toMatch(/create table.*payment_stages/i);
      expect(content).toMatch(/job_id.*uuid/i);
      expect(content).toMatch(/stage_number.*int/i);
      expect(content).toMatch(/amount_pennies.*int/i);
      expect(content).toMatch(/invoice_id.*uuid/i);
      expect(content).toMatch(/settled_at.*timestamp/i);
    });
  });
});
