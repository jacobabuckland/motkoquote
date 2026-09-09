/**
 * @vitest-environment happy-dom
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SubscriptionSection } from "@/app/settings/subscription-section";

/**
 * A contractor with no subscription can get one.
 *
 * The section's whole no-subscription branch was the sentence "No active
 * subscription found." — a dead end beside no way out of it. SUB-1 creates the
 * subscription in `persistContractorSetup` and NOWHERE else, so a trade the
 * silent creation missed had no route to one at all.
 *
 * It missed everyone. SUB-1 shipped 6 Sep; every contractor in production
 * completed setup before it, and `subscription_projection` is empty across the
 * whole database.
 *
 * THE ERROR MUST SHOW. Setup wraps the same call in `catch { console.warn }`,
 * which is why this has failed unseen: Buckland Plastering's Stripe CUSTOMER
 * exists and its SUBSCRIPTION does not, so `subscriptions.create` is throwing
 * and nobody has ever read the reason. Surfacing it is the same move N4.1 made
 * for push, and here it is also the diagnosis — the first person to press the
 * button learns what Stripe actually says.
 */

afterEach(cleanup);

const noop = async () => ({ success: true });

describe("with no subscription", () => {
  it("offers a way to start one", () => {
    render(<SubscriptionSection projection={null} onCancel={noop} onStart={noop} />);
    expect(screen.getByRole("button", { name: "Start subscription" })).toBeDefined();
  });

  it("says what it costs and that the first jobs are free", () => {
    // D18: nothing is charged until the three free jobs are gone, so a button
    // that read only "Start subscription" would look like a charge.
    render(<SubscriptionSection projection={null} onCancel={noop} onStart={noop} />);
    expect(screen.getByText(/£9\.99 a month/)).toBeDefined();
    expect(screen.getByText(/first three jobs are free/)).toBeDefined();
  });

  it("calls the start action when pressed", async () => {
    const onStart = vi.fn(async () => ({ success: true }));
    render(<SubscriptionSection projection={null} onCancel={noop} onStart={onStart} />);

    fireEvent.click(screen.getByRole("button", { name: "Start subscription" }));

    await waitFor(() => expect(onStart).toHaveBeenCalledTimes(1));
  });

  it("SHOWS the reason when Stripe refuses, rather than swallowing it", async () => {
    // The point of the whole change. A real Stripe message reaches the person
    // who can act on it.
    const onStart = vi.fn(async () => ({
      success: false,
      error: "trial_end cannot be more than five years in the future",
    }));
    render(<SubscriptionSection projection={null} onCancel={noop} onStart={onStart} />);

    fireEvent.click(screen.getByRole("button", { name: "Start subscription" }));

    await waitFor(() =>
      expect(screen.getByText(/trial_end cannot be more than five years/)).toBeDefined(),
    );
  });
});

describe("with a subscription", () => {
  const active = {
    contractor_id: "c1",
    stripe_subscription_id: "sub_1",
    stripe_customer_id: "cus_1",
    subscription_status: "trialing" as const,
    trial_end: null,
    // Written out in full rather than nulled: SubscriptionProjection declares
    // these as strings, and a partial literal compiles nowhere and runs
    // everywhere — vitest ignores the gap and only tsc objects.
    last_event_id: "evt_1",
    last_event_created: 1_788_790_223,
  };

  it("does not offer to start a second one", () => {
    render(<SubscriptionSection projection={active} onCancel={noop} onStart={noop} />);
    expect(screen.queryByRole("button", { name: "Start subscription" })).toBeNull();
  });
});

/**
 * The page has to WIRE it, and must not swallow the error on the way.
 * Source-read for the reason the sibling settings tests are: this is an inline
 * Server Action inside an async server component.
 */
describe("the settings page wires it", () => {
  const source = readFileSync(
    resolve(__dirname, "../../src/app/settings/page.tsx"),
    "utf8",
  );
  const body = source.replace(/\/\/[^\n]*/g, "");

  it("passes a start action to the section", () => {
    expect(body).toMatch(/onStart=\{handleStartSubscription\}/);
  });

  it("returns the Stripe error rather than logging it", () => {
    // console.warn here would reproduce exactly the silence this fixes.
    const action = body.slice(body.indexOf("const handleStartSubscription"));
    const scoped = action.slice(0, action.indexOf("return (") === -1 ? action.length : action.indexOf("return ("));
    expect(scoped).toMatch(/error instanceof Error \? error\.message/);
    expect(scoped).not.toMatch(/console\.warn/);
  });

  it("refuses when billing is not configured, instead of failing obscurely", () => {
    expect(body).toContain("STRIPE_SUBSCRIPTION_PRICE_ID");
  });
});
