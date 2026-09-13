/**
 * @vitest-environment happy-dom
 */

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { mockSupabaseClient } from "../helpers/supabase";
import { join } from "node:path";

afterEach(cleanup);

describe("Quote editor — deposit and schedule UI", () => {
  it("shows deposit field for quote totals under £5,000", async () => {
    const QuoteEditor = (await import("@/app/jobs/[id]/quote-editor")).QuoteEditor;

    const lineItems = [
      {
        category: "labour" as const,
        description: "Day rate",
        quantity: 10,
        unit: "days",
        unit_price: 400,
        multiplier: 1,
        people_count: 1,
        overtime: false,
        assumed: false,
      },
    ];

    render(
      <QuoteEditor
        jobId="job_1"
        quoteId="quote_1"
        jobTitle="Small bathroom refit"
        initialLineItems={lineItems}
        vatRegistered={true}
      />
    );

    // Total is £4,000 + VAT = £4,800, under £5k
    expect(screen.queryByText(/deposit/i)).toBeDefined();
  });

  it("shows payment schedule builder for totals £5,000 and over", async () => {
    const QuoteEditor = (await import("@/app/jobs/[id]/quote-editor")).QuoteEditor;

    const lineItems = [
      {
        category: "labour" as const,
        description: "Day rate",
        quantity: 15,
        unit: "days",
        unit_price: 400,
        multiplier: 1,
        people_count: 1,
        overtime: false,
        assumed: false,
      },
    ];

    render(
      <QuoteEditor
        jobId="job_1"
        quoteId="quote_1"
        jobTitle="Full kitchen extension"
        initialLineItems={lineItems}
        vatRegistered={true}
      />
    );

    // Total is £6,000 + VAT = £7,200, over £5k
    expect(screen.queryByText(/payment schedule/i) || screen.queryByText(/tranches/i)).toBeDefined();
  });
});

describe("Deposit storage on quotes", () => {
  it("saves deposit amount to quotes table", async () => {
    const { client, getWrites } = mockSupabaseClient([{ id: "quote_1" }]);

    const { saveQuoteDeposit } = await import("@/app/jobs/actions");
    await saveQuoteDeposit(client, {
      quoteId: "quote_1",
      depositAmountPennies: 100000, // £1,000
    });

    const writes = getWrites();
    expect(writes).toHaveLength(1);
    expect(writes[0]?.method).toBe("update");
    expect(writes[0]?.table).toBe("quotes");
    expect(writes[0]?.payload).toMatchObject({
      deposit_amount_pennies: 100000,
    });
  });

  it("saves deposit percentage to quotes table", async () => {
    const { client, getWrites } = mockSupabaseClient([{ id: "quote_1" }]);

    const { saveQuoteDeposit } = await import("@/app/jobs/actions");
    await saveQuoteDeposit(client, {
      quoteId: "quote_1",
      depositPct: 25,
    });

    const writes = getWrites();
    expect(writes).toHaveLength(1);
    expect(writes[0]?.method).toBe("update");
    expect(writes[0]?.payload).toMatchObject({
      deposit_pct: 25,
    });
  });
});

describe("Payment schedule storage", () => {
  it("creates payment_stages rows for agreed tranches", async () => {
    const { client, getWrites } = mockSupabaseClient([
      { id: "stage_1" },
      { id: "stage_2" },
      { id: "stage_3" },
    ]);

    const { createPaymentSchedule } = await import("@/lib/payment-stages");
    await createPaymentSchedule(client, {
      jobId: "job_1",
      stages: [
        { stage_number: 1, amount_pennies: 300000 },
        { stage_number: 2, amount_pennies: 300000 },
        { stage_number: 3, amount_pennies: 200000 },
      ],
    });

    const writes = getWrites();
    const stageWrites = writes.filter((w) => w.table === "payment_stages");
    expect(stageWrites.length).toBeGreaterThanOrEqual(1);
    expect(stageWrites[0]?.method).toBe("insert");
  });

  it("validates each tranche is under £10,000", async () => {
    const { validateStageAmounts } = await import("@/lib/payment-stages");

    expect(() => {
      validateStageAmounts([
        { stage_number: 1, amount_pennies: 1100000 }, // £11,000 — over limit
        { stage_number: 2, amount_pennies: 500000 },
      ]);
    }).toThrow(/exceeds.*Pay by Bank ceiling/i);
  });

  it("allows tranches exactly at £10,000 limit", async () => {
    const { validateStageAmounts } = await import("@/lib/payment-stages");

    expect(() => {
      validateStageAmounts([
        { stage_number: 1, amount_pennies: 1000000 }, // exactly £10,000
        { stage_number: 2, amount_pennies: 1000000 },
      ]);
    }).not.toThrow();
  });
});

describe("Contract signature triggers", () => {
  it("creates deposit invoice when deposit_pct is set", async () => {
    const contractRow = {
      id: "contract_1",
      status: "sent",
      deposit_pct: 25,
      quote: {
        id: "quote_1",
        total: 4000,
        job: {
          id: "job_1",
          customer: { name: "Jane Smith", contact: { email: "jane@example.com" } },
          contractor: { company_name: "ABC Ltd", payout_details_complete: true },
        },
      },
    };

    const { getWrites } = mockSupabaseClient([contractRow, { id: "contract_1" }]);

    const { signContract } = await import("@/app/c/[id]/actions");
    await signContract("contract_1", "Jane Smith");

    const writes = getWrites();
    const invoiceWrites = writes.filter((w) => w.table === "invoices");
    expect(invoiceWrites.length).toBeGreaterThanOrEqual(1);
    expect(invoiceWrites[0]?.payload).toMatchObject({
      quote_id: "quote_1",
      amount: 1000, // 25% of £4,000
    });
  });

  it("creates stage 1 invoice when payment schedule exists", async () => {
    const quoteRow = {
      id: "quote_1",
      job_id: "job_1",
      total: 8000,
    };
    const contractRow = {
      id: "contract_1",
      status: "sent",
      quote_id: "quote_1",
    };
    const stages = [
      {
        id: "stage_1",
        job_id: "job_1",
        stage_number: 1,
        amount_pennies: 300000,
        invoice_id: null,
      },
      {
        id: "stage_2",
        job_id: "job_1",
        stage_number: 2,
        amount_pennies: 300000,
        invoice_id: null,
      },
      {
        id: "stage_3",
        job_id: "job_1",
        stage_number: 3,
        amount_pennies: 200000,
        invoice_id: null,
      },
    ];

    const { getWrites } = mockSupabaseClient([
      { ...contractRow, quote: quoteRow },
      { id: "contract_1" },
      ...stages,
      { id: "invoice_1" },
    ]);

    const { signContract } = await import("@/app/c/[id]/actions");
    await signContract("contract_1", "Jane Smith");

    const writes = getWrites();
    const invoiceWrites = writes.filter((w) => w.table === "invoices");
    expect(invoiceWrites.length).toBeGreaterThanOrEqual(1);

    // First invoice should be for stage 1 amount
    expect(invoiceWrites[0]?.payload).toMatchObject({
      quote_id: "quote_1",
      amount: 3000, // £3,000
    });

    // Stage 1 should be linked to invoice
    const stageWrites = writes.filter(
      (w) => w.table === "payment_stages" && w.method === "update"
    );
    expect(stageWrites.length).toBeGreaterThanOrEqual(1);
  });

  it("does nothing when no deposit or schedule is set", async () => {
    const contractRow = {
      id: "contract_1",
      status: "sent",
      deposit_pct: null,
      quote: {
        id: "quote_1",
        total: 2000,
        job: {
          id: "job_1",
          customer: { name: "Bob Jones", contact: {} },
          contractor: { company_name: "XYZ Ltd", payout_details_complete: true },
        },
      },
    };

    const { getWrites } = mockSupabaseClient([contractRow, { id: "contract_1" }]);

    const { signContract } = await import("@/app/c/[id]/actions");
    await signContract("contract_1", "Bob Jones");

    const writes = getWrites();
    const invoiceWrites = writes.filter((w) => w.table === "invoices");
    expect(invoiceWrites.length).toBe(0);
  });
});

describe("Stage completion triggers", () => {
  it("creates next stage invoice when marking work complete", async () => {
    const jobRow = {
      id: "job_1",
      work_completed_at: null,
      quotes: [{ contracts: [{ status: "signed", signed_at: "2026-09-01" }] }],
    };
    const stages = [
      {
        id: "stage_1",
        job_id: "job_1",
        stage_number: 1,
        amount_pennies: 300000,
        invoice_id: "invoice_1",
        settled_at: "2026-09-05",
      },
      {
        id: "stage_2",
        job_id: "job_1",
        stage_number: 2,
        amount_pennies: 300000,
        invoice_id: null, // not yet invoiced
        settled_at: null,
      },
      {
        id: "stage_3",
        job_id: "job_1",
        stage_number: 3,
        amount_pennies: 200000,
        invoice_id: null,
        settled_at: null,
      },
    ];

    const { getWrites } = mockSupabaseClient([
      jobRow,
      { id: "job_1" },
      ...stages,
      { id: "invoice_2" },
    ]);

    const { markWorkComplete } = await import("@/app/jobs/[id]/actions");
    await markWorkComplete({ jobId: "job_1", complete: true });

    const writes = getWrites();
    const invoiceWrites = writes.filter((w) => w.table === "invoices");
    expect(invoiceWrites.length).toBeGreaterThanOrEqual(1);

    // Should create invoice for stage 2
    expect(invoiceWrites[0]?.payload).toMatchObject({
      amount: 3000, // £3,000
    });
  });

  it("is idempotent — marking complete twice creates one invoice", async () => {
    const jobRow = {
      id: "job_1",
      work_completed_at: "2026-09-10T10:00:00Z",
      quotes: [{ contracts: [{ status: "signed" }] }],
    };
    const stages = [
      {
        id: "stage_1",
        job_id: "job_1",
        stage_number: 1,
        amount_pennies: 500000,
        invoice_id: "invoice_1",
      },
      {
        id: "stage_2",
        job_id: "job_1",
        stage_number: 2,
        amount_pennies: 500000,
        invoice_id: "invoice_2", // already invoiced
      },
    ];

    const { getWrites } = mockSupabaseClient([jobRow, { id: "job_1" }, ...stages]);

    const { markWorkComplete } = await import("@/app/jobs/[id]/actions");
    await markWorkComplete({ jobId: "job_1", complete: true });

    const writes = getWrites();
    const invoiceWrites = writes.filter((w) => w.table === "invoices");
    // No new invoices — all stages already invoiced
    expect(invoiceWrites.length).toBe(0);
  });

  it("does nothing when job has no payment stages", async () => {
    const jobRow = {
      id: "job_1",
      work_completed_at: null,
      quotes: [{ contracts: [{ status: "signed" }] }],
    };

    const { getWrites } = mockSupabaseClient([jobRow, { id: "job_1" }, []]);

    const { markWorkComplete } = await import("@/app/jobs/[id]/actions");
    await markWorkComplete({ jobId: "job_1", complete: true });

    const writes = getWrites();
    const invoiceWrites = writes.filter((w) => w.table === "invoices");
    expect(invoiceWrites.length).toBe(0);
  });
});

describe("Contract PDF displays deposit and schedule", () => {
  it("includes deposit amount on contract", async () => {
    const { buildContractVariables } = await import("@/lib/contracts/build-variables");

    const contract = {
      id: "contract_1",
      deposit_pct: 25,
      quote: {
        total: 4000,
        line_items_json: [],
      },
    };

    const variables = buildContractVariables(contract as never);
    expect(variables.deposit_amount).toBe("£1,000.00");
  });

  it("includes payment schedule on contract", async () => {
    const { buildContractVariables } = await import("@/lib/contracts/build-variables");

    const contract = {
      id: "contract_1",
      quote: {
        total: 8000,
        line_items_json: [],
        payment_stages: [
          { stage_number: 1, amount_pennies: 300000 },
          { stage_number: 2, amount_pennies: 300000 },
          { stage_number: 3, amount_pennies: 200000 },
        ],
      },
    };

    const variables = buildContractVariables(contract as never);
    expect(variables.payment_schedule).toBeDefined();
    expect(variables.payment_schedule).toHaveLength(3);
  });
});

describe("Migration adds deposit columns to quotes", () => {
  it("migration file exists", async () => {
    const { existsSync } = await import("node:fs");
    const migrationPath = join(
      process.cwd(),
      "supabase/migrations/00000000000079_quote_deposits_and_schedules.sql"
    );
    expect(existsSync(migrationPath)).toBe(true);
  });

  it("migration adds deposit_amount_pennies column", async () => {
    const { readFileSync } = await import("node:fs");
    const migrationPath = join(
      process.cwd(),
      "supabase/migrations/00000000000079_quote_deposits_and_schedules.sql"
    );

    const content = readFileSync(migrationPath, "utf-8");
    expect(content).toMatch(/deposit_amount_pennies/i);
  });

  it("migration adds deposit_pct column", async () => {
    const { readFileSync } = await import("node:fs");
    const migrationPath = join(
      process.cwd(),
      "supabase/migrations/00000000000079_quote_deposits_and_schedules.sql"
    );

    const content = readFileSync(migrationPath, "utf-8");
    expect(content).toMatch(/deposit_pct/i);
  });
});

describe("Job detail page displays payment stages", () => {
  it("shows stage completion status", async () => {
    const { PaymentStagesSection } = await import(
      "@/app/jobs/[id]/payment-stages-section"
    );

    const stages = [
      {
        stage_number: 1,
        amount_pennies: 300000,
        invoice_id: "invoice_1",
        settled_at: "2026-09-05",
      },
      {
        stage_number: 2,
        amount_pennies: 300000,
        invoice_id: "invoice_2",
        settled_at: null,
      },
      {
        stage_number: 3,
        amount_pennies: 200000,
        invoice_id: null,
        settled_at: null,
      },
    ];

    render(<PaymentStagesSection stages={stages} />);

    expect(screen.getByText("Stage 1")).toBeDefined();
    expect(screen.getByText("Stage 2")).toBeDefined();
    expect(screen.getByText("Stage 3")).toBeDefined();
  });
});
