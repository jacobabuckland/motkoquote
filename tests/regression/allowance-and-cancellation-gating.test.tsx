/**
 * @vitest-environment happy-dom
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type Stripe from "stripe";
import {
  accessRestrictedMessage,
  attachPaymentMethod,
  hasPaymentMethodOnFile,
  isAccessRestricted,
  isSubscriptionReadOnly,
} from "@/lib/subscription";
import { AllowanceSpentPanel } from "@/app/dashboard/allowance-spent-panel";
import { BillingSection } from "@/app/settings/billing-section";

/**
 * The chain between "three free jobs" and "£9.99 a month", and the two places it
 * was broken.
 *
 * ONE: no card was ever collected. There was no SetupIntent, no billing portal
 * and no Checkout session anywhere in the tree, so the third paid job ended the
 * trial, Stripe raised an invoice it could not charge, and the trade was locked
 * out by a message telling them to visit a Settings → Billing that did not
 * exist.
 *
 * TWO: `canceled` was gated nowhere, so a trade who cancelled kept creating
 * quotes, contracts and invoices for free, indefinitely.
 */

afterEach(cleanup);

describe("who is locked out of creating work", () => {
  it("restricts a failed payment, as it always did", () => {
    expect(isAccessRestricted("past_due")).toBe(true);
    expect(isAccessRestricted("unpaid")).toBe(true);
  });

  it("restricts a subscription that has ENDED — the leak this closes", () => {
    expect(isAccessRestricted("canceled")).toBe(true);
  });

  it("leaves a paying or trialing trade alone", () => {
    expect(isAccessRestricted("active")).toBe(false);
    expect(isAccessRestricted("trialing")).toBe(false);
  });

  it("does not restrict someone still inside a period they paid for", () => {
    // They cancelled, but the period they paid for has not ended. Stripe moves
    // them to `canceled` when it actually has.
    expect(isAccessRestricted("cancel_at_period_end")).toBe(false);
  });

  it("NEVER restricts a contractor with no subscription row", () => {
    // Load-bearing. Every contractor predating SUB-1 has no projection row, and
    // locking them out would be far worse than the leak being closed.
    expect(isAccessRestricted(null)).toBe(false);
  });

  it("leaves isSubscriptionReadOnly exactly as tests/acceptance/659 froze it", () => {
    // The widening is a NEW predicate, not an edit to that one. 659 pins
    // `canceled === false` here, and it stays true.
    expect(isSubscriptionReadOnly("canceled")).toBe(false);
    expect(isSubscriptionReadOnly("past_due")).toBe(true);
    expect(isSubscriptionReadOnly("unpaid")).toBe(true);
    expect(isSubscriptionReadOnly(null)).toBe(false);
  });
});

describe("what a restricted trade is told", () => {
  it("does not tell someone who cancelled that their payment failed", () => {
    const message = accessRestrictedMessage("canceled");
    expect(message).not.toMatch(/payment failed/i);
    expect(message).toMatch(/subscription has ended/i);
  });

  it("promises a cancelled trade their existing work is still there", () => {
    expect(accessRestrictedMessage("canceled")).toMatch(/existing work stays available/i);
  });

  it("sends a failed payment to the card, not to the subscription", () => {
    const message = accessRestrictedMessage("past_due");
    expect(message).toMatch(/payment failed/i);
    expect(message).toMatch(/Settings → Billing/);
  });
});

describe("whether motko can actually charge", () => {
  const customerStub = (defaultPaymentMethod: string | null, deleted = false) =>
    ({
      customers: {
        retrieve: vi.fn(async (_id?: string) => ({
          deleted,
          invoice_settings: { default_payment_method: defaultPaymentMethod },
        })),
      },
    }) as unknown as Pick<Stripe, "customers">;

  it("is false when no default payment method is set", async () => {
    expect(await hasPaymentMethodOnFile(customerStub(null), "cus_1")).toBe(false);
  });

  it("is true once one is", async () => {
    expect(await hasPaymentMethodOnFile(customerStub("pm_1"), "cus_1")).toBe(true);
  });

  it("is false for a deleted customer rather than throwing", async () => {
    expect(await hasPaymentMethodOnFile(customerStub("pm_1", true), "cus_1")).toBe(false);
  });

  it("sets the default on BOTH the customer and the subscription", async () => {
    // Setting only the customer leaves an existing subscription still pointing
    // at nothing, which is a past_due nobody can explain.
    const customerUpdate = vi.fn(async (_id?: string, _params?: unknown) => ({}));
    const subscriptionUpdate = vi.fn(async (_id?: string, _params?: unknown) => ({}));
    const stripe = {
      customers: { update: customerUpdate },
      subscriptions: { update: subscriptionUpdate },
    } as unknown as Pick<Stripe, "customers" | "subscriptions">;

    await attachPaymentMethod(stripe, {
      customerId: "cus_1",
      subscriptionId: "sub_1",
      paymentMethodId: "pm_1",
    });

    expect(customerUpdate).toHaveBeenCalledWith("cus_1", {
      invoice_settings: { default_payment_method: "pm_1" },
    });
    expect(subscriptionUpdate).toHaveBeenCalledWith("sub_1", {
      default_payment_method: "pm_1",
    });
  });

  it("skips the subscription when there isn't one yet", async () => {
    const customerUpdate = vi.fn(async (_id?: string, _params?: unknown) => ({}));
    const subscriptionUpdate = vi.fn(async (_id?: string, _params?: unknown) => ({}));
    const stripe = {
      customers: { update: customerUpdate },
      subscriptions: { update: subscriptionUpdate },
    } as unknown as Pick<Stripe, "customers" | "subscriptions">;

    await attachPaymentMethod(stripe, {
      customerId: "cus_1",
      subscriptionId: null,
      paymentMethodId: "pm_1",
    });

    expect(customerUpdate).toHaveBeenCalledTimes(1);
    expect(subscriptionUpdate).not.toHaveBeenCalled();
  });
});

describe("Settings → Billing, the section three lockout messages point at", () => {
  const noop = async () => ({ success: true, url: "https://checkout.stripe.com/x" });

  it("offers to add a card when none is on file", () => {
    render(<BillingSection hasCard={false} hasSubscription onAddCard={noop} />);
    expect(screen.getByRole("button", { name: "Add a card" })).toBeDefined();
  });

  it("offers to replace one when there is", () => {
    render(<BillingSection hasCard hasSubscription onAddCard={noop} />);
    expect(screen.getByRole("button", { name: "Replace card" })).toBeDefined();
  });

  it("says nothing is charged until the free jobs are used", () => {
    // A trade adding a card before their third job must not think they are
    // being billed today.
    render(<BillingSection hasCard={false} hasSubscription onAddCard={noop} />);
    expect(screen.getByText(/nothing is charged until your three free jobs are used/i)).toBeDefined();
  });

  it("does not offer a card when there is no subscription to bill", () => {
    render(<BillingSection hasCard={false} hasSubscription={false} onAddCard={noop} />);
    expect(screen.queryByRole("button", { name: "Add a card" })).toBeNull();
  });

  it("SHOWS the reason when Stripe refuses, rather than swallowing it", async () => {
    const onAddCard = vi.fn(async () => ({
      success: false,
      error: "No such customer: cus_gone",
    }));
    render(<BillingSection hasCard={false} hasSubscription onAddCard={onAddCard} />);

    fireEvent.click(screen.getByRole("button", { name: "Add a card" }));

    await waitFor(() => expect(screen.getByText(/No such customer/)).toBeDefined());
  });
});

describe("the panel shown when the allowance is spent", () => {
  it("says the free jobs are gone and what happens next", () => {
    render(<AllowanceSpentPanel />);
    expect(screen.getByText(/used your 3 free jobs/i)).toBeDefined();
    expect(screen.getByText(/£9\.99 a month/)).toBeDefined();
  });

  it("says BOTH fees, because both are charged", () => {
    // The subscription does not replace the per-job fee — confirmed by Jacob,
    // 10 Sep. A panel naming only one would understate what a trade pays.
    render(<AllowanceSpentPanel />);
    expect(screen.getByText(/fee on each job you get paid for/i)).toBeDefined();
  });

  it("offers the card and the referral as separate routes", () => {
    render(<AllowanceSpentPanel />);
    expect(screen.getByRole("link", { name: "Add a card" })).toBeDefined();
    expect(screen.getByRole("link", { name: "Earn free jobs" })).toBeDefined();
  });

  it("tells the truth about WHEN a referral pays out", () => {
    // It activates on the referred trade's first PAID job, not on signup and not
    // on a sent quote. Wording it as an instant escape hatch would send a
    // blocked trade to press something that cannot help them today.
    render(<AllowanceSpentPanel />);
    expect(screen.getByText(/first job paid through motko/i)).toBeDefined();
  });

  it("does not read as a lockout, because at this point nothing is locked", () => {
    // The trial is held open until a card exists, so the trade still has full
    // access here. A panel that said otherwise would be false.
    render(<AllowanceSpentPanel />);
    expect(screen.getByText(/carry on quoting as normal/i)).toBeDefined();
  });
});
