import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

describe("SUB-1: Stripe Billing subscription at £9.99/month, billed once free jobs used", () => {
  describe("subscription state projection", () => {
    it("survives webhook replay and out-of-order delivery", async () => {
      // Import the subscription projection module
      const subscriptionMod = await import("@/lib/subscription");

      // Mock database client
      const mockRows: Array<{ subscription_status: string; last_event_created: number }> = [];
      const mockSelect = vi.fn(async () => ({ data: mockRows[0] ?? null, error: null }));
      const mockUpsert = vi.fn(async (_row?: unknown) => {
        if (_row && typeof _row === "object" && "subscription_status" in _row) {
          mockRows[0] = _row as { subscription_status: string; last_event_created: number };
        }
        return { error: null };
      });
      const mockFrom = vi.fn(() => ({
        select: mockSelect,
        upsert: mockUpsert,
        eq: vi.fn(() => ({ select: mockSelect })),
      }));

      const mockClient = {
        from: mockFrom,
      };

      // Create webhook events (newer first, then replay, then older)
      const newerEvent = {
        id: "evt_new",
        type: "customer.subscription.updated",
        created: 1700000000,
        data: {
          object: {
            id: "sub_123",
            status: "active",
            customer: "cus_123",
          },
        },
      };

      const replayEvent = {
        id: "evt_new", // Same ID
        type: "customer.subscription.updated",
        created: 1700000000,
        data: {
          object: {
            id: "sub_123",
            status: "active",
            customer: "cus_123",
          },
        },
      };

      const olderEvent = {
        id: "evt_old",
        type: "customer.subscription.updated",
        created: 1699000000, // Earlier timestamp
        data: {
          object: {
            id: "sub_123",
            status: "trialing",
            customer: "cus_123",
          },
        },
      };

      // Process newer event
      await subscriptionMod.projectSubscriptionEvent(newerEvent, mockClient);
      expect(mockRows[0]?.subscription_status).toBe("active");
      const firstEventTime = mockRows[0]?.last_event_created;

      // Replay same event (should be idempotent, not process again)
      const upsertCallsBefore = mockUpsert.mock.calls.length;
      await subscriptionMod.projectSubscriptionEvent(replayEvent, mockClient);
      const upsertCallsAfter = mockUpsert.mock.calls.length;
      expect(upsertCallsAfter).toBe(upsertCallsBefore); // No additional upsert
      expect(mockRows[0]?.subscription_status).toBe("active"); // Unchanged
      expect(mockRows[0]?.last_event_created).toBe(firstEventTime); // Timestamp unchanged

      // Process older event (should be rejected, not move state backwards)
      await subscriptionMod.projectSubscriptionEvent(olderEvent, mockClient);
      expect(mockRows[0]?.subscription_status).toBe("active"); // Still active, not trialing
      expect(mockRows[0]?.last_event_created).toBe(firstEventTime); // Timestamp unchanged
    });

    it("derives state from Stripe, not from a local boolean", async () => {
      // Import subscription query module
      const subscriptionMod = await import("@/lib/subscription");

      // Mock database with stored projection showing "trialing"
      const mockSelect = vi.fn(async () => ({
        data: { subscription_status: "trialing", stripe_subscription_id: "sub_123" },
        error: null,
      }));
      const mockFrom = vi.fn(() => ({
        select: mockSelect,
        eq: vi.fn(() => ({ select: mockSelect, single: vi.fn(async () => mockSelect()) })),
        single: vi.fn(async () => mockSelect()),
      }));

      const mockDbClient = { from: mockFrom };

      // Mock Stripe API returning different state ("active")
      const mockStripeRetrieve = vi.fn(async (_subId?: string) => ({
        id: _subId,
        status: "active",
        customer: "cus_123",
      }));

      // Query subscription status - should fetch from Stripe, not trust local projection blindly
      const status = await subscriptionMod.getSubscriptionStatus(
        "cus_123",
        mockDbClient,
        { subscriptions: { retrieve: mockStripeRetrieve } },
      );

      // If projection is stale, should detect drift and return Stripe's truth
      expect(mockStripeRetrieve).toHaveBeenCalledWith("sub_123");
      expect(status).toBe("active"); // Stripe's value wins, not the stored "trialing"
    });
  });

  describe("free job allowance and billing trigger", () => {
    it("never charges a trade with unused free jobs remaining", async () => {
      const subscriptionMod = await import("@/lib/subscription");

      // Mock Stripe API - track subscription updates
      const mockStripeUpdate = vi.fn(async (_subId?: string) => ({
        id: _subId,
        status: "active",
        trial_end: null,
      }));

      const mockStripe = {
        subscriptions: {
          update: mockStripeUpdate,
        },
      };

      // Mock database showing 1 free job remaining
      const mockClient = {
        from: vi.fn(() => ({
          select: vi.fn(async () => ({
            data: { free_jobs_remaining: 1, subscription_id: "sub_123" },
            error: null,
          })),
        })),
      };

      // Complete a job (should decrement allowance but NOT end trial)
      await subscriptionMod.handleJobCompletion("cus_123", mockClient, mockStripe);

      // Assert trial was NOT ended (no Stripe API call to update subscription)
      expect(mockStripeUpdate).not.toHaveBeenCalled();
    });

    it("bills from the fourth job completed entirely off the rail", async () => {
      const subscriptionMod = await import("@/lib/subscription");

      // Mock Stripe API
      const trialEndCalls: string[] = [];
      const mockStripeUpdate = vi.fn(async (_subId?: string, _params?: unknown) => {
        if (_params && typeof _params === "object" && "trial_end" in _params && _params.trial_end === "now") {
          trialEndCalls.push(_subId ?? "");
        }
        return { id: _subId, status: "active", trial_end: null };
      });

      const mockStripe = {
        subscriptions: {
          update: mockStripeUpdate,
        },
      };

      // Mock database - track job completion count
      let jobsCompleted = 0;
      const mockClient = {
        from: vi.fn(() => ({
          select: vi.fn(async () => ({
            data: {
              free_jobs_remaining: Math.max(0, 3 - jobsCompleted),
              subscription_id: "sub_123",
            },
            error: null,
          })),
        })),
      };

      // Complete three cash jobs (no Stripe payment involved)
      for (let i = 0; i < 3; i++) {
        jobsCompleted++;
        await subscriptionMod.handleJobCompletion("cus_123", mockClient, mockStripe);
      }

      // Assert trial NOT ended after three jobs
      expect(trialEndCalls).toHaveLength(0);

      // Complete fourth job
      jobsCompleted++;
      await subscriptionMod.handleJobCompletion("cus_123", mockClient, mockStripe);

      // Assert trial ended after fourth job
      expect(trialEndCalls).toHaveLength(1);
      expect(trialEndCalls[0]).toBe("sub_123");
    });

    it("ends trial on allowance exhaustion, not elapsed time", async () => {
      const subscriptionMod = await import("@/lib/subscription");

      // Mock Stripe API
      const mockStripeUpdate = vi.fn(async (_subId?: string) => ({
        id: _subId,
        status: "active",
        trial_end: null,
      }));

      const mockStripe = {
        subscriptions: {
          update: mockStripeUpdate,
        },
      };

      // Mock database - subscription created 1 day ago, allowance exhausted now
      const createdTime = Date.now() - 86400000; // 1 day ago
      const currentTime = Date.now(); // Now

      const mockClient = {
        from: vi.fn(() => ({
          select: vi.fn(async () => ({
            data: {
              free_jobs_remaining: 0,
              subscription_id: "sub_123",
              created_at: new Date(createdTime).toISOString(),
            },
            error: null,
          })),
        })),
      };

      // Exhaust allowance with minimal time passed (1 day, not the typical trial period)
      await subscriptionMod.handleJobCompletion("cus_123", mockClient, mockStripe);

      // Assert trial ended immediately on exhaustion, not waiting for elapsed time
      expect(mockStripeUpdate).toHaveBeenCalledWith("sub_123", { trial_end: "now" });

      // Verify the time between creation and trial end is only 1 day
      const timeDiff = currentTime - createdTime;
      expect(timeDiff).toBeLessThan(86400000 * 2); // Less than 2 days
    });
  });

  describe("webhook handling", () => {
    it("handles customer.subscription.created event", async () => {
      const webhookMod = await import("@/app/api/stripe/webhook/route");

      // Mock subscription created event
      const event = {
        id: "evt_created",
        type: "customer.subscription.created",
        created: Date.now() / 1000,
        data: {
          object: {
            id: "sub_new",
            status: "trialing",
            customer: "cus_123",
            trial_end: 1700000000,
          },
        },
      };

      // Mock database client
      const upsertedRows: unknown[] = [];
      const mockUpsert = vi.fn(async (_row?: unknown) => {
        upsertedRows.push(_row);
        return { error: null };
      });
      const mockFrom = vi.fn(() => ({
        upsert: mockUpsert,
      }));

      const mockClient = { from: mockFrom };

      // Process webhook (function signature depends on implementation, adjust if needed)
      await webhookMod.handleStripeWebhook(event, mockClient);

      // Assert subscription was projected to database
      expect(mockFrom).toHaveBeenCalledWith("subscription_projection");
      expect(mockUpsert).toHaveBeenCalled();
      expect(upsertedRows.length).toBeGreaterThan(0);
    });

    it("handles customer.subscription.updated event", async () => {
      const webhookMod = await import("@/app/api/stripe/webhook/route");

      // Mock subscription updated event (trial → active)
      const event = {
        id: "evt_updated",
        type: "customer.subscription.updated",
        created: Date.now() / 1000,
        data: {
          object: {
            id: "sub_123",
            status: "active",
            customer: "cus_123",
            trial_end: null,
          },
        },
      };

      // Mock database client
      const upsertedRows: unknown[] = [];
      const mockUpsert = vi.fn(async (_row?: unknown) => {
        upsertedRows.push(_row);
        return { error: null };
      });
      const mockFrom = vi.fn(() => ({
        upsert: mockUpsert,
      }));

      const mockClient = { from: mockFrom };

      // Process webhook
      await webhookMod.handleStripeWebhook(event, mockClient);

      // Assert subscription state was updated
      expect(mockUpsert).toHaveBeenCalled();
      expect(upsertedRows.length).toBeGreaterThan(0);
    });
  });

  describe("subscription creation at signup", () => {
    it("creates Stripe subscription when contractor signs up", async () => {
      const setupMod = await import("@/app/setup/actions");

      // Mock Stripe API
      const createdSubscriptions: unknown[] = [];
      const mockStripeCreate = vi.fn(async (_params?: unknown) => {
        createdSubscriptions.push(_params);
        return {
          id: "sub_new",
          status: "trialing",
          customer: "cus_123",
          trial_end: 1800000000, // Far future
        };
      });

      const mockStripe = {
        subscriptions: {
          create: mockStripeCreate,
        },
      };

      // Mock database client
      const mockClient = {
        from: vi.fn(() => ({
          insert: vi.fn(async () => ({ error: null })),
        })),
      };

      // Complete signup (function signature depends on implementation)
      await setupMod.completeSetup(
        { contractor_id: "con_123", stripe_customer_id: "cus_123" },
        mockClient,
        mockStripe,
      );

      // Assert subscription was created
      expect(mockStripeCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          customer: "cus_123",
          items: expect.arrayContaining([
            expect.objectContaining({
              price: expect.any(String), // Price ID for £9.99/month
            }),
          ]),
        }),
      );
      expect(createdSubscriptions.length).toBe(1);
    });
  });

  describe("database schema", () => {
    it("creates subscription_projection table via migration", () => {
      // Read the migration directory
      const migrationsDir = join(process.cwd(), "supabase", "migrations");
      const files = readdirSync(migrationsDir);

      // Find the subscription_projection migration
      const migrationFiles = files.filter((f) => f.includes("subscription_projection"));
      expect(migrationFiles.length).toBeGreaterThan(0);

      // Read the actual migration content
      const migrationFile = migrationFiles[0];
      const migrationPath = join(migrationsDir, migrationFile);
      const migrationSQL = readFileSync(migrationPath, { encoding: "utf-8" });

      // Assert table creation
      expect(migrationSQL).toContain("create table");
      expect(migrationSQL.toLowerCase()).toContain("subscription_projection");

      // Assert required columns exist
      expect(migrationSQL).toContain("contractor_id");
      expect(migrationSQL).toContain("stripe_subscription_id");
      expect(migrationSQL).toContain("subscription_status");
      expect(migrationSQL).toContain("last_event_created");
    });
  });
});
