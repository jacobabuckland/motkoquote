/**
 * @vitest-environment happy-dom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { SupabaseClient } from "@supabase/supabase-js";

describe("CONN-5: Pay by Bank capability request and gating", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(cleanup);

  it("createConnectedAccount requests both transfers and pay_by_bank_payments", async () => {
    const accountsCreateSpy = vi.fn(async () => ({
      id: "acct_test123",
    }));

    const mockStripe = {
      accounts: {
        create: accountsCreateSpy,
      },
    };

    vi.doMock("@/lib/stripe", () => ({
      stripe: mockStripe,
    }));

    const { client: supabaseClient } = mockSupabaseClient([
      { stripe_account_id: null },
    ]);

    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => supabaseClient,
    }));

    const { createConnectedAccount } = await import("@/lib/stripe-connect");
    await createConnectedAccount("contractor_1");

    expect(accountsCreateSpy).toHaveBeenCalledWith({
      type: "express",
      capabilities: {
        transfers: { requested: true },
        pay_by_bank_payments: { requested: true },
      },
      settings: {
        payouts: {
          schedule: {
            interval: "daily",
          },
        },
      },
    });
  });

  it("refreshAccountStatus stores both capabilities independently — transfers active, pay_by_bank inactive", async () => {
    const mockStripe = {
      accounts: {
        retrieve: vi.fn(async () => ({
          id: "acct_test123",
          capabilities: {
            transfers: "active",
            pay_by_bank_payments: "inactive",
          },
          requirements: {
            currently_due: [],
          },
        })),
        listExternalAccounts: vi.fn(async () => ({ data: [] })),
      },
    };

    vi.doMock("@/lib/stripe", () => ({
      stripe: mockStripe,
    }));

    const { client: supabaseClient, getUpdates } = mockSupabaseClient([
      { payout_details_complete: false },
    ]);

    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => supabaseClient,
    }));

    const { refreshAccountStatus } = await import("@/lib/stripe-connect");
    await refreshAccountStatus("acct_test123");

    const updates = getUpdates();
    expect(updates).toHaveLength(1);
    const updatePayload = updates[0] as Record<string, unknown>;
    expect(updatePayload.stripe_payouts_enabled).toBe(true);
    expect(updatePayload.stripe_pay_by_bank_enabled).toBe(false);
  });

  it("refreshAccountStatus stores both capabilities independently — both active", async () => {
    const mockStripe = {
      accounts: {
        retrieve: vi.fn(async () => ({
          id: "acct_test123",
          capabilities: {
            transfers: "active",
            pay_by_bank_payments: "active",
          },
          requirements: {
            currently_due: [],
          },
        })),
        listExternalAccounts: vi.fn(async () => ({ data: [] })),
      },
    };

    vi.doMock("@/lib/stripe", () => ({
      stripe: mockStripe,
    }));

    const { client: supabaseClient, getUpdates } = mockSupabaseClient([
      { payout_details_complete: false },
    ]);

    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => supabaseClient,
    }));

    const { refreshAccountStatus } = await import("@/lib/stripe-connect");
    await refreshAccountStatus("acct_test123");

    const updates = getUpdates();
    expect(updates).toHaveLength(1);
    const updatePayload = updates[0] as Record<string, unknown>;
    expect(updatePayload.stripe_payouts_enabled).toBe(true);
    expect(updatePayload.stripe_pay_by_bank_enabled).toBe(true);
  });

  it("refreshAccountStatus stores both capabilities independently — pay_by_bank active, transfers inactive", async () => {
    const mockStripe = {
      accounts: {
        retrieve: vi.fn(async () => ({
          id: "acct_test123",
          capabilities: {
            transfers: "inactive",
            pay_by_bank_payments: "active",
          },
          requirements: {
            currently_due: [],
          },
        })),
        listExternalAccounts: vi.fn(async () => ({ data: [] })),
      },
    };

    vi.doMock("@/lib/stripe", () => ({
      stripe: mockStripe,
    }));

    const { client: supabaseClient, getUpdates } = mockSupabaseClient([
      { payout_details_complete: false },
    ]);

    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => supabaseClient,
    }));

    const { refreshAccountStatus } = await import("@/lib/stripe-connect");
    await refreshAccountStatus("acct_test123");

    const updates = getUpdates();
    expect(updates).toHaveLength(1);
    const updatePayload = updates[0] as Record<string, unknown>;
    expect(updatePayload.stripe_payouts_enabled).toBe(false);
    expect(updatePayload.stripe_pay_by_bank_enabled).toBe(true);
  });

  it("canAcceptStripePayment returns false when pay_by_bank_enabled is false, even if payouts_enabled is true", async () => {
    const { canAcceptStripePayment } = await import("@/lib/stripe-connect");

    const contractor = {
      stripe_account_id: "acct_test123",
      stripe_payouts_enabled: true,
      stripe_pay_by_bank_enabled: false,
    };

    expect(canAcceptStripePayment(contractor)).toBe(false);
  });

  it("canAcceptStripePayment returns true when pay_by_bank_enabled is true with account_id, even if payouts_enabled is false", async () => {
    const { canAcceptStripePayment } = await import("@/lib/stripe-connect");

    const contractor = {
      stripe_account_id: "acct_test123",
      stripe_payouts_enabled: false,
      stripe_pay_by_bank_enabled: true,
    };

    expect(canAcceptStripePayment(contractor)).toBe(true);
  });

  it("canAcceptStripePayment returns true when both are true", async () => {
    const { canAcceptStripePayment } = await import("@/lib/stripe-connect");

    const contractor = {
      stripe_account_id: "acct_test123",
      stripe_payouts_enabled: true,
      stripe_pay_by_bank_enabled: true,
    };

    expect(canAcceptStripePayment(contractor)).toBe(true);
  });

  it("canAcceptStripePayment returns false when stripe_account_id is null, regardless of capabilities", async () => {
    const { canAcceptStripePayment } = await import("@/lib/stripe-connect");

    const contractor = {
      stripe_account_id: null,
      stripe_payouts_enabled: true,
      stripe_pay_by_bank_enabled: true,
    };

    expect(canAcceptStripePayment(contractor)).toBe(false);
  });

  it("StripeConnectSection shows affirmative only when pay_by_bank_enabled is true", async () => {
    const { StripeConnectSection } = await import(
      "@/app/settings/stripe-connect-section"
    );

    // Complete onboarding but pay_by_bank not enabled
    render(
      <StripeConnectSection
        stripeAccountId="acct_test123"
        stripePayoutsEnabled={true}
        stripePayByBankEnabled={false}
        stripeRequirementsDue={false}
      />
    );

    expect(
      screen.queryByText(/Set up ✓ — you can take payments/i)
    ).toBeNull();

    cleanup();

    // Both capabilities enabled
    render(
      <StripeConnectSection
        stripeAccountId="acct_test123"
        stripePayoutsEnabled={true}
        stripePayByBankEnabled={true}
        stripeRequirementsDue={false}
      />
    );

    expect(
      screen.getByText(/Set up ✓ — you can take payments/i)
    ).toBeDefined();
  });

  it("StripeConnectSection does not show affirmative when requirements are due, even if pay_by_bank_enabled is true", async () => {
    const { StripeConnectSection } = await import(
      "@/app/settings/stripe-connect-section"
    );

    render(
      <StripeConnectSection
        stripeAccountId="acct_test123"
        stripePayoutsEnabled={true}
        stripePayByBankEnabled={true}
        stripeRequirementsDue={true}
      />
    );

    expect(
      screen.queryByText(/Set up ✓ — you can take payments/i)
    ).toBeNull();
    expect(screen.getByText(/Action required/i)).toBeDefined();
  });
});

// Minimal Supabase stub for acceptance tests
function mockSupabaseClient<T = unknown>(rows: T[]) {
  const updates: unknown[] = [];

  const mockFrom = vi.fn(() => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        single: vi.fn(() => Promise.resolve({ data: rows[0] ?? null, error: null })),
      })),
    })),
    update: vi.fn((payload: unknown) => {
      updates.push(payload);
      return {
        eq: vi.fn(() => Promise.resolve({ data: null, error: null })),
      };
    }),
  }));

  return {
    client: { from: mockFrom } as unknown as SupabaseClient,
    from: mockFrom,
    update: vi.fn(),
    getUpdates: () => updates,
  };
}
