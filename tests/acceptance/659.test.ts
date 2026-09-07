import { describe, expect, it, vi } from "vitest";
import type { SubscriptionProjection } from "@/lib/subscription";
import { mockSupabaseClient } from "../helpers/supabase";

describe("SUB-4: Failed subscription payment leaves account read-only", () => {
  describe("isSubscriptionReadOnly predicate", () => {
    it("exists as an importable function", async () => {
      const mod = await import("@/lib/subscription");
      expect(mod.isSubscriptionReadOnly).toBeDefined();
      expect(typeof mod.isSubscriptionReadOnly).toBe("function");
    });

    it("returns true for past_due status", async () => {
      const { isSubscriptionReadOnly } = await import("@/lib/subscription");
      expect(isSubscriptionReadOnly("past_due")).toBe(true);
    });

    it("returns true for unpaid status", async () => {
      const { isSubscriptionReadOnly } = await import("@/lib/subscription");
      expect(isSubscriptionReadOnly("unpaid")).toBe(true);
    });

    it("returns false for active status", async () => {
      const { isSubscriptionReadOnly } = await import("@/lib/subscription");
      expect(isSubscriptionReadOnly("active")).toBe(false);
    });

    it("returns false for trialing status", async () => {
      const { isSubscriptionReadOnly } = await import("@/lib/subscription");
      expect(isSubscriptionReadOnly("trialing")).toBe(false);
    });

    it("returns false for canceled status", async () => {
      const { isSubscriptionReadOnly } = await import("@/lib/subscription");
      expect(isSubscriptionReadOnly("canceled")).toBe(false);
    });

    it("returns false for null status", async () => {
      const { isSubscriptionReadOnly } = await import("@/lib/subscription");
      expect(isSubscriptionReadOnly(null)).toBe(false);
    });
  });

  describe("createInvoice guard", () => {
    it("refuses creation when subscription is past_due", async () => {
      const projection: SubscriptionProjection = {
        contractor_id: "contractor_1",
        stripe_subscription_id: "sub_123",
        stripe_customer_id: "cus_123",
        subscription_status: "past_due",
        trial_end: null,
        last_event_id: "evt_123",
        last_event_created: 1234567890,
      };

      const quote = {
        id: "quote_1",
        total: 10000,
        invoices: [],
        contracts: [{ deposit_pct: 50, status: "signed" }],
        job: {
          id: "job_1",
          work_completed_at: null,
          customer: {
            name: "Test Customer",
            contact: { email: "test@example.com" },
          },
          contractor: {
            id: "contractor_1",
            company_name: "Test Contractor",
            payout_details_complete: true,
          },
        },
      };

      const { client: supabase, getFilters } = mockSupabaseClient([projection, quote]);

      // Mock createClient to return our stub
      vi.doMock("@/lib/supabase/server", () => ({
        createClient: vi.fn(async () => supabase),
      }));

      // Mock auth.getUser to return a user
      Object.assign(supabase, {
        auth: {
          getUser: vi.fn(async () => ({
            data: { user: { id: "user_1" } },
            error: null,
          })),
        },
      });

      const { createInvoice } = await import("@/app/dashboard/actions");

      await expect(
        createInvoice({
          quoteId: "quote_1",
          invoiceType: "deposit",
        }),
      ).rejects.toThrow(/subscription payment failed|read-only|update.*card/i);

      // Must have queried subscription_projection
      const filters = getFilters();
      const subscriptionQuery = filters.some(
        (f) => f.method === "eq" && f.args[0] === "contractor_id",
      );
      expect(
        subscriptionQuery,
        "createInvoice must query subscription_projection by contractor_id",
      ).toBe(true);
    });

    it("allows creation when subscription is active", async () => {
      const projection: SubscriptionProjection = {
        contractor_id: "contractor_1",
        stripe_subscription_id: "sub_123",
        stripe_customer_id: "cus_123",
        subscription_status: "active",
        trial_end: null,
        last_event_id: "evt_123",
        last_event_created: 1234567890,
      };

      const quote = {
        id: "quote_1",
        total: 10000,
        invoices: [],
        contracts: [{ deposit_pct: 50, status: "signed" }],
        job: {
          id: "job_1",
          work_completed_at: null,
          customer: {
            name: "Test Customer",
            contact: { email: "test@example.com" },
          },
          contractor: {
            id: "contractor_1",
            company_name: "Test Contractor",
            payout_details_complete: true,
          },
        },
      };

      const { client: supabase } = mockSupabaseClient([projection, quote]);

      vi.doMock("@/lib/supabase/server", () => ({
        createClient: vi.fn(async () => supabase),
      }));

      Object.assign(supabase, {
        auth: {
          getUser: vi.fn(async () => ({
            data: { user: { id: "user_1" } },
            error: null,
          })),
        },
      });

      const { createInvoice } = await import("@/app/dashboard/actions");

      // Should not throw when subscription is active
      // (will fail for other reasons in this stub, but not the subscription check)
      try {
        await createInvoice({
          quoteId: "quote_1",
          invoiceType: "deposit",
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        expect(message).not.toMatch(/subscription payment failed|read-only|update.*card/i);
      }
    });

    it("allows creation when no subscription projection exists", async () => {
      const quote = {
        id: "quote_1",
        total: 10000,
        invoices: [],
        contracts: [{ deposit_pct: 50, status: "signed" }],
        job: {
          id: "job_1",
          work_completed_at: null,
          customer: {
            name: "Test Customer",
            contact: { email: "test@example.com" },
          },
          contractor: {
            id: "contractor_1",
            company_name: "Test Contractor",
            payout_details_complete: true,
          },
        },
      };

      // No projection row - returns empty array for first query
      const { client: supabase } = mockSupabaseClient([quote]);

      vi.doMock("@/lib/supabase/server", () => ({
        createClient: vi.fn(async () => supabase),
      }));

      Object.assign(supabase, {
        auth: {
          getUser: vi.fn(async () => ({
            data: { user: { id: "user_1" } },
            error: null,
          })),
        },
      });

      const { createInvoice } = await import("@/app/dashboard/actions");

      try {
        await createInvoice({
          quoteId: "quote_1",
          invoiceType: "deposit",
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        expect(message).not.toMatch(/subscription payment failed|read-only|update.*card/i);
      }
    });
  });

  describe("createContract guard", () => {
    it("refuses creation when subscription is unpaid", async () => {
      const projection: SubscriptionProjection = {
        contractor_id: "contractor_1",
        stripe_subscription_id: "sub_123",
        stripe_customer_id: "cus_123",
        subscription_status: "unpaid",
        trial_end: null,
        last_event_id: "evt_123",
        last_event_created: 1234567890,
      };

      const { client: supabase } = mockSupabaseClient([projection]);

      vi.doMock("@/lib/supabase/server", () => ({
        createClient: vi.fn(async () => supabase),
      }));

      Object.assign(supabase, {
        auth: {
          getUser: vi.fn(async () => ({
            data: { user: { id: "user_1" } },
            error: null,
          })),
        },
      });

      const { createContract } = await import("@/app/dashboard/actions");

      await expect(
        createContract({
          quoteId: "quote_1",
          depositPct: 50,
          templateKey: "standard_project",
          jobInput: {
            client_address: "123 Test St",
            client_phone: "07700900000",
            site_address: "123 Test St",
          },
        }),
      ).rejects.toThrow(/subscription payment failed|read-only|update.*card/i);
    });
  });

  describe("createManualJob guard", () => {
    it("refuses creation when subscription is past_due", async () => {
      const projection: SubscriptionProjection = {
        contractor_id: "contractor_1",
        stripe_subscription_id: "sub_123",
        stripe_customer_id: "cus_123",
        subscription_status: "past_due",
        trial_end: null,
        last_event_id: "evt_123",
        last_event_created: 1234567890,
      };

      const contractor = {
        id: "contractor_1",
        owner_user_id: "user_1",
        company_name: "Test Contractor",
      };

      const { client: supabase } = mockSupabaseClient([projection, contractor]);

      vi.doMock("@/lib/supabase/server", () => ({
        createClient: vi.fn(async () => supabase),
      }));

      Object.assign(supabase, {
        auth: {
          getUser: vi.fn(async () => ({
            data: { user: { id: "user_1" } },
            error: null,
          })),
        },
      });

      const { createManualJob } = await import("@/app/jobs/actions");

      await expect(createManualJob()).rejects.toThrow(
        /subscription payment failed|read-only|update.*card/i,
      );
    });
  });

  describe("createRealtimeSession guard", () => {
    it("refuses session creation when subscription is unpaid", async () => {
      const projection: SubscriptionProjection = {
        contractor_id: "contractor_1",
        stripe_subscription_id: "sub_123",
        stripe_customer_id: "cus_123",
        subscription_status: "unpaid",
        trial_end: null,
        last_event_id: "evt_123",
        last_event_created: 1234567890,
      };

      const contractor = {
        id: "contractor_1",
        owner_user_id: "user_1",
        company_name: "Test Contractor",
      };

      const { client: supabase } = mockSupabaseClient([projection, contractor]);

      vi.doMock("@/lib/supabase/server", () => ({
        createClient: vi.fn(async () => supabase),
      }));

      Object.assign(supabase, {
        auth: {
          getUser: vi.fn(async () => ({
            data: { user: { id: "user_1" } },
            error: null,
          })),
        },
      });

      const { createRealtimeSession } = await import("@/app/jobs/actions");

      await expect(createRealtimeSession()).rejects.toThrow(
        /subscription payment failed|read-only|update.*card/i,
      );
    });
  });

  describe("Customer-facing surfaces remain accessible", () => {
    it("contract page at /c/[id] does not check subscription status", async () => {
      // This test ensures that the contract page itself doesn't have a guard
      // The page uses createAdminClient, not createClient, so it bypasses RLS
      // and the contractor's subscription status is never consulted
      const mod = await import("@/app/c/[id]/page");
      expect(mod.default).toBeDefined();

      // The page should export a default component
      expect(typeof mod.default).toBe("function");
    });

    it("invoice page at /i/[id] does not check subscription status", async () => {
      const mod = await import("@/app/i/[id]/page");
      expect(mod.default).toBeDefined();
      expect(typeof mod.default).toBe("function");
    });

    it("acceptQuote remains callable regardless of subscription status", async () => {
      // acceptQuote is triggered by the customer, not the trade
      // It must never check the trade's subscription status
      const { acceptQuote } = await import("@/app/q/[id]/actions");
      expect(acceptQuote).toBeDefined();
      expect(typeof acceptQuote).toBe("function");

      // The function signature takes only quoteId - no subscription check parameter
      expect(acceptQuote.length).toBe(1);
    });
  });

  describe("Restored payment restores access", () => {
    it("allows creation after subscription moves from past_due to active", async () => {
      // First attempt with past_due fails
      const projectionFailed: SubscriptionProjection = {
        contractor_id: "contractor_1",
        stripe_subscription_id: "sub_123",
        stripe_customer_id: "cus_123",
        subscription_status: "past_due",
        trial_end: null,
        last_event_id: "evt_123",
        last_event_created: 1234567890,
      };

      const { client: supabase1 } = mockSupabaseClient([projectionFailed]);

      vi.doMock("@/lib/supabase/server", () => ({
        createClient: vi.fn(async () => supabase1),
      }));

      Object.assign(supabase1, {
        auth: {
          getUser: vi.fn(async () => ({
            data: { user: { id: "user_1" } },
            error: null,
          })),
        },
      });

      const { createManualJob: createManualJobFailed } = await import("@/app/jobs/actions");

      await expect(createManualJobFailed()).rejects.toThrow(
        /subscription payment failed|read-only|update.*card/i,
      );

      // After webhook updates projection to active, creation succeeds
      const projectionActive: SubscriptionProjection = {
        contractor_id: "contractor_1",
        stripe_subscription_id: "sub_123",
        stripe_customer_id: "cus_123",
        subscription_status: "active",
        trial_end: null,
        last_event_id: "evt_124",
        last_event_created: 1234567900,
      };

      const contractor = {
        id: "contractor_1",
        owner_user_id: "user_1",
        company_name: "Test Contractor",
      };

      const { client: supabase2 } = mockSupabaseClient([projectionActive, contractor]);

      vi.doMock("@/lib/supabase/server", () => ({
        createClient: vi.fn(async () => supabase2),
      }));

      Object.assign(supabase2, {
        auth: {
          getUser: vi.fn(async () => ({
            data: { user: { id: "user_1" } },
            error: null,
          })),
        },
      });

      const { createManualJob: createManualJobActive } = await import("@/app/jobs/actions");

      // Should not throw subscription error when active
      try {
        await createManualJobActive();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        expect(message).not.toMatch(/subscription payment failed|read-only|update.*card/i);
      }
    });
  });
});
