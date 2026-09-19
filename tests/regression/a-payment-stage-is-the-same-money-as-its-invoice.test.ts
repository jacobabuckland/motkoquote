// 19 SEP. `createInvoice` compared a figure in POUNDS against a ceiling in
// PENCE — `total > PAY_BY_BANK_LIMIT_PENNIES` — so the branch that splits a
// high-value job into payment stages fired at £1,000,000 instead of £10,000 and
// has never run on a real job. The same line then handed `createPaymentStages`,
// which takes pence, a figure in pounds: a £15,000 job would have written its
// two stages as 7,500 PENCE each into `amount_pennies`. £75 apiece.
//
// That insert is the only thing in the tree that creates a payment stage, so
// nothing in production has one — which is why turning the comparison round is
// not a one-line fix. Two things become reachable the moment it is:
//
//  1. Above £20,000 `createPaymentStages` throws a bare Error, and a bare Error
//     is replaced by React's redaction notice in a production build
//     (actionable-error.ts). A £25,000 invoice works today, by bank transfer.
//     It must not become a dead end with nothing readable on it.
//
//  2. A stage link is a claim that the invoice IS that stage's money, and
//     nothing downstream re-checks it: settle-paid-job.ts stamps settled_at on
//     whichever stage carries the invoice's id, and refund-settlement.ts
//     refunds against that stage's amount_pennies. But the invoice amount
//     follows the contract's deposit percentage and the stage split is 50/50
//     (frozen by tests/acceptance/623.test.ts), so on a 25% deposit they differ
//     by construction — and a £3,750 payment would settle and refund £7,500.
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mockSupabaseClient } from "../helpers/supabase";

type Stage = { id: string; stage_number: number; amount_pennies: number; invoice_id: string | null };

const contractor = {
  id: "contractor_1",
  company_name: "Aspire Plastering",
  payout_details_complete: true,
  // Present throughout: the over-ceiling guard refuses an invoice with nowhere
  // to pay it, and that refusal is a different test's subject.
  payout_account_holder_name: "A Plasterer",
  payout_sort_code: "04-00-04",
  payout_account_number: "12345678",
};

const quoteRow = (total: number, depositPct: number | null) => ({
  total,
  invoices: [],
  contracts: { deposit_pct: depositPct, status: "signed" },
  job: {
    id: "11111111-1111-4111-8111-111111111111",
    work_completed_at: "2026-09-18T09:00:00Z",
    customer: { name: "Megan Farrant", contact: { email: "x@example.com" } },
    contractor,
  },
});

/**
 * Per-table rows, because this flow reads `quotes` and then `payment_stages`
 * and the shared helper answers every table with the same set. Each table still
 * gets a real helper client — the chainable, awaitable builder — so nothing
 * here re-implements one.
 */
const clientFor = (tables: Record<string, unknown[]>) => {
  const mocks = Object.fromEntries(
    Object.entries(tables).map(([table, rows]) => [table, mockSupabaseClient(rows)]),
  );
  const client = {
    from: (table: string) => (mocks[table] ?? mockSupabaseClient([])).from(table),
  } as unknown as SupabaseClient;
  return { client, mocks };
};

const raiseInvoice = async (options: {
  total: number;
  depositPct?: number | null;
  invoiceType?: "deposit" | "final";
  existingStages?: Stage[];
  paymentStageId?: string;
}) => {
  const { client, mocks } = clientFor({
    quotes: [quoteRow(options.total, options.depositPct ?? null)],
    payment_stages: options.existingStages ?? [],
  });

  const createInvoiceRecord = vi.fn(async (_client?: unknown, _input?: { paymentStageId?: string }) => ({
    invoiceId: "invoice_1",
    delivered: true,
  }));

  vi.resetModules();
  vi.doMock("@/lib/supabase/server", () => ({ createClient: async () => client }));
  vi.doMock("@/lib/invoicing", () => ({ createInvoiceRecord }));
  vi.doMock("next/cache", () => ({ revalidatePath: () => {} }));

  const { createInvoice } = await import("@/app/dashboard/actions");

  const result = await createInvoice({
    quoteId: "22222222-2222-4222-8222-222222222222",
    invoiceType: options.invoiceType ?? "final",
    ...(options.paymentStageId ? { paymentStageId: options.paymentStageId } : {}),
  });

  return { result, createInvoiceRecord, mocks };
};

// What the insert wrote, if it wrote at all. Asserting the WRITE rather than
// the rows: the stub returns whatever it was handed, so the returned stages
// would look identical whether the code converted the units or not.
const stageInsert = (mocks: Record<string, ReturnType<typeof mockSupabaseClient>>) =>
  mocks.payment_stages
    .getWrites()
    .filter((write) => write.method === "insert")
    .flatMap((write) => write.payload as { stage_number: number; amount_pennies: number }[]);

describe("the ceiling is compared in one unit", () => {
  it("stages a £15,000 job, in pence", async () => {
    const { mocks } = await raiseInvoice({ total: 15_000 });

    expect(stageInsert(mocks)).toEqual([
      expect.objectContaining({ stage_number: 1, amount_pennies: 750_000 }),
      expect.objectContaining({ stage_number: 2, amount_pennies: 750_000 }),
    ]);
  });

  it("leaves a £9,000 job alone", async () => {
    const { mocks } = await raiseInvoice({ total: 9_000 });

    expect(stageInsert(mocks)).toEqual([]);
  });

  it("leaves a job at exactly £10,000 alone — the ceiling is `>`, not `>=`", async () => {
    // quote-send-guards.ts makes the same choice on the same constant, and a
    // quote at exactly £10,000 is payable online.
    const { mocks } = await raiseInvoice({ total: 10_000 });

    expect(stageInsert(mocks)).toEqual([]);
  });
});

describe("a job too big for two stages still raises its invoice", () => {
  it("does not reject where a bare Error would reach the contractor redacted", async () => {
    // `createPaymentStages` throws over £20,000. The contractor's bank details
    // are on file, so this invoice is payable by transfer exactly as it is
    // today — the absence of a schedule must leave it there, not end the send.
    const { createInvoiceRecord, mocks } = await raiseInvoice({ total: 25_000 });

    expect(createInvoiceRecord).toHaveBeenCalledTimes(1);
    expect(stageInsert(mocks)).toEqual([]);
  });
});

describe("an invoice is linked to a stage only when it is that stage's money", () => {
  // Real UUIDs: `paymentStageId` is parsed as one before anything else runs.
  const STAGE_1 = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
  const STAGE_2 = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";

  const stages = (amountPennies: number): Stage[] => [
    { id: STAGE_1, stage_number: 1, amount_pennies: amountPennies, invoice_id: null },
    { id: STAGE_2, stage_number: 2, amount_pennies: amountPennies, invoice_id: null },
  ];

  it("links when the figures agree to the penny", async () => {
    const { createInvoiceRecord } = await raiseInvoice({
      total: 15_000,
      depositPct: 50,
      invoiceType: "deposit",
      existingStages: stages(750_000),
    });

    expect(createInvoiceRecord.mock.calls[0]?.[1]?.paymentStageId).toBe(STAGE_1);
  });

  it("refuses the link when a 25% deposit meets a 50/50 split", async () => {
    // £3,750 against a £7,500 stage. Linked, this invoice settles £7,500 when
    // it is paid and refunds £7,500 if it is refunded.
    const { createInvoiceRecord } = await raiseInvoice({
      total: 15_000,
      depositPct: 25,
      invoiceType: "deposit",
      existingStages: stages(750_000),
    });

    expect(createInvoiceRecord.mock.calls[0]?.[1]?.paymentStageId).toBeUndefined();
  });

  it("refuses a stage id the client supplied that is not this invoice's money", async () => {
    // The id arrives from a form and decides which row gets settled and
    // refunded, so it is looked up in the job's own stages and checked like any
    // other candidate.
    const { createInvoiceRecord } = await raiseInvoice({
      total: 15_000,
      depositPct: 25,
      invoiceType: "deposit",
      existingStages: stages(750_000),
      paymentStageId: STAGE_2,
    });

    expect(createInvoiceRecord.mock.calls[0]?.[1]?.paymentStageId).toBeUndefined();
  });
});
