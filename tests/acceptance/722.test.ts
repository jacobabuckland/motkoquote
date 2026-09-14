/**
 * Deposits and staged payments: ask, agree, then trigger on signature.
 *
 * Written by hand on 14 Sep after five PM derivations died on five different
 * causes. Each was derived against a description of the codebase rather than
 * the codebase, so each contract named something that does not exist:
 * `markWorkComplete` as new (it is at src/app/jobs/actions.ts:1931),
 * `createInvoiceRecord` in src/lib/invoice.ts (it is src/lib/invoicing.ts:38),
 * and an `invoices.payment_stage_id` column no migration creates.
 *
 * WHAT WAS ALREADY BUILT, and is therefore not asserted here as if it were
 * new: payment_stages rows are created and linked by the dashboard invoice
 * path, createInvoiceRecord already writes payment_stages.invoice_id, and
 * signContract already raises a deposit invoice behind a race guard. The work
 * is the SOURCE that trigger reads, and the ask that fills it.
 *
 * Deliberately NOT routed through getPaymentStages / linkInvoiceToStage /
 * settlePaymentStage in src/lib/payment-stages.ts. Those three take no
 * Supabase client, touch no database and return hardcoded objects built from
 * their own arguments; nothing in src/ calls them, and their only callers are
 * two frozen assertions in tests/acceptance/623.test.ts that check each
 * returns the value it was handed. Retiring them needs a line on the card.
 */
import { describe, expect, it, vi } from "vitest";
import { parseDeposit, depositAtSignature, depositLine } from "@/lib/quote-deposit";
import { PAY_BY_BANK_LIMIT_PENNIES } from "@/app/i/[id]/pay-panel";

/** Rhys's job, the one in the reports: £740.00. */
const RHYS_TOTAL = 74000;

describe("the ask — what the trade types becomes pennies", () => {
  it("reads a percentage", () => {
    expect(parseDeposit("25%", RHYS_TOTAL)).toEqual({ ok: true, pennies: 18500 });
    expect(parseDeposit("50%", RHYS_TOTAL)).toEqual({ ok: true, pennies: 37000 });
  });

  it("reads an amount, with or without the pound sign or separators", () => {
    expect(parseDeposit("£500", RHYS_TOTAL)).toEqual({ ok: true, pennies: 50000 });
    expect(parseDeposit("500", RHYS_TOTAL)).toEqual({ ok: true, pennies: 50000 });
    expect(parseDeposit("500.00", RHYS_TOTAL)).toEqual({ ok: true, pennies: 50000 });
    expect(parseDeposit("£1,250.50", 500000)).toEqual({ ok: true, pennies: 125050 });
  });

  it("rounds a percentage to the penny once, here", () => {
    // A third of £740 is £246.666… If this returned a float the invoice would
    // round it again, and the deposit and the balance would not sum to the
    // quote — the drift #739's balance fix exists to prevent.
    const parsed = parseDeposit("33.33%", RHYS_TOTAL);
    expect(parsed).toEqual({ ok: true, pennies: 24664 });
    expect(Number.isInteger((parsed as { pennies: number }).pennies)).toBe(true);
  });

  it("says NOTHING rather than zero for an empty field", () => {
    // Null is "no deposit on this quote". Zero is "we agreed none". They are
    // different answers and only one of them is silence.
    expect(parseDeposit("", RHYS_TOTAL)).toEqual({ ok: true, pennies: null });
    expect(parseDeposit("   ", RHYS_TOTAL)).toEqual({ ok: true, pennies: null });
    expect(parseDeposit(null, RHYS_TOTAL)).toEqual({ ok: true, pennies: null });
    expect(parseDeposit(undefined, RHYS_TOTAL)).toEqual({ ok: true, pennies: null });
  });

  it("records a deliberate zero", () => {
    expect(parseDeposit("0", RHYS_TOTAL)).toEqual({ ok: true, pennies: 0 });
    expect(parseDeposit("0%", RHYS_TOTAL)).toEqual({ ok: true, pennies: 0 });
  });

  it("refuses a deposit larger than the quote", () => {
    const tooBig = parseDeposit("£800", RHYS_TOTAL);
    expect(tooBig.ok).toBe(false);
    expect((tooBig as { error: string }).error).toMatch(/more than the quote total/);
    expect((parseDeposit("101%", RHYS_TOTAL) as { error: string }).error).toMatch(/100%/);
  });

  it("refuses a deposit over the Pay by Bank ceiling", () => {
    // Not a nicety: a single payment over the ceiling cannot be taken on the
    // rail, so the customer would be sent a demand they cannot pay.
    const overCeiling = parseDeposit(`${PAY_BY_BANK_LIMIT_PENNIES / 100 + 1}`, 5_000_000);
    expect(overCeiling.ok).toBe(false);
    expect((overCeiling as { error: string }).error).toMatch(/Split the job into stages/);
  });

  it("RETURNS an error rather than throwing, because a person is typing", () => {
    // "2" on the way to "25%" must not explode.
    expect(() => parseDeposit("2", RHYS_TOTAL)).not.toThrow();
    expect(() => parseDeposit("abc", RHYS_TOTAL)).not.toThrow();
    expect(() => parseDeposit("%", RHYS_TOTAL)).not.toThrow();
    expect((parseDeposit("abc", RHYS_TOTAL) as { error: string }).error).toMatch(/like £500/);
  });
});

describe("the trigger — which source a signature reads", () => {
  it("prefers what the customer agreed to on the quote", () => {
    const due = depositAtSignature(
      { total: 740, deposit_pennies: 18500 },
      { deposit_pct: 25 },
    );
    expect(due).toEqual({ amount: 185, source: "quote" });
  });

  it("falls back to the contract percentage for the rows that predate the column", () => {
    // The seven live contracts. They keep working exactly as they do now.
    const due = depositAtSignature({ total: 7200, deposit_pennies: null }, { deposit_pct: 1 });
    expect(due).toEqual({ amount: 72, source: "contract" });
  });

  it("raises NOTHING on a deposit deliberately agreed at zero", () => {
    // This is the whole reason zero is storable. The trade was asked and said
    // no deposit, so a percentage typed on the contract to clear a field must
    // not override that.
    expect(depositAtSignature({ total: 740, deposit_pennies: 0 }, { deposit_pct: 25 })).toBeNull();
  });

  it("raises nothing when neither source says anything", () => {
    expect(depositAtSignature({ total: 740, deposit_pennies: null }, { deposit_pct: null })).toBeNull();
    expect(depositAtSignature({ total: 740 }, {})).toBeNull();
    expect(depositAtSignature({ total: 740, deposit_pennies: null }, { deposit_pct: 0 })).toBeNull();
  });

  it("returns POUNDS, which is what invoices.amount is in", () => {
    // The pennies live in the column and stop at this boundary. Handing
    // createInvoiceRecord 18500 would raise an £18,500 invoice on a £740 job.
    const due = depositAtSignature({ total: 740, deposit_pennies: 18500 }, {});
    expect(due?.amount).toBe(185);
    expect(due?.amount).toBeLessThan(740);
  });

  it("agrees with what the customer was shown, to the penny", () => {
    // Parse it, store it, read it back at signature: one number the whole way.
    const parsed = parseDeposit("25%", RHYS_TOTAL);
    const stored = (parsed as { pennies: number }).pennies;
    const due = depositAtSignature({ total: RHYS_TOTAL / 100, deposit_pennies: stored }, {});
    expect(due?.amount).toBe(185);
    expect(depositLine(stored)).toBe("Deposit of £185.00 due on acceptance");
  });
});

describe("what the customer reads on the quote", () => {
  it("states the deposit and when it falls due", () => {
    expect(depositLine(18500)).toBe("Deposit of £185.00 due on acceptance");
    expect(depositLine(125050)).toBe("Deposit of £1,250.50 due on acceptance");
  });

  it("says nothing at all where there is nothing to say", () => {
    // "Deposit: £0.00 due on acceptance" is noise on a document meant to be
    // signed, and on an unagreed deposit it is a claim.
    expect(depositLine(null)).toBeNull();
    expect(depositLine(undefined)).toBeNull();
    expect(depositLine(0)).toBeNull();
  });
});

describe("the second trigger — a stage's work is done, so its invoice goes out", () => {
  // Asserted through the QUERY the action builds, not the rows a stub hands
  // back. The stub returns whatever it was constructed with, so an assertion
  // on the return value passes whether or not the conditional UPDATE that
  // makes this exactly-once is present — which is the entire defect the
  // criterion exists to catch. #660 froze three of those.
  it("claims the stage with a conditional UPDATE, so two callers cannot both invoice", async () => {
    vi.resetModules();
    const { mockSupabaseClient } = await import("../helpers/supabase");
    const stub = mockSupabaseClient([
      {
        id: "stage-1",
        stage_number: 1,
        amount_pennies: 18500,
        // Already invoiced, so the run stops after the claim and never reaches
        // createInvoiceRecord — the claim is what this test is about.
        invoice_id: "inv-1",
        work_completed_at: null,
      },
    ]);

    // The shared helper deliberately stubs the PostgREST builder and nothing
    // else, so `auth` is added here at the call site rather than in the helper
    // — tests/regression/supabase-helper-write-path.test.ts pins its shape and
    // widening it repo-wide for one test is the pattern #549 was killed for.
    const client = Object.assign(stub.client, {
      auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) },
    });

    vi.doMock("@/lib/supabase/server", () => ({
      createClient: vi.fn(async () => client),
    }));

    const { markStageComplete } = await import("@/app/jobs/actions");
    await markStageComplete({
      jobId: "11111111-1111-4111-8111-111111111111",
      stageNumber: 1,
    });

    // The guard IS the write's condition. Reading first and then writing
    // leaves a window between the two — the shape signContract's
    // .eq("status", "sent") exists to close.
    expect(stub.getFilters()).toContainEqual({ method: "is", args: ["work_completed_at", null] });

    // And it claims by UPDATE on payment_stages, not by inserting a second row.
    const writes = stub.getWrites();
    expect(writes.some((w) => w.method === "update" && w.table === "payment_stages")).toBe(true);

    vi.doUnmock("@/lib/supabase/server");
  });
});
