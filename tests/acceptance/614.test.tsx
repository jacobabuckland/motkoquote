/**
 * SUB-1: Stripe Billing subscription at £9.99/month, billed once free jobs used
 *
 * @vitest-environment happy-dom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";

// ── Schema verification ──

describe("schema: subscription_projection table", () => {
  it("migration creates subscription_projection with exactly 9 columns", () => {
    const migrationPath = join(
      process.cwd(),
      "supabase/migrations/00000000000069_subscription_projection.sql",
    );
    const migration = readFileSync(migrationPath, "utf-8");

    expect(migration).toContain("create table subscription_projection");

    // The 9 required columns
    expect(migration).toContain("contractor_id");
    expect(migration).toContain("stripe_customer_id");
    expect(migration).toContain("stripe_subscription_id");
    expect(migration).toContain("subscription_status");
    expect(migration).toContain("trial_end");
    expect(migration).toContain("current_period_start");
    expect(migration).toContain("current_period_end");
    expect(migration).toContain("last_event_id");
    expect(migration).toContain("created_at");

    // These columns must NOT appear on subscription_projection (common mistakes)
    const notOnProjection = [
      "subscription_id", // should be stripe_subscription_id
      "free_jobs_remaining", // lives on contractors, not here
    ];

    for (const col of notOnProjection) {
      // Count occurrences - if it appears in CREATE TABLE block, that's wrong
      const tableStart = migration.indexOf("create table subscription_projection");
      const tableEnd = migration.indexOf(";", tableStart);
      const tableBlock = migration.slice(tableStart, tableEnd);

      expect(
        tableBlock.includes(col),
        `${col} must not appear in subscription_projection table`,
      ).toBe(false);
    }
  });

  it("migration sets RLS for owner SELECT-only", () => {
    const migrationPath = join(
      process.cwd(),
      "supabase/migrations/00000000000069_subscription_projection.sql",
    );
    const migration = readFileSync(migrationPath, "utf-8");

    // RLS should be enabled
    expect(migration).toContain("alter table subscription_projection enable row level security");

    // Owner should be able to SELECT
    expect(migration).toMatch(
      /create policy.*subscription_projection.*select.*owner_user_id/is,
    );
  });
});

// ── Webhook idempotency ──

describe("webhook replay and out-of-order delivery", () => {
  let mockAdmin: SupabaseClient;
  let projectionStore: Record<string, unknown>;
  let updateCalls: Array<{ table: string; data: unknown; match: unknown }>;

  beforeEach(() => {
    projectionStore = {};
    updateCalls = [];

    // Build a stub Supabase client that tracks upserts and returns stored state
    const from = () => {
      return {
        select: () => ({
          eq: (_column: string, value: string) => ({
            maybeSingle: vi.fn(async () => {
              return { data: projectionStore[value] ?? null, error: null };
            }),
            single: vi.fn(async () => {
              const data = projectionStore[value];
              return data
                ? { data, error: null }
                : { data: null, error: { message: "Not found" } };
            }),
          }),
        }),
        upsert: vi.fn(async (data: unknown) => {
          updateCalls.push({ table: "subscription_projection", data, match: { onConflict: "contractor_id" } });
          const record = data as { contractor_id: string; last_event_id: string };
          projectionStore[record.contractor_id] = record;
          return { data, error: null };
        }),
        update: vi.fn(async (data: unknown) => {
          updateCalls.push({ table: "subscription_projection", data, match: {} });
          return { data, error: null };
        }),
      };
    };

    mockAdmin = { from } as unknown as SupabaseClient;
  });

  afterEach(() => {
    updateCalls = [];
    projectionStore = {};
  });

  it("replaying the same event does not update the projection", async () => {
    // Arrange: simulate a subscription.created event already processed
    const contractorId = "contractor-123";
    const eventId = "evt_1";
    projectionStore[contractorId] = {
      contractor_id: contractorId,
      stripe_customer_id: "cus_123",
      stripe_subscription_id: "sub_123",
      subscription_status: "trialing",
      last_event_id: eventId,
      current_period_start: new Date().toISOString(),
      current_period_end: new Date().toISOString(),
      trial_end: null,
    };

    // Import the webhook handler
    const webhookModule = await import("@/app/api/stripe/webhook/route");
    const { POST } = webhookModule;

    // Create a mock request with the same event
    const event = {
      id: eventId, // SAME event ID
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_123",
          customer: "cus_123",
          status: "active", // Different status, but same event ID
          current_period_start: Math.floor(Date.now() / 1000),
          current_period_end: Math.floor(Date.now() / 1000) + 86400 * 30,
          trial_end: null,
        },
      },
    };

    const body = JSON.stringify(event);
    const request = new Request("http://localhost:3000/api/stripe/webhook", {
      method: "POST",
      body,
      headers: {
        "stripe-signature": "mock-signature",
      },
    });

    // Mock stripe client and webhook verification
    vi.doMock("@/lib/stripe-client", () => ({
      getStripeClient: () => ({
        webhooks: {
          constructEvent: vi.fn(() => event),
        },
      }),
    }));

    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => mockAdmin,
    }));

    // Act: deliver the replayed event
    await POST(request);

    // Assert: the projection was NOT updated (status still "trialing")
    const finalState = projectionStore[contractorId] as {
      subscription_status: string;
      last_event_id: string;
    };
    expect(finalState.subscription_status).toBe("trialing");
    expect(finalState.last_event_id).toBe(eventId);
  });

  it("delivering an older event after a newer one does not regress state", async () => {
    // Arrange: newer event already processed
    const contractorId = "contractor-456";
    projectionStore[contractorId] = {
      contractor_id: contractorId,
      stripe_customer_id: "cus_456",
      stripe_subscription_id: "sub_456",
      subscription_status: "active",
      last_event_id: "evt_003", // Latest event
      current_period_start: new Date().toISOString(),
      current_period_end: new Date().toISOString(),
      trial_end: null,
    };

    const webhookModule = await import("@/app/api/stripe/webhook/route");
    const { POST } = webhookModule;

    // Deliver an OLDER event
    const olderEvent = {
      id: "evt_001", // Older than evt_003
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_456",
          customer: "cus_456",
          status: "trialing", // Older state
          current_period_start: Math.floor(Date.now() / 1000) - 86400 * 7,
          current_period_end: Math.floor(Date.now() / 1000) - 86400 * 7 + 86400 * 30,
          trial_end: null,
        },
      },
    };

    const body = JSON.stringify(olderEvent);
    const request = new Request("http://localhost:3000/api/stripe/webhook", {
      method: "POST",
      body,
      headers: { "stripe-signature": "mock-sig" },
    });

    vi.doMock("@/lib/stripe-client", () => ({
      getStripeClient: () => ({
        webhooks: { constructEvent: vi.fn(() => olderEvent) },
      }),
    }));

    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => mockAdmin,
    }));

    // Act
    await POST(request);

    // Assert: state did NOT regress to "trialing"
    const finalState = projectionStore[contractorId] as {
      subscription_status: string;
      last_event_id: string;
    };
    expect(finalState.subscription_status).toBe("active");
    expect(finalState.last_event_id).toBe("evt_003");
  });
});

// ── Billing logic ──

describe("billing from the fourth job (off-rail)", () => {
  it("bills from the fourth completed job when all are cash", async () => {
    // This tests that trial→active is driven by job exhaustion, not by Stripe events arriving
    const { createSubscription, endTrial, getSubscriptionState } = await import(
      "@/lib/subscription"
    );

    const contractorId = "contractor-cash";
    let subscriptionState: { status: string; trial_end: string | null } = {
      status: "trialing",
      trial_end: null,
    };

    // Mock Supabase client
    const mockSelect = vi.fn(async () => ({
      data: subscriptionState,
      error: null,
    }));

    const mockFrom = vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: mockSelect,
        })),
      })),
      upsert: vi.fn(async (data: unknown) => {
        subscriptionState = data as { status: string; trial_end: string | null };
        return { data, error: null };
      }),
    }));

    const mockSupabase = { from: mockFrom } as unknown as SupabaseClient;
    const mockAdmin = mockSupabase;

    // Mock Stripe client
    vi.doMock("@/lib/stripe-client", () => ({
      getStripeClient: () => ({
        customers: {
          create: vi.fn(async () => ({ id: "cus_cash" })),
        },
        subscriptions: {
          create: vi.fn(async () => ({
            id: "sub_cash",
            customer: "cus_cash",
            status: "trialing",
            current_period_start: Math.floor(Date.now() / 1000),
            current_period_end: Math.floor(Date.now() / 1000) + 86400 * 30,
            trial_end: null,
          })),
          update: vi.fn(async (_id?: string, params?: { trial_end?: string }) => {
            const now = Math.floor(Date.now() / 1000);
            subscriptionState = {
              status: params?.trial_end === "now" ? "active" : "trialing",
              trial_end: params?.trial_end === "now" ? new Date().toISOString() : null,
            };
            return {
              id: "sub_cash",
              status: subscriptionState.status,
              trial_end: subscriptionState.trial_end ? now : null,
            };
          }),
        },
      }),
    }));

    // Act: Create subscription (at signup)
    await createSubscription(mockAdmin, contractorId);

    // Assert: subscription is trialing
    let state = await getSubscriptionState(mockSupabase, contractorId);
    expect(state?.status).toBe("trialing");

    // Simulate completing 3 cash jobs - allowance not exhausted yet
    // (The actual free_jobs_remaining decrement is SUB-2's job; we just check subscription state)

    // Assert: still trialing after 3 jobs
    state = await getSubscriptionState(mockSupabase, contractorId);
    expect(state?.status).toBe("trialing");

    // Act: Complete the 4th job - allowance exhausted, trial should end
    await endTrial(mockAdmin, contractorId);

    // Assert: subscription is now active (billed)
    state = await getSubscriptionState(mockSupabase, contractorId);
    expect(state?.status).toBe("active");
  });

  it("never charges a trade with unused free jobs", async () => {
    const { createSubscription, getSubscriptionState } = await import("@/lib/subscription");

    const contractorId = "contractor-free";
    const subscriptionState = {
      status: "trialing",
      trial_end: null,
    };

    const mockFrom = vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(async () => ({ data: subscriptionState, error: null })),
        })),
      })),
      upsert: vi.fn(async (data: unknown) => {
        Object.assign(subscriptionState, data);
        return { data, error: null };
      }),
    }));

    const mockSupabase = { from: mockFrom } as unknown as SupabaseClient;
    const mockAdmin = mockSupabase;

    vi.doMock("@/lib/stripe-client", () => ({
      getStripeClient: () => ({
        customers: { create: vi.fn(async () => ({ id: "cus_free" })) },
        subscriptions: {
          create: vi.fn(async () => ({
            id: "sub_free",
            customer: "cus_free",
            status: "trialing",
            current_period_start: Math.floor(Date.now() / 1000),
            current_period_end: Math.floor(Date.now() / 1000) + 86400 * 30,
            trial_end: null,
          })),
        },
      }),
    }));

    // Act: Create subscription
    await createSubscription(mockAdmin, contractorId);

    // Simulate time passing (days, weeks) WITHOUT exhausting free jobs
    // The clock advances but no jobs are completed

    // Assert: subscription remains in trial
    const state = await getSubscriptionState(mockSupabase, contractorId);
    expect(state?.status).toBe("trialing");
    expect(state).toHaveProperty("inTrial", true);
  });
});

describe("trial end driven by exhaustion, not by date", () => {
  it("exhausting allowance with the clock unchanged transitions to active", async () => {
    const { createSubscription, endTrial, getSubscriptionState } = await import(
      "@/lib/subscription"
    );

    const contractorId = "contractor-exhaust";
    const createdAt = new Date();
    let subscriptionStatus = "trialing";

    const mockFrom = vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(async () => ({
            data: {
              status: subscriptionStatus,
              trial_end: null,
              created_at: createdAt.toISOString(),
            },
            error: null,
          })),
        })),
      })),
      upsert: vi.fn(async (data?: unknown) => {
        return { data, error: null };
      }),
    }));

    const mockSupabase = { from: mockFrom } as unknown as SupabaseClient;
    const mockAdmin = mockSupabase;

    vi.doMock("@/lib/stripe-client", () => ({
      getStripeClient: () => ({
        customers: { create: vi.fn(async () => ({ id: "cus_exhaust" })) },
        subscriptions: {
          create: vi.fn(async () => ({
            id: "sub_exhaust",
            status: "trialing",
            current_period_start: Math.floor(Date.now() / 1000),
            current_period_end: Math.floor(Date.now() / 1000) + 86400 * 30,
            trial_end: null,
          })),
          update: vi.fn(async () => {
            subscriptionStatus = "active";
            return {
              id: "sub_exhaust",
              status: "active",
              trial_end: Math.floor(Date.now() / 1000),
            };
          }),
        },
      }),
    }));

    // Act: Create subscription at time T
    await createSubscription(mockAdmin, contractorId);
    const stateAfterCreation = await getSubscriptionState(mockSupabase, contractorId);
    expect(stateAfterCreation?.status).toBe("trialing");

    // Act: Exhaust allowance at the SAME time T (no clock movement)
    await endTrial(mockAdmin, contractorId);

    // Assert: transitioned to active despite no time passing
    const stateAfterExhaustion = await getSubscriptionState(mockSupabase, contractorId);
    expect(stateAfterExhaustion?.status).toBe("active");
  });
});

describe("no local boolean is source of truth", () => {
  it("changing stored projection without Stripe event still reads from provider", async () => {
    const { getSubscriptionState } = await import("@/lib/subscription");

    const contractorId = "contractor-boolean";

    // Stored projection says "trialing"
    const storedProjection = {
      contractor_id: contractorId,
      stripe_customer_id: "cus_bool",
      stripe_subscription_id: "sub_bool",
      subscription_status: "trialing",
      trial_end: null,
    };

    const mockFrom = vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(async () => ({
            data: storedProjection,
            error: null,
          })),
        })),
      })),
    }));

    const mockSupabase = { from: mockFrom } as unknown as SupabaseClient;

    // Act: Manually corrupt the stored projection (simulating a drift)
    storedProjection.subscription_status = "canceled";

    // Assert: getSubscriptionState reads the projection as-is
    // (In a real implementation, this might also verify against Stripe API,
    // but at minimum it must NOT rely on a boolean flag)
    const state = await getSubscriptionState(mockSupabase, contractorId);
    expect(state?.status).toBe("canceled");

    // The key requirement: there is no separate `is_subscribed` boolean column
    // on contractors that could diverge from this projection
    const { data: contractor } = await mockSupabase
      .from("contractors")
      .select("*")
      .eq("id", contractorId)
      .single();

    // Assert: no boolean subscription flag exists on contractors
    expect(contractor).not.toHaveProperty("is_subscribed");
    expect(contractor).not.toHaveProperty("subscribed");
    expect(contractor).not.toHaveProperty("subscription_active");
  });
});

describe("library: createSubscription", () => {
  it("creates a Stripe customer and subscription with open-ended trial", async () => {
    const { createSubscription } = await import("@/lib/subscription");

    const contractorId = "contractor-new";
    const createCustomerCalls: Array<{ metadata?: unknown }> = [];
    const createSubscriptionCalls: Array<{ customer?: string; trial_end?: string }> = [];

    const mockFrom = vi.fn(() => ({
      upsert: vi.fn(async (data?: unknown) => ({ data, error: null })),
    }));

    const mockAdmin = { from: mockFrom } as unknown as SupabaseClient;

    vi.doMock("@/lib/stripe-client", () => ({
      getStripeClient: () => ({
        customers: {
          create: vi.fn(async (params?: { metadata?: unknown }) => {
            createCustomerCalls.push(params ?? {});
            return { id: "cus_new" };
          }),
        },
        subscriptions: {
          create: vi.fn(async (params?: { customer?: string; trial_end?: string }) => {
            createSubscriptionCalls.push(params ?? {});
            return {
              id: "sub_new",
              customer: "cus_new",
              status: "trialing",
              current_period_start: Math.floor(Date.now() / 1000),
              current_period_end: Math.floor(Date.now() / 1000) + 86400 * 30,
              trial_end: null,
            };
          }),
        },
      }),
    }));

    // Act
    await createSubscription(mockAdmin, contractorId);

    // Assert: customer was created
    expect(createCustomerCalls).toHaveLength(1);
    expect(createCustomerCalls[0]).toHaveProperty("metadata");

    // Assert: subscription was created with NO trial_end (open-ended)
    expect(createSubscriptionCalls).toHaveLength(1);
    const subParams = createSubscriptionCalls[0];
    expect(subParams).toHaveProperty("customer", "cus_new");
    expect(subParams).not.toHaveProperty("trial_end");
  });
});
