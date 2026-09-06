import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// Mock dependencies before importing the module under test
vi.mock("@/lib/stripe-client", () => ({
  getStripeClient: vi.fn(),
}));

describe("subscription module", () => {
  let mockAdmin: SupabaseClient;
  let mockStripe: {
    customers: { create: ReturnType<typeof vi.fn> };
    subscriptions: {
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
  };
  let upsertCalls: Array<{ table: string; data: unknown }>;
  let updateCalls: Array<{ table: string; data: unknown; match: unknown }>;

  beforeEach(async () => {
    upsertCalls = [];
    updateCalls = [];

    // Setup mock Stripe client
    mockStripe = {
      customers: {
        create: vi.fn(async () => ({ id: "cus_test123" })),
      },
      subscriptions: {
        create: vi.fn(async () => ({
          id: "sub_test123",
          customer: "cus_test123",
          status: "trialing",
          current_period_start: Math.floor(Date.now() / 1000),
          current_period_end: Math.floor(Date.now() / 1000) + 86400 * 30,
          trial_end: null,
        })),
        update: vi.fn(async () => ({
          id: "sub_test123",
          status: "active",
          trial_end: Math.floor(Date.now() / 1000),
        })),
      },
    };

    // Setup mock Supabase client
    const mockFrom = vi.fn((table: string) => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(async () => ({
            data:
              table === "subscription_projection"
                ? {
                    subscription_status: "trialing",
                    trial_end: null,
                  }
                : { stripe_subscription_id: "sub_test123" },
            error: null,
          })),
        })),
      })),
      upsert: vi.fn(async (data: unknown) => {
        upsertCalls.push({ table, data });
        return { data, error: null };
      }),
      update: vi.fn((data: unknown) => {
        const eq = vi.fn(() => ({ error: null }));
        updateCalls.push({ table, data, match: {} });
        return { eq };
      }),
    }));

    mockAdmin = { from: mockFrom } as unknown as SupabaseClient;

    // Setup mocks
    const { getStripeClient } = await import("@/lib/stripe-client");
    vi.mocked(getStripeClient).mockReturnValue(mockStripe as never);
  });

  afterEach(() => {
    vi.clearAllMocks();
    upsertCalls = [];
    updateCalls = [];
  });

  describe("createSubscription", () => {
    it("creates a Stripe customer and subscription", async () => {
      const { createSubscription } = await import("@/lib/subscription");

      await createSubscription(mockAdmin, "contractor-123");

      // Assert customer was created
      expect(mockStripe.customers.create).toHaveBeenCalledWith({
        metadata: { contractor_id: "contractor-123" },
      });

      // Assert subscription was created
      expect(mockStripe.subscriptions.create).toHaveBeenCalledWith({
        customer: "cus_test123",
        items: [{ price: expect.any(String) }],
        trial_settings: {
          end_behavior: { missing_payment_method: "pause" },
        },
      });
    });

    it("writes initial projection to database", async () => {
      const { createSubscription } = await import("@/lib/subscription");

      await createSubscription(mockAdmin, "contractor-123");

      const projectionUpsert = upsertCalls.find(
        (call) => call.table === "subscription_projection",
      );
      expect(projectionUpsert).toBeDefined();
      expect(projectionUpsert?.data).toMatchObject({
        contractor_id: "contractor-123",
        stripe_customer_id: "cus_test123",
        stripe_subscription_id: "sub_test123",
        subscription_status: "trialing",
        trial_end: null,
      });
    });

    it("stores customer ID on contractor row", async () => {
      const { createSubscription } = await import("@/lib/subscription");

      await createSubscription(mockAdmin, "contractor-123");

      const contractorUpdate = updateCalls.find((call) => call.table === "contractors");
      expect(contractorUpdate).toBeDefined();
      expect(contractorUpdate?.data).toEqual({
        stripe_customer_id: "cus_test123",
      });
    });
  });

  describe("getSubscriptionState", () => {
    it("returns subscription state with inTrial flag", async () => {
      const { getSubscriptionState } = await import("@/lib/subscription");

      const state = await getSubscriptionState(mockAdmin, "contractor-123");

      expect(state).toEqual({
        status: "trialing",
        inTrial: true,
      });
    });

    it("returns null when no subscription exists", async () => {
      const mockFromNoData = vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn(async () => ({
              data: null,
              error: { message: "Not found" },
            })),
          })),
        })),
      }));

      const mockSupabaseNoData = {
        from: mockFromNoData,
      } as unknown as SupabaseClient;

      const { getSubscriptionState } = await import("@/lib/subscription");

      const state = await getSubscriptionState(mockSupabaseNoData, "contractor-123");

      expect(state).toBeNull();
    });
  });

  describe("endTrial", () => {
    it("updates Stripe subscription to end trial immediately", async () => {
      const { endTrial } = await import("@/lib/subscription");

      await endTrial(mockAdmin, "contractor-123");

      expect(mockStripe.subscriptions.update).toHaveBeenCalledWith("sub_test123", {
        trial_end: "now",
      });
    });

    it("throws when no subscription exists", async () => {
      const mockFromNoSub = vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn(async () => ({
              data: null,
              error: { message: "Not found" },
            })),
          })),
        })),
      }));

      const mockAdminNoSub = {
        from: mockFromNoSub,
      } as unknown as SupabaseClient;

      const { endTrial } = await import("@/lib/subscription");

      await expect(endTrial(mockAdminNoSub, "contractor-123")).rejects.toThrow(
        "No subscription found",
      );
    });
  });
});
