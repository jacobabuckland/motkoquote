/**
 * REFUND-1: Full and partial refund on a settled job.
 *
 * Every stub is built in this file, per the PM directive on the issue: nothing
 * here relies on `tests/setup.ts`, and nothing here requires it to change.
 * Pattern from tests/acceptance/240.test.ts:241-260 — the stub is cast once,
 * where it is returned, and its recorders come back alongside it rather than
 * being reached for through the cast.
 *
 * The module under test takes its Supabase client and its Stripe client as an
 * optional argument, so these stubs are passed in rather than mocked into the
 * module registry. That is why there is no vi.doMock here and no import-order
 * hazard: the dependency is a parameter, not a module.
 */

import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

import {
  getRefundEligibility,
  refundJob,
  type RefundDeps,
} from "@/lib/refund-settlement";

/**
 * A `jobs` row as the refund path reads it — the whole shape, not a partial.
 * A settled job has `paid_at` set and `settlement_state` null; the reversal and
 * refund values only ever appear once something has gone backwards.
 */
type JobRow = {
  id: string;
  paid_at: string | null;
  payment_provider_ref: string | null;
  settlement_state: string | null;
  total_refunded_pennies: number | null;
  fee_amount_pennies: number | null;
  fee_waived_amount_pennies: number | null;
  fee_waived_reason: string | null;
  processing_fee_actual_pennies: number | null;
};

const settledJob = (overrides: Partial<JobRow> = {}): JobRow => ({
  id: "job-1",
  paid_at: "2026-09-01T10:00:00Z",
  payment_provider_ref: "pi_test_123",
  settlement_state: null,
  total_refunded_pennies: null,
  fee_amount_pennies: 1500,
  fee_waived_amount_pennies: 0,
  fee_waived_reason: null,
  processing_fee_actual_pennies: null,
  ...overrides,
});

/** A Supabase client that serves the given jobs and records what is written. */
function buildSupabaseStub(jobs: Record<string, JobRow>) {
  const updates: Array<{ id: string; patch: Record<string, unknown> }> = [];

  const from = vi.fn((_table?: string) => ({
    select: vi.fn((_columns?: string) => ({
      eq: vi.fn((_field?: string, value?: string) => ({
        maybeSingle: vi.fn(async () => ({
          data: (value ? jobs[value] : null) ?? null,
          error: null,
        })),
      })),
    })),
    update: vi.fn((patch?: Record<string, unknown>) => ({
      eq: vi.fn(async (_field?: string, value?: string) => {
        if (value && patch) {
          updates.push({ id: value, patch });
          const row = jobs[value];
          if (row) Object.assign(row, patch);
        }
        return { error: null };
      }),
    })),
  }));

  return { client: { from } as unknown as SupabaseClient, updates, from };
}

type RecordedRefund = {
  paymentIntent: string;
  amountPennies: number;
  reverseTransfer: boolean | undefined;
  refundApplicationFee: boolean | undefined;
  idempotencyKey: string | undefined;
};

/**
 * A Stripe client that knows what it captured and remembers what it returned.
 *
 * A refund it creates joins the list it reports, which is what makes the
 * "total refunded never exceeds the settlement" case real rather than assumed:
 * the second call genuinely sees the first one's money.
 */
function buildStripeStub(capturedPennies: number) {
  const issued: Array<{ id: string; amount: number; status: string }> = [];
  const created: RecordedRefund[] = [];
  let counter = 0;

  const stub = {
    paymentIntents: {
      retrieve: vi.fn(async (_id?: string) => ({
        amount: capturedPennies,
        amount_received: capturedPennies,
        status: "succeeded",
      })),
    },
    refunds: {
      list: vi.fn(async (_params?: { payment_intent?: string; limit?: number }) => ({
        data: issued,
      })),
      create: vi.fn(
        async (
          params?: {
            payment_intent?: string;
            amount?: number;
            reverse_transfer?: boolean;
            refund_application_fee?: boolean;
          },
          options?: { idempotencyKey?: string },
        ) => {
          if (!params?.payment_intent || !params?.amount) {
            throw new Error("payment_intent and amount are required");
          }
          created.push({
            paymentIntent: params.payment_intent,
            amountPennies: params.amount,
            reverseTransfer: params.reverse_transfer,
            refundApplicationFee: params.refund_application_fee,
            idempotencyKey: options?.idempotencyKey,
          });
          counter += 1;
          const refund = { id: `re_test_${counter}`, amount: params.amount, status: "succeeded" };
          issued.push(refund);
          return refund;
        },
      ),
    },
  };

  return { stripe: stub as unknown as Stripe, created, issued };
}

/** A settled £100 job and the clients that serve it. */
const scenario = (job: JobRow = settledJob(), capturedPennies = 10_000) => {
  const jobs: Record<string, JobRow> = { [job.id]: job };
  const supabase = buildSupabaseStub(jobs);
  const stripe = buildStripeStub(capturedPennies);
  const deps: RefundDeps = { supabase: supabase.client, stripe: stripe.stripe };
  return { jobs, job, deps, updates: supabase.updates, stripe };
};

describe("getRefundEligibility", () => {
  it("a settled Stripe job can be refunded, up to what Stripe captured", async () => {
    const { job, deps } = scenario();

    const result = await getRefundEligibility(job.id, deps);

    expect(result.eligible).toBe(true);
    if (result.eligible) {
      expect(result.maxRefundablePennies).toBe(10_000);
      expect(result.alreadyRefundedPennies).toBe(0);
    }
  });

  it("the ceiling is what Stripe captured, not what our own columns say", async () => {
    // The settlement amount must never be derived from invoices.amount or
    // quotes.total, which are numeric POUNDS. Stripe reports pennies, and this
    // job's captured amount differs from every number on the row.
    const { job, deps } = scenario(settledJob(), 7_350);

    const result = await getRefundEligibility(job.id, deps);

    expect(result.eligible).toBe(true);
    if (result.eligible) expect(result.maxRefundablePennies).toBe(7_350);
  });

  it("a manually-marked-paid job has no settlement to reverse, and says so", async () => {
    const { job, deps } = scenario(settledJob({ payment_provider_ref: null }));

    const result = await getRefundEligibility(job.id, deps);

    expect(result.eligible).toBe(false);
    if (!result.eligible) expect(result.reason).toContain("manual");
  });

  it("a payment taken on another rail is refused rather than sent to Stripe", async () => {
    // payment_provider_ref also holds TrueLayer ids. Handing `tl_…` to Stripe
    // is a 404 in front of the trade; this says what is actually wrong.
    const { job, deps, stripe } = scenario(
      settledJob({ payment_provider_ref: "tl_test_123" }),
    );

    const result = await getRefundEligibility(job.id, deps);

    expect(result.eligible).toBe(false);
    if (!result.eligible) expect(result.reason).toMatch(/didn't go through Stripe/i);
    expect(stripe.created).toHaveLength(0);
  });

  it("an unsettled job is not refundable", async () => {
    const { job, deps } = scenario(
      settledJob({ paid_at: null, payment_provider_ref: null }),
    );

    const result = await getRefundEligibility(job.id, deps);

    expect(result.eligible).toBe(false);
    if (!result.eligible) expect(result.reason).toContain("not settled");
  });

  it("an already-refunded job is not refundable again", async () => {
    const { job, deps } = scenario(settledJob({ settlement_state: "refunded" }));

    const result = await getRefundEligibility(job.id, deps);

    expect(result.eligible).toBe(false);
    if (!result.eligible) expect(result.reason).toContain("refunded");
  });
});

describe("refundJob", () => {
  it("refunds in full and records a state distinct from paid and unpaid", async () => {
    const { job, deps, updates, stripe } = scenario();

    const result = await refundJob(job.id, 10_000, deps);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.refundId).toMatch(/^re_/);
      expect(result.newState).toBe("refunded");
    }

    expect(stripe.created).toHaveLength(1);
    expect(stripe.created[0].paymentIntent).toBe("pi_test_123");
    expect(stripe.created[0].amountPennies).toBe(10_000);

    expect(updates).toHaveLength(1);
    expect(updates[0].patch.settlement_state).toBe("refunded");
    expect(updates[0].patch.total_refunded_pennies).toBe(10_000);
  });

  it("refunds in part, and the job stays distinguishable from a full refund", async () => {
    const { job, deps, updates, stripe } = scenario();

    const result = await refundJob(job.id, 5_000, deps);

    expect(result.success).toBe(true);
    if (result.success) expect(result.newState).toBe("partially_refunded");
    expect(stripe.created[0].amountPennies).toBe(5_000);
    expect(updates[0].patch.total_refunded_pennies).toBe(5_000);
  });

  it("takes the money out of the trade's account, not motko's", async () => {
    // Payments are DESTINATION charges: without reverse_transfer the platform
    // pays the refund and the trade keeps the money. The card's warning to the
    // trade — that their balance drops and may go negative — is only true
    // because of this flag.
    const { job, deps, stripe } = scenario();

    await refundJob(job.id, 10_000, deps);

    expect(stripe.created[0].reverseTransfer).toBe(true);
  });

  it("does not return motko's fee, and leaves every fee column alone", async () => {
    // REVERSAL_CLAUSE.serviceFee, stated in the contractor terms: the service
    // fee is not refunded and is not pro-rated by a partial refund.
    const { job, deps, updates, stripe } = scenario();

    await refundJob(job.id, 5_000, deps);

    expect(stripe.created[0].refundApplicationFee).toBe(false);
    for (const key of Object.keys(updates[0].patch)) {
      expect(key).not.toMatch(/fee/);
    }
    expect(job.fee_amount_pennies).toBe(1500);
  });

  it("a repeated refund does not move money twice", async () => {
    const { job, deps, stripe } = scenario();

    const first = await refundJob(job.id, 10_000, deps);
    expect(first.success).toBe(true);

    const second = await refundJob(job.id, 10_000, deps);

    expect(second.success).toBe(false);
    if (!second.success) expect(second.error).toMatch(/refunded/i);
    expect(stripe.created).toHaveLength(1);
  });

  it("carries an idempotency key, so a retried request is not a second refund", async () => {
    const { job, deps, stripe } = scenario();

    await refundJob(job.id, 4_000, deps);

    expect(stripe.created[0].idempotencyKey).toBeTruthy();
    expect(stripe.created[0].idempotencyKey).toContain(job.id);
  });

  it("refuses an amount larger than what is left", async () => {
    const { job, deps, stripe } = scenario();

    const result = await refundJob(job.id, 12_000, deps);

    expect(result.success).toBe(false);
    expect(stripe.created).toHaveLength(0);
  });

  it("refuses a zero or negative amount", async () => {
    const { job, deps, stripe } = scenario();

    expect((await refundJob(job.id, 0, deps)).success).toBe(false);
    expect((await refundJob(job.id, -500, deps)).success).toBe(false);
    expect(stripe.created).toHaveLength(0);
  });

  it("reports a rejected return to the trade rather than swallowing it", async () => {
    const { job, deps, stripe } = scenario();
    stripe.stripe.refunds.create = vi.fn(async () => {
      throw new Error("The customer's bank rejected the return.");
    }) as unknown as Stripe["refunds"]["create"];

    const result = await refundJob(job.id, 10_000, deps);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/bank rejected the return/i);
  });
});

describe("refund, end to end", () => {
  it("checks eligibility, refunds, and lands in the refunded state", async () => {
    const { job, deps, updates, stripe } = scenario();

    const eligibility = await getRefundEligibility(job.id, deps);
    expect(eligibility.eligible).toBe(true);

    const amount = eligibility.eligible ? eligibility.maxRefundablePennies : 0;
    const result = await refundJob(job.id, amount, deps);

    expect(result.success).toBe(true);
    expect(stripe.created).toHaveLength(1);
    expect(stripe.created[0].amountPennies).toBe(10_000);
    expect(updates[0].patch.settlement_state).toBe("refunded");
  });

  it("the total refunded never exceeds the settlement, across several refunds", async () => {
    const { job, deps, stripe } = scenario();

    expect((await refundJob(job.id, 6_000, deps)).success).toBe(true);

    const second = await refundJob(job.id, 4_000, deps);
    expect(second.success).toBe(true);
    if (second.success) expect(second.newState).toBe("refunded");

    // A third attempt has nothing left to take.
    const third = await refundJob(job.id, 1_000, deps);
    expect(third.success).toBe(false);

    const totalRefunded = stripe.created.reduce((sum, r) => sum + r.amountPennies, 0);
    expect(totalRefunded).toBe(10_000);
  });

  it("a partial refund leaves the rest refundable", async () => {
    const { job, deps } = scenario();

    await refundJob(job.id, 3_000, deps);

    const eligibility = await getRefundEligibility(job.id, deps);
    expect(eligibility.eligible).toBe(true);
    if (eligibility.eligible) {
      expect(eligibility.maxRefundablePennies).toBe(7_000);
      expect(eligibility.alreadyRefundedPennies).toBe(3_000);
    }
  });
});

describe("the refund surface", () => {
  it("the server actions are exported", async () => {
    const mod = await import("@/app/jobs/[id]/refund-actions");
    expect(mod.checkRefundEligibility).toBeDefined();
    expect(mod.processRefund).toBeDefined();
  });

  it("the refund control is exported", async () => {
    const mod = await import("@/app/jobs/[id]/refund-button");
    expect(mod.default).toBeDefined();
  });
});
