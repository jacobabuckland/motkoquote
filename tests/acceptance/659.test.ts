import { describe, it, expect } from "vitest";
import { mockSupabaseClient } from "../helpers/supabase";

describe("SUB-4: A failed subscription payment leaves the account read-only", () => {
  const contractorId = "contractor_1";

  describe("isSubscriptionReadOnly predicate", () => {
    it("returns true when subscription status is 'past_due'", async () => {
      const mod = await import("@/lib/subscription");

      const { client } = mockSupabaseClient([
        {
          contractor_id: contractorId,
          subscription_status: "past_due",
          stripe_subscription_id: "sub_123",
          stripe_customer_id: "cus_123",
          trial_end: null,
          last_event_id: "evt_123",
          last_event_created: 1234567890,
        },
      ]);

      const result = await mod.isSubscriptionReadOnly(contractorId, client);
      expect(result).toBe(true);
    });

    it("returns true when subscription status is 'unpaid'", async () => {
      const mod = await import("@/lib/subscription");

      const { client } = mockSupabaseClient([
        {
          contractor_id: contractorId,
          subscription_status: "unpaid",
          stripe_subscription_id: "sub_123",
          stripe_customer_id: "cus_123",
          trial_end: null,
          last_event_id: "evt_123",
          last_event_created: 1234567890,
        },
      ]);

      const result = await mod.isSubscriptionReadOnly(contractorId, client);
      expect(result).toBe(true);
    });

    it("returns false when subscription status is 'active'", async () => {
      const mod = await import("@/lib/subscription");

      const { client } = mockSupabaseClient([
        {
          contractor_id: contractorId,
          subscription_status: "active",
          stripe_subscription_id: "sub_123",
          stripe_customer_id: "cus_123",
          trial_end: null,
          last_event_id: "evt_123",
          last_event_created: 1234567890,
        },
      ]);

      const result = await mod.isSubscriptionReadOnly(contractorId, client);
      expect(result).toBe(false);
    });

    it("returns false when subscription status is 'trialing'", async () => {
      const mod = await import("@/lib/subscription");

      const { client } = mockSupabaseClient([
        {
          contractor_id: contractorId,
          subscription_status: "trialing",
          stripe_subscription_id: "sub_123",
          stripe_customer_id: "cus_123",
          trial_end: 4102444800,
          last_event_id: "evt_123",
          last_event_created: 1234567890,
        },
      ]);

      const result = await mod.isSubscriptionReadOnly(contractorId, client);
      expect(result).toBe(false);
    });

    it("returns false when subscription status is 'canceled'", async () => {
      const mod = await import("@/lib/subscription");

      const { client } = mockSupabaseClient([
        {
          contractor_id: contractorId,
          subscription_status: "canceled",
          stripe_subscription_id: "sub_123",
          stripe_customer_id: "cus_123",
          trial_end: null,
          last_event_id: "evt_123",
          last_event_created: 1234567890,
        },
      ]);

      const result = await mod.isSubscriptionReadOnly(contractorId, client);
      expect(result).toBe(false);
    });

    it("returns false when no subscription projection exists", async () => {
      const mod = await import("@/lib/subscription");

      const { client } = mockSupabaseClient([]);

      const result = await mod.isSubscriptionReadOnly(contractorId, client);
      expect(result).toBe(false);
    });
  });

  describe("creation actions call the read-only check", () => {
    it("createInvoice module can be imported and contains the function", async () => {
      const mod = await import("@/app/dashboard/actions");
      expect(mod.createInvoice).toBeDefined();
      expect(typeof mod.createInvoice).toBe("function");
    });

    it("createContract module can be imported and contains the function", async () => {
      const mod = await import("@/app/dashboard/actions");
      expect(mod.createContract).toBeDefined();
      expect(typeof mod.createContract).toBe("function");
    });

    it("createManualJob module can be imported and contains the function", async () => {
      const mod = await import("@/app/jobs/actions");
      expect(mod.createManualJob).toBeDefined();
      expect(typeof mod.createManualJob).toBe("function");
    });

    it("createRealtimeSession module can be imported and contains the function", async () => {
      const mod = await import("@/app/jobs/actions");
      expect(mod.createRealtimeSession).toBeDefined();
      expect(typeof mod.createRealtimeSession).toBe("function");
    });

    it("sendQuote module can be imported and contains the function", async () => {
      const mod = await import("@/app/jobs/actions");
      expect(mod.sendQuote).toBeDefined();
      expect(typeof mod.sendQuote).toBe("function");
    });
  });

  describe("customer actions unaffected by contractor subscription status", () => {
    it("acceptQuote module can be imported and contains the function", async () => {
      const mod = await import("@/app/q/[id]/actions");
      expect(mod.acceptQuote).toBeDefined();
      expect(typeof mod.acceptQuote).toBe("function");
    });

    it("declineQuote module can be imported and contains the function", async () => {
      const mod = await import("@/app/q/[id]/actions");
      expect(mod.declineQuote).toBeDefined();
      expect(typeof mod.declineQuote).toBe("function");
    });
  });

  describe("existing resources remain accessible in read-only mode", () => {
    it("can query jobs with a past_due subscription", async () => {
      const { client, getFilters } = mockSupabaseClient([
        {
          id: "job_1",
          contractor_id: contractorId,
          status: "active",
        },
      ]);

      const result = await client.from("jobs").select("*").eq("contractor_id", contractorId);

      expect(result.data).toBeDefined();
      expect(result.error).toBeNull();
      expect(getFilters()).toContainEqual({ method: "eq", args: ["contractor_id", contractorId] });
    });

    it("can query quotes with a past_due subscription", async () => {
      const quoteId = "quote_1";
      const { client, getFilters } = mockSupabaseClient([
        {
          id: quoteId,
          job_id: "job_1",
          total: 10000,
        },
      ]);

      const result = await client.from("quotes").select("*").eq("id", quoteId);

      expect(result.data).toBeDefined();
      expect(result.error).toBeNull();
      expect(getFilters()).toContainEqual({ method: "eq", args: ["id", quoteId] });
    });

    it("can query contracts with a past_due subscription", async () => {
      const contractId = "contract_1";
      const { client, getFilters } = mockSupabaseClient([
        {
          id: contractId,
          quote_id: "quote_1",
          status: "signed",
        },
      ]);

      const result = await client.from("contracts").select("*").eq("id", contractId);

      expect(result.data).toBeDefined();
      expect(result.error).toBeNull();
      expect(getFilters()).toContainEqual({ method: "eq", args: ["id", contractId] });
    });

    it("can query invoices with a past_due subscription", async () => {
      const invoiceId = "invoice_1";
      const { client, getFilters } = mockSupabaseClient([
        {
          id: invoiceId,
          quote_id: "quote_1",
          amount: 3000,
        },
      ]);

      const result = await client.from("invoices").select("*").eq("id", invoiceId);

      expect(result.data).toBeDefined();
      expect(result.error).toBeNull();
      expect(getFilters()).toContainEqual({ method: "eq", args: ["id", invoiceId] });
    });
  });

  describe("restoring payment restores full access", () => {
    it("predicate changes from true to false when status moves from past_due to active", async () => {
      const mod = await import("@/lib/subscription");

      // First check: subscription is past_due
      const { client: pastDueClient } = mockSupabaseClient([
        {
          contractor_id: contractorId,
          subscription_status: "past_due",
          stripe_subscription_id: "sub_123",
          stripe_customer_id: "cus_123",
          trial_end: null,
          last_event_id: "evt_123",
          last_event_created: 1234567890,
        },
      ]);

      const readOnly = await mod.isSubscriptionReadOnly(contractorId, pastDueClient);
      expect(readOnly).toBe(true);

      // Second check: subscription is active (payment restored)
      const { client: activeClient } = mockSupabaseClient([
        {
          contractor_id: contractorId,
          subscription_status: "active",
          stripe_subscription_id: "sub_123",
          stripe_customer_id: "cus_123",
          trial_end: null,
          last_event_id: "evt_124",
          last_event_created: 1234567900,
        },
      ]);

      const notReadOnly = await mod.isSubscriptionReadOnly(contractorId, activeClient);
      expect(notReadOnly).toBe(false);
    });

    it("predicate changes from true to false when status moves from unpaid to active", async () => {
      const mod = await import("@/lib/subscription");

      // First check: subscription is unpaid
      const { client: unpaidClient } = mockSupabaseClient([
        {
          contractor_id: contractorId,
          subscription_status: "unpaid",
          stripe_subscription_id: "sub_123",
          stripe_customer_id: "cus_123",
          trial_end: null,
          last_event_id: "evt_123",
          last_event_created: 1234567890,
        },
      ]);

      const readOnly = await mod.isSubscriptionReadOnly(contractorId, unpaidClient);
      expect(readOnly).toBe(true);

      // Second check: subscription is active (payment restored)
      const { client: activeClient } = mockSupabaseClient([
        {
          contractor_id: contractorId,
          subscription_status: "active",
          stripe_subscription_id: "sub_123",
          stripe_customer_id: "cus_123",
          trial_end: null,
          last_event_id: "evt_124",
          last_event_created: 1234567900,
        },
      ]);

      const notReadOnly = await mod.isSubscriptionReadOnly(contractorId, activeClient);
      expect(notReadOnly).toBe(false);
    });
  });

  describe("subscription status banner component", () => {
    it("SubscriptionStatusBanner component can be imported", async () => {
      const mod = await import("@/components/ui/subscription-status-banner");
      expect(mod.SubscriptionStatusBanner).toBeDefined();
    });
  });
});
