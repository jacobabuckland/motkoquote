/**
 * REFUND-2: Refund on a staged job.
 *
 * Following the same stubbing pattern as tests/acceptance/611.test.ts — every
 * stub is built in this file, deps are passed as parameters rather than mocked
 * into the module registry, and the recorders come back alongside the client
 * rather than being reached for through a cast.
 *
 * REFUND-1 treats every job as a single settlement. STAGE-2 introduced multiple
 * settlements per job, each with its own Stripe payment intent. This item adds
 * stage-aware refund functions so a trade can refund the deposit alone, the
 * balance alone, or both, without reopening stages that stay settled.
 */

import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

import {
  getStageRefundEligibility,
  refundStage,
  type RefundDeps,
} from "@/lib/refund-settlement";

/**
 * A `payment_stages` row as the refund path reads it. The refund-tracking
 * columns mirror what `jobs` already has.
 */
type StageRow = {
  id: string;
  job_id: string;
  stage_number: number;
  amount_pennies: number;
  invoice_id: string | null;
  settled_at: string | null;
  payment_provider_ref: string | null;
  settlement_state: string | null;
  total_refunded_pennies: number | null;
};

const settledStage = (overrides: Partial<StageRow> = {}): StageRow => ({
  id: "stage-1",
  job_id: "job-1",
  stage_number: 1,
  amount_pennies: 700000,
  invoice_id: "inv-1",
  settled_at: "2026-09-01T10:00:00Z",
  payment_provider_ref: "pi_test_deposit",
  settlement_state: null,
  total_refunded_pennies: null,
  ...overrides,
});

/**
 * A Supabase client that serves the given stages and records what is written.
 * Mirrors the job-level stub from 611.test.ts but queries payment_stages.
 */
function buildSupabaseStub(stages: Record<string, StageRow>) {
  const updates: Array<{ id: string; patch: Record<string, unknown> }> = [];

  const from = vi.fn((table?: string) => {
    if (table === "payment_stages") {
      return {
        // eq("job_id", ...).eq("stage_number", ...).maybeSingle().
        // `eq` and `maybeSingle` are SIBLINGS on what each eq() returns: the
        // builder is chainable at every step, so a second eq() has to be
        // reachable without awaiting the first.
        select: vi.fn(() => ({
          eq: vi.fn((field?: string, value?: string | number) => ({
            eq: vi.fn((_field2?: string, value2?: string | number) => ({
              maybeSingle: vi.fn(async () => {
                const found = Object.values(stages).find(
                  (s) => s.job_id === value && s.stage_number === value2,
                );
                return { data: found ?? null, error: null };
              }),
            })),
            maybeSingle: vi.fn(async () => {
              if (field !== "job_id") return { data: null, error: null };
              const found = Object.values(stages).find((s) => s.job_id === value);
              return { data: found ?? null, error: null };
            }),
          })),
        })),
        update: vi.fn((patch?: Record<string, unknown>) => ({
          eq: vi.fn((field?: string, value?: string) => ({
            eq: vi.fn(async (_field2?: string, value2?: string | number) => {
              if (field === "job_id" && patch) {
                const found = Object.values(stages).find(
                  (s) => s.job_id === value && s.stage_number === value2,
                );
                if (found) {
                  updates.push({ id: found.id, patch });
                  Object.assign(found, patch);
                }
              }
              return { error: null };
            }),
          })),
        })),
      };
    }
    return { select: vi.fn(), update: vi.fn() };
  });

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
 * A Stripe client that knows what it captured per payment intent and remembers
 * what it returned. Mirrors 611.test.ts.
 */
function buildStripeStub(settlements: Record<string, number>) {
  const issued: Record<string, Array<{ id: string; amount: number; status: string }>> = {};
  const created: RecordedRefund[] = [];
  let counter = 0;

  const stub = {
    paymentIntents: {
      retrieve: vi.fn(async (id?: string) => ({
        amount: settlements[id ?? ""] ?? 0,
        amount_received: settlements[id ?? ""] ?? 0,
        status: "succeeded",
      })),
    },
    refunds: {
      list: vi.fn(async (params?: { payment_intent?: string; limit?: number }) => ({
        data: issued[params?.payment_intent ?? ""] ?? [],
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
          if (!issued[params.payment_intent]) issued[params.payment_intent] = [];
          issued[params.payment_intent].push(refund);
          return refund;
        },
      ),
    },
  };

  return { stripe: stub as unknown as Stripe, created, issued };
}

/** A settled £7,000 deposit stage and the clients that serve it. */
const scenario = (
  stage: StageRow = settledStage(),
  capturedPennies = 700000,
) => {
  const stages: Record<string, StageRow> = { [stage.id]: stage };
  const supabase = buildSupabaseStub(stages);
  const stripe = buildStripeStub({ [stage.payment_provider_ref ?? ""]: capturedPennies });
  const deps: RefundDeps = { supabase: supabase.client, stripe: stripe.stripe };
  return { stages, stage, deps, updates: supabase.updates, stripe };
};

describe("getStageRefundEligibility", () => {
  it("a settled Stripe stage can be refunded, up to what Stripe captured", async () => {
    const { stage, deps } = scenario();

    const result = await getStageRefundEligibility(stage.job_id, stage.stage_number, deps);

    expect(result.eligible).toBe(true);
    if (result.eligible) {
      expect(result.maxRefundablePennies).toBe(700000);
      expect(result.alreadyRefundedPennies).toBe(0);
    }
  });

  it("the ceiling is what Stripe captured for this stage, not our own columns", async () => {
    const { stage, deps } = scenario(settledStage(), 6_850);

    const result = await getStageRefundEligibility(stage.job_id, stage.stage_number, deps);

    expect(result.eligible).toBe(true);
    if (result.eligible) expect(result.maxRefundablePennies).toBe(6_850);
  });

  it("a manually-marked-paid stage has no settlement to reverse", async () => {
    const { stage, deps } = scenario(settledStage({ payment_provider_ref: null }));

    const result = await getStageRefundEligibility(stage.job_id, stage.stage_number, deps);

    expect(result.eligible).toBe(false);
    if (!result.eligible) expect(result.reason).toContain("manual");
  });

  it("a stage paid via TrueLayer is refused rather than sent to Stripe", async () => {
    const { stage, deps, stripe } = scenario(
      settledStage({ payment_provider_ref: "tl_test_456" }),
    );

    const result = await getStageRefundEligibility(stage.job_id, stage.stage_number, deps);

    expect(result.eligible).toBe(false);
    if (!result.eligible) expect(result.reason).toMatch(/didn't go through Stripe/i);
    expect(stripe.created).toHaveLength(0);
  });

  it("an unsettled stage is not refundable", async () => {
    const { stage, deps } = scenario(
      settledStage({ settled_at: null, payment_provider_ref: null }),
    );

    const result = await getStageRefundEligibility(stage.job_id, stage.stage_number, deps);

    expect(result.eligible).toBe(false);
    if (!result.eligible) expect(result.reason).toContain("not settled");
  });

  it("an already-refunded stage is not refundable again", async () => {
    const { stage, deps } = scenario(settledStage({ settlement_state: "refunded" }));

    const result = await getStageRefundEligibility(stage.job_id, stage.stage_number, deps);

    expect(result.eligible).toBe(false);
    if (!result.eligible) expect(result.reason).toContain("refunded");
  });
});

describe("refundStage", () => {
  it("refunds a stage in full and records a state distinct from paid", async () => {
    const { stage, deps, updates, stripe } = scenario();

    const result = await refundStage(stage.job_id, stage.stage_number, 700000, deps);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.refundId).toMatch(/^re_/);
      expect(result.newState).toBe("refunded");
    }

    expect(stripe.created).toHaveLength(1);
    expect(stripe.created[0].paymentIntent).toBe("pi_test_deposit");
    expect(stripe.created[0].amountPennies).toBe(700000);

    expect(updates).toHaveLength(1);
    expect(updates[0].patch.settlement_state).toBe("refunded");
    expect(updates[0].patch.total_refunded_pennies).toBe(700000);
  });

  it("refunds a stage in part, landing in partially_refunded state", async () => {
    const { stage, deps, updates, stripe } = scenario();

    const result = await refundStage(stage.job_id, stage.stage_number, 350000, deps);

    expect(result.success).toBe(true);
    if (result.success) expect(result.newState).toBe("partially_refunded");
    expect(stripe.created[0].amountPennies).toBe(350000);
    expect(updates[0].patch.total_refunded_pennies).toBe(350000);
  });

  it("takes the money out of the trade's account, not motko's", async () => {
    const { stage, deps, stripe } = scenario();

    await refundStage(stage.job_id, stage.stage_number, 700000, deps);

    expect(stripe.created[0].reverseTransfer).toBe(true);
  });

  it("does not return motko's fee", async () => {
    const { stage, deps, stripe } = scenario();

    await refundStage(stage.job_id, stage.stage_number, 350000, deps);

    expect(stripe.created[0].refundApplicationFee).toBe(false);
  });

  it("a repeated refund does not move money twice", async () => {
    const { stage, deps, stripe } = scenario();

    const first = await refundStage(stage.job_id, stage.stage_number, 700000, deps);
    expect(first.success).toBe(true);

    const second = await refundStage(stage.job_id, stage.stage_number, 700000, deps);

    expect(second.success).toBe(false);
    if (!second.success) expect(second.error).toMatch(/refunded/i);
    expect(stripe.created).toHaveLength(1);
  });

  it("carries an idempotency key tied to the stage, not the job", async () => {
    const { stage, deps, stripe } = scenario();

    await refundStage(stage.job_id, stage.stage_number, 400000, deps);

    expect(stripe.created[0].idempotencyKey).toBeTruthy();
    expect(stripe.created[0].idempotencyKey).toContain(stage.job_id);
    expect(stripe.created[0].idempotencyKey).toContain(stage.stage_number.toString());
  });

  it("refuses an amount larger than what is left", async () => {
    const { stage, deps, stripe } = scenario();

    const result = await refundStage(stage.job_id, stage.stage_number, 800000, deps);

    expect(result.success).toBe(false);
    expect(stripe.created).toHaveLength(0);
  });

  it("refuses a zero or negative amount", async () => {
    const { stage, deps, stripe } = scenario();

    expect((await refundStage(stage.job_id, stage.stage_number, 0, deps)).success).toBe(false);
    expect((await refundStage(stage.job_id, stage.stage_number, -500, deps)).success).toBe(false);
    expect(stripe.created).toHaveLength(0);
  });

  it("reports a rejected return rather than swallowing it", async () => {
    const { stage, deps, stripe } = scenario();
    stripe.stripe.refunds.create = vi.fn(async () => {
      throw new Error("The customer's bank rejected the return.");
    }) as unknown as Stripe["refunds"]["create"];

    const result = await refundStage(stage.job_id, stage.stage_number, 700000, deps);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/bank rejected the return/i);
  });
});

describe("refund, stage-aware end to end", () => {
  it("checks eligibility, refunds, and lands in the refunded state", async () => {
    const { stage, deps, updates, stripe } = scenario();

    const eligibility = await getStageRefundEligibility(stage.job_id, stage.stage_number, deps);
    expect(eligibility.eligible).toBe(true);

    const amount = eligibility.eligible ? eligibility.maxRefundablePennies : 0;
    const result = await refundStage(stage.job_id, stage.stage_number, amount, deps);

    expect(result.success).toBe(true);
    expect(stripe.created).toHaveLength(1);
    expect(stripe.created[0].amountPennies).toBe(700000);
    expect(updates[0].patch.settlement_state).toBe("refunded");
  });

  it("the total refunded never exceeds the settlement, across several refunds", async () => {
    const { stage, deps, stripe } = scenario();

    expect((await refundStage(stage.job_id, stage.stage_number, 400000, deps)).success).toBe(true);

    const second = await refundStage(stage.job_id, stage.stage_number, 300000, deps);
    expect(second.success).toBe(true);
    if (second.success) expect(second.newState).toBe("refunded");

    const third = await refundStage(stage.job_id, stage.stage_number, 1000, deps);
    expect(third.success).toBe(false);

    const totalRefunded = stripe.created.reduce((sum, r) => sum + r.amountPennies, 0);
    expect(totalRefunded).toBe(700000);
  });

  it("a partial refund leaves the rest refundable", async () => {
    const { stage, deps } = scenario();

    await refundStage(stage.job_id, stage.stage_number, 200000, deps);

    const eligibility = await getStageRefundEligibility(stage.job_id, stage.stage_number, deps);
    expect(eligibility.eligible).toBe(true);
    if (eligibility.eligible) {
      expect(eligibility.maxRefundablePennies).toBe(500000);
      expect(eligibility.alreadyRefundedPennies).toBe(200000);
    }
  });
});

describe("refunding one stage does not affect another", () => {
  it("refunding the deposit stage leaves the balance stage unchanged", async () => {
    const deposit = settledStage({
      id: "stage-1",
      stage_number: 1,
      payment_provider_ref: "pi_test_deposit",
    });
    const balance = settledStage({
      id: "stage-2",
      stage_number: 2,
      payment_provider_ref: "pi_test_balance",
    });

    const stages: Record<string, StageRow> = {
      [deposit.id]: deposit,
      [balance.id]: balance,
    };
    const supabase = buildSupabaseStub(stages);
    const stripe = buildStripeStub({
      pi_test_deposit: 700000,
      pi_test_balance: 700000,
    });
    const deps: RefundDeps = { supabase: supabase.client, stripe: stripe.stripe };

    const result = await refundStage(deposit.job_id, deposit.stage_number, 700000, deps);

    expect(result.success).toBe(true);
    expect(deposit.settlement_state).toBe("refunded");
    expect(balance.settlement_state).toBeNull();
    expect(balance.total_refunded_pennies).toBeNull();
  });

  it("the balance stage remains refundable after the deposit is refunded", async () => {
    const deposit = settledStage({
      id: "stage-1",
      stage_number: 1,
      payment_provider_ref: "pi_test_deposit",
      settlement_state: "refunded",
      total_refunded_pennies: 700000,
    });
    const balance = settledStage({
      id: "stage-2",
      stage_number: 2,
      payment_provider_ref: "pi_test_balance",
    });

    const stages: Record<string, StageRow> = {
      [deposit.id]: deposit,
      [balance.id]: balance,
    };
    const supabase = buildSupabaseStub(stages);
    const stripe = buildStripeStub({
      pi_test_deposit: 700000,
      pi_test_balance: 700000,
    });
    const deps: RefundDeps = { supabase: supabase.client, stripe: stripe.stripe };

    const eligibility = await getStageRefundEligibility(balance.job_id, balance.stage_number, deps);

    expect(eligibility.eligible).toBe(true);
    if (eligibility.eligible) expect(eligibility.maxRefundablePennies).toBe(700000);
  });
});

describe("the stage refund surface", () => {
  it("the server actions are exported", async () => {
    const mod = await import("@/app/jobs/[id]/refund-actions");
    expect(mod.checkStageRefundEligibility).toBeDefined();
    expect(mod.processStageRefund).toBeDefined();
  });

  it("the migration exists and adds refund tracking columns", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");

    const migrationsDir = path.join(process.cwd(), "supabase/migrations");
    const files = fs.readdirSync(migrationsDir);
    const migrationFile = files.find((f) => f.includes("payment_stages_refund"));

    expect(migrationFile, "Migration file for payment_stages refund tracking should exist").toBeDefined();

    const content = fs.readFileSync(
      path.join(migrationsDir, migrationFile!),
      "utf-8"
    );

    expect(content).toMatch(/alter table.*payment_stages/i);
    expect(content).toMatch(/payment_provider_ref/i);
    expect(content).toMatch(/settlement_state/i);
    expect(content).toMatch(/total_refunded_pennies/i);
  });
});
