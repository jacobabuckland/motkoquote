// The other half of the 19 Sep pay-path fix: refuse the over-ceiling invoice
// at creation, while the contractor can still do something about it.
//
// `buildPayPanel` returning `setup_incomplete` is the safety net for invoices
// already sent. It is not the fix — by the time the customer reads it, a trade
// has sent a £12,500 invoice and is waiting on money that cannot arrive. The
// refusal belongs where the contractor is still at the keyboard.
//
// Asserts the SERVER ACTION, not the derivation: the guard must run on what the
// database returns for the contractor, against the amount the server derived,
// on the real path. A stub client stands in for Supabase — see AGENTS.md on
// mocking the module the action imports before the dynamic import.
import { beforeEach, describe, expect, it, vi } from "vitest";

const QUOTE = "22222222-2222-4222-8222-222222222222";

type Contractor = {
  payout_details_complete: boolean;
  payout_account_holder_name: string | null;
  payout_sort_code: string | null;
  payout_account_number: string | null;
};

/** Connect complete, manual form never filled — what syncStripeAccountStatus leaves. */
const connectOnly: Contractor = {
  payout_details_complete: true,
  payout_account_holder_name: "Acme Plastering Ltd",
  payout_sort_code: "123456",
  payout_account_number: null,
};

const withBankDetails: Contractor = { ...connectOnly, payout_account_number: "12345678" };

let inserted: Record<string, unknown>[] = [];

/**
 * Drives the real createInvoice against a quote of `total` POUNDS (migration 23)
 * with the work marked complete, so a final invoice derives `total` less
 * anything already invoiced.
 */
const raiseFinalInvoice = async (total: number, contractor: Contractor) => {
  inserted = [];
  vi.resetModules();

  const quote = {
    total,
    invoices: [],
    contracts: { deposit_pct: null, status: "signed" },
    job: {
      id: "33333333-3333-4333-8333-333333333333",
      work_completed_at: "2026-09-18T09:00:00Z",
      customer: { name: "A Customer", contact: { email: "customer@example.test" } },
      contractor: { id: "44444444-4444-4444-8444-444444444444", company_name: "Acme Plastering Ltd", ...contractor },
    },
  };

  vi.doMock("@/lib/supabase/server", () => ({
    createClient: async () => ({
      // No `auth` property: assertSubscriptionWritable is skipped, which is the
      // documented shape that guard expects rather than a way around it.
      from: (table: string) => ({
        select: () => ({
          eq: () => ({
            single: async () => ({ data: quote, error: null }),
            order: async () => ({ data: [], error: null }),
          }),
        }),
        insert: (payload: Record<string, unknown>) => {
          // A £12,500 job now reaches the payment-stage schedule as well — the
          // pounds-vs-pence comparison that kept that branch dormant is fixed.
          // It is a different write with a different shape: an array in, and
          // `.select()` awaited directly rather than through `.single()`. Kept
          // out of `inserted`, which is this file's record of the INVOICE, so
          // "writes nothing when it refuses" still means what it says.
          if (table === "payment_stages") {
            const rows = (payload as unknown as Record<string, unknown>[]).map((row, index) => ({
              id: `stage_${index + 1}`,
              ...row,
            }));
            return { select: async () => ({ data: rows, error: null }) };
          }
          inserted.push(payload);
          return { select: () => ({ single: async () => ({ data: { id: "inv_1" }, error: null }) }) };
        },
      }),
    }),
  }));
  vi.doMock("next/cache", () => ({ revalidatePath: () => {} }));
  vi.doMock("@/lib/invoicing", () => ({
    createInvoiceRecord: async (_c: unknown, args: { amount: number }) => {
      inserted.push({ amount: args.amount });
      return { invoiceId: "inv_1" };
    },
  }));

  const mod = await import("@/app/dashboard/actions");
  return mod.createInvoice({ quoteId: QUOTE, invoiceType: "final" as const });
};

beforeEach(() => {
  vi.resetModules();
});

describe("an invoice over the Pay by Bank ceiling", () => {
  it("is refused when the trade has no bank details to transfer to", async () => {
    await expect(raiseFinalInvoice(12_500, connectOnly)).rejects.toThrow(
      /bank account details in Settings/i,
    );
  });

  it("writes nothing when it refuses", async () => {
    // A refusal that still raised the invoice would be worse than no guard:
    // the customer gets the unpayable document and the contractor gets an error.
    await raiseFinalInvoice(12_500, connectOnly).catch(() => {});

    expect(inserted, "the invoice must not exist").toEqual([]);
  });

  it("names the ceiling and the remedy, so the message can be acted on", async () => {
    const message = await raiseFinalInvoice(12_500, connectOnly).catch((e: Error) => e.message);

    expect(message).toContain("£10,000");
    expect(message).toContain("Settings");
  });

  it("goes through once the bank details are there", async () => {
    await expect(raiseFinalInvoice(12_500, withBankDetails)).resolves.toBeDefined();
    expect(inserted).toContainEqual({ amount: 12_500 });
  });
});

describe("what the guard must not touch", () => {
  it("lets an ordinary under-ceiling invoice through without bank details", async () => {
    // The common case. A Connect-onboarded trade with no manual details is
    // payable on the rail below the ceiling, and this guard must not know
    // better than that.
    await expect(raiseFinalInvoice(5_000, connectOnly)).resolves.toBeDefined();
    expect(inserted).toContainEqual({ amount: 5_000 });
  });

  it("lets an invoice at exactly the ceiling through", async () => {
    // £10,000 is payable — create-payment-intent refuses ABOVE the limit, so
    // the guard has to draw the line in the same place or it blocks an invoice
    // the rail would have taken.
    await expect(raiseFinalInvoice(10_000, connectOnly)).resolves.toBeDefined();
    expect(inserted).toContainEqual({ amount: 10_000 });
  });

  it("refuses a penny over it", async () => {
    await expect(raiseFinalInvoice(10_000.01, connectOnly)).rejects.toThrow(
      /bank account details in Settings/i,
    );
  });
});
