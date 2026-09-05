/**
 * REFUND-1: Full and partial refund on a settled job.
 *
 * All mocks (Supabase, Stripe) are built inside this test file per PM directive.
 * Pattern from tests/acceptance/240.test.ts:241-260.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// Type definitions for refund eligibility and results
type RefundEligibility =
  | { eligible: true; maxRefundablePennies: number }
  | { eligible: false; reason: string };

type RefundResult =
  | { success: true; refundId: string; newState: string }
  | { success: false; error: string };

// Job fixture shape
type JobRow = {
  id: string;
  settlement_state: string | null;
  payment_provider_ref: string | null;
  fee_amount_pennies: number | null;
  fee_net_pennies: number | null;
  fee_vat_pennies: number | null;
  sent_total: number | null;
};

// Stripe refund shape
type StripeRefund = {
  id: string;
  payment_intent: string;
  amount: number;
  status: string;
};

/**
 * Build a Supabase client stub with test job fixtures.
 * Returns the client and spy functions for assertions.
 */
function buildSupabaseStub(jobs: Record<string, JobRow>) {
  const selectSpy = vi.fn();
  const updateSpy = vi.fn();
  const eqSpy = vi.fn();
  const singleSpy = vi.fn();

  const fromMock = vi.fn((table?: string) => {
    if (table === "jobs") {
      return {
        select: selectSpy.mockReturnValue({
          eq: eqSpy.mockImplementation((field?: string, value?: string) => {
            const job = value ? jobs[value] : null;
            return {
              single: singleSpy.mockResolvedValue({
                data: job ?? null,
                error: job ? null : { message: "Job not found", code: "PGRST116" },
              }),
            };
          }),
        }),
        update: updateSpy.mockReturnValue({
          eq: eqSpy.mockImplementation((field?: string, value?: string) => {
            return {
              single: singleSpy.mockResolvedValue({
                data: value ? jobs[value] : null,
                error: null,
              }),
            };
          }),
        }),
      };
    }
    return { select: selectSpy, update: updateSpy };
  });

  return {
    client: { from: fromMock } as unknown as SupabaseClient,
    spies: { from: fromMock, select: selectSpy, update: updateSpy, eq: eqSpy, single: singleSpy },
  };
}

/**
 * Build a Stripe client stub that records refund calls.
 */
function buildStripeStub() {
  const refundCalls: Array<{ payment_intent: string; amount: number; idempotency_key?: string }> =
    [];

  const createRefundMock = vi.fn(
    async (params?: {
      payment_intent?: string;
      amount?: number;
      metadata?: Record<string, string>;
    }) => {
      if (!params?.payment_intent || !params?.amount) {
        throw new Error("payment_intent and amount are required");
      }

      refundCalls.push({
        payment_intent: params.payment_intent,
        amount: params.amount,
      });

      return {
        id: `re_test_${Date.now()}`,
        payment_intent: params.payment_intent,
        amount: params.amount,
        status: "succeeded",
      } as StripeRefund;
    },
  );

  return {
    refunds: { create: createRefundMock },
    calls: refundCalls,
  };
}

describe("getRefundEligibility", () => {
  let getRefundEligibility: (jobId: string) => Promise<RefundEligibility>;

  beforeEach(async () => {
    // Import the module under test
    const mod = await import("@/lib/refund-settlement");
    getRefundEligibility = mod.getRefundEligibility;
  });

  it("returns eligible for a settled Stripe job", async () => {
    const jobs: Record<string, JobRow> = {
      "job-settled-stripe": {
        id: "job-settled-stripe",
        settlement_state: "settled",
        payment_provider_ref: "pi_test_123",
        fee_amount_pennies: 1500,
        fee_net_pennies: 1250,
        fee_vat_pennies: 250,
        sent_total: 10000,
      },
    };

    const { client } = buildSupabaseStub(jobs);

    // Mock the Supabase client injection
    vi.doMock("@/lib/supabase/server", () => ({
      createServerClient: () => client,
    }));

    const result = await getRefundEligibility("job-settled-stripe");

    expect(result.eligible).toBe(true);
    if (result.eligible) {
      expect(result.maxRefundablePennies).toBeGreaterThan(0);
      expect(result.maxRefundablePennies).toBe(10000); // Full settlement amount
    }
  });

  it("returns not eligible for manually-marked-paid job", async () => {
    const jobs: Record<string, JobRow> = {
      "job-manual": {
        id: "job-manual",
        settlement_state: "settled",
        payment_provider_ref: null, // No Stripe ref
        fee_amount_pennies: 1500,
        fee_net_pennies: 1250,
        fee_vat_pennies: 250,
        sent_total: 10000,
      },
    };

    const { client } = buildSupabaseStub(jobs);

    vi.doMock("@/lib/supabase/server", () => ({
      createServerClient: () => client,
    }));

    const result = await getRefundEligibility("job-manual");

    expect(result.eligible).toBe(false);
    if (!result.eligible) {
      expect(result.reason).toContain("manual");
    }
  });

  it("returns not eligible for unsettled job", async () => {
    const jobs: Record<string, JobRow> = {
      "job-unsettled": {
        id: "job-unsettled",
        settlement_state: null,
        payment_provider_ref: null,
        fee_amount_pennies: null,
        fee_net_pennies: null,
        fee_vat_pennies: null,
        sent_total: 10000,
      },
    };

    const { client } = buildSupabaseStub(jobs);

    vi.doMock("@/lib/supabase/server", () => ({
      createServerClient: () => client,
    }));

    const result = await getRefundEligibility("job-unsettled");

    expect(result.eligible).toBe(false);
    if (!result.eligible) {
      expect(result.reason).toContain("not settled");
    }
  });

  it("returns not eligible for already-refunded job", async () => {
    const jobs: Record<string, JobRow> = {
      "job-refunded": {
        id: "job-refunded",
        settlement_state: "refunded",
        payment_provider_ref: "pi_test_456",
        fee_amount_pennies: 1500,
        fee_net_pennies: 1250,
        fee_vat_pennies: 250,
        sent_total: 10000,
      },
    };

    const { client } = buildSupabaseStub(jobs);

    vi.doMock("@/lib/supabase/server", () => ({
      createServerClient: () => client,
    }));

    const result = await getRefundEligibility("job-refunded");

    expect(result.eligible).toBe(false);
    if (!result.eligible) {
      expect(result.reason).toContain("refunded");
    }
  });
});

describe("refundJob", () => {
  let refundJob: (
    jobId: string,
    refundAmountPennies: number,
  ) => Promise<RefundResult>;

  beforeEach(async () => {
    const mod = await import("@/lib/refund-settlement");
    refundJob = mod.refundJob;
  });

  it("processes full refund and updates state to refunded", async () => {
    const jobs: Record<string, JobRow> = {
      "job-full-refund": {
        id: "job-full-refund",
        settlement_state: "settled",
        payment_provider_ref: "pi_test_789",
        fee_amount_pennies: 1500,
        fee_net_pennies: 1250,
        fee_vat_pennies: 250,
        sent_total: 10000,
      },
    };

    const { client, spies } = buildSupabaseStub(jobs);
    const stripe = buildStripeStub();

    // Mock dependencies
    vi.doMock("@/lib/supabase/server", () => ({
      createServerClient: () => client,
    }));
    vi.doMock("@/lib/stripe", () => ({
      stripe,
    }));

    const result = await refundJob("job-full-refund", 10000);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.refundId).toMatch(/^re_/);
      expect(result.newState).toBe("refunded");
    }

    // Verify Stripe API was called
    expect(stripe.calls).toHaveLength(1);
    expect(stripe.calls[0].payment_intent).toBe("pi_test_789");
    expect(stripe.calls[0].amount).toBe(10000);

    // Verify database update was attempted
    expect(spies.update).toHaveBeenCalled();
  });

  it("processes partial refund and updates state to partially_refunded", async () => {
    const jobs: Record<string, JobRow> = {
      "job-partial": {
        id: "job-partial",
        settlement_state: "settled",
        payment_provider_ref: "pi_test_partial",
        fee_amount_pennies: 1500,
        fee_net_pennies: 1250,
        fee_vat_pennies: 250,
        sent_total: 10000,
      },
    };

    const { client } = buildSupabaseStub(jobs);
    const stripe = buildStripeStub();

    vi.doMock("@/lib/supabase/server", () => ({
      createServerClient: () => client,
    }));
    vi.doMock("@/lib/stripe", () => ({
      stripe,
    }));

    const result = await refundJob("job-partial", 5000);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.newState).toBe("partially_refunded");
    }

    // Verify partial amount was sent to Stripe
    expect(stripe.calls).toHaveLength(1);
    expect(stripe.calls[0].amount).toBe(5000);
  });

  it("is idempotent: repeated refund does not double-process", async () => {
    const jobs: Record<string, JobRow> = {
      "job-idempotent": {
        id: "job-idempotent",
        settlement_state: "settled",
        payment_provider_ref: "pi_test_idemp",
        fee_amount_pennies: 1500,
        fee_net_pennies: 1250,
        fee_vat_pennies: 250,
        sent_total: 10000,
      },
    };

    const { client } = buildSupabaseStub(jobs);
    const stripe = buildStripeStub();

    vi.doMock("@/lib/supabase/server", () => ({
      createServerClient: () => client,
    }));
    vi.doMock("@/lib/stripe", () => ({
      stripe,
    }));

    // First refund
    const first = await refundJob("job-idempotent", 10000);
    expect(first.success).toBe(true);

    // Update the job state to refunded for second call
    jobs["job-idempotent"].settlement_state = "refunded";

    // Second refund with same parameters
    const second = await refundJob("job-idempotent", 10000);

    // Should fail or no-op, not double-charge
    if (second.success) {
      // If it "succeeds", Stripe should not have been called again
      expect(stripe.calls).toHaveLength(1);
    } else {
      // Or it should fail with clear message
      expect(second.error).toContain("already refunded");
    }
  });
});

describe("refund integration", () => {
  it("checks eligibility, processes refund, and updates state end-to-end", async () => {
    const jobs: Record<string, JobRow> = {
      "job-integration": {
        id: "job-integration",
        settlement_state: "settled",
        payment_provider_ref: "pi_test_integration",
        fee_amount_pennies: 1500,
        fee_net_pennies: 1250,
        fee_vat_pennies: 250,
        sent_total: 10000,
      },
    };

    const { client } = buildSupabaseStub(jobs);
    const stripe = buildStripeStub();

    vi.doMock("@/lib/supabase/server", () => ({
      createServerClient: () => client,
    }));
    vi.doMock("@/lib/stripe", () => ({
      stripe,
    }));

    const mod = await import("@/lib/refund-settlement");

    // Step 1: Check eligibility
    const eligibility = await mod.getRefundEligibility("job-integration");
    expect(eligibility.eligible).toBe(true);

    let maxRefundable = 0;
    if (eligibility.eligible) {
      maxRefundable = eligibility.maxRefundablePennies;
      expect(maxRefundable).toBe(10000);
    }

    // Step 2: Process refund
    const result = await mod.refundJob("job-integration", maxRefundable);
    expect(result.success).toBe(true);

    // Step 3: Verify Stripe was called correctly
    expect(stripe.calls).toHaveLength(1);
    expect(stripe.calls[0].payment_intent).toBe("pi_test_integration");
    expect(stripe.calls[0].amount).toBe(10000);
  });

  it("enforces total refunded never exceeds settlement", async () => {
    const jobs: Record<string, JobRow> = {
      "job-multi-partial": {
        id: "job-multi-partial",
        settlement_state: "settled",
        payment_provider_ref: "pi_test_multi",
        fee_amount_pennies: 1500,
        fee_net_pennies: 1250,
        fee_vat_pennies: 250,
        sent_total: 10000,
      },
    };

    const { client } = buildSupabaseStub(jobs);
    const stripe = buildStripeStub();

    vi.doMock("@/lib/supabase/server", () => ({
      createServerClient: () => client,
    }));
    vi.doMock("@/lib/stripe", () => ({
      stripe,
    }));

    const mod = await import("@/lib/refund-settlement");

    // First partial refund: 6000
    const first = await mod.refundJob("job-multi-partial", 6000);
    expect(first.success).toBe(true);

    // Update state after first refund
    jobs["job-multi-partial"].settlement_state = "partially_refunded";

    // Second partial refund: 4000 (total now 10000)
    const second = await mod.refundJob("job-multi-partial", 4000);
    expect(second.success).toBe(true);

    // Third attempt: 1000 more (would exceed settlement)
    const eligibility = await mod.getRefundEligibility("job-multi-partial");

    // Should now be ineligible or have maxRefundable = 0
    if (eligibility.eligible) {
      expect(eligibility.maxRefundablePennies).toBe(0);
    } else {
      expect(eligibility.reason).toMatch(/fully refunded|exceeded/i);
    }
  });
});

describe("refund UI components", () => {
  it("exports refund actions module", async () => {
    const mod = await import("@/app/jobs/[id]/refund-actions");
    expect(mod).toBeDefined();
  });

  it("exports refund button component", async () => {
    const mod = await import("@/app/jobs/[id]/refund-button");
    expect(mod.default).toBeDefined();
  });
});
