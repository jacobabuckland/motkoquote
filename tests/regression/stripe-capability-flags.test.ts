// Three booleans on `contractors` whose names do not describe their contents,
// and which caused two wrong calls in a single day (2026-08-25):
//
//   1. A recommendation to point `canAcceptStripePayment` at
//      `stripe_charges_enabled`. That column holds `card_payments`, which
//      `createConnectedAccount` deliberately never requests — so it is false for
//      every contractor, and the change would have shut the pay button for
//      everyone. The codebase had already made and fixed that exact mistake once.
//   2. A decision to repopulate `stripe_payouts_enabled` from
//      `account.payouts_enabled`. That column is what the pay-button gate reads,
//      and `payouts_enabled` is false for a trade with no external account
//      attached who can still legitimately receive transfers — so it would have
//      shut the pay button for a different subset.
//
// Both came from reading the names instead of what fills them. The column was
// left misnamed by owner decision — renaming breaks frozen contracts in
// tests/acceptance/216.test.tsx and bank-details-rail-gating.test.tsx, moves no
// money and changes no behaviour.
//
// So the meaning is bound here instead. These tests are the reason the next
// person does not have to rediscover it.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { canAcceptStripePayment, isOnboardingComplete } from "@/lib/stripe-connect";

const contractor = (over: Partial<Parameters<typeof isOnboardingComplete>[0]> = {}) => ({
  stripe_account_id: "acct_123",
  stripe_payouts_enabled: true,
  stripe_charges_enabled: false,
  stripe_requirements_due: false,
  ...over,
});

describe("what actually gates taking a payment", () => {
  it("lets a contractor take payment on transfers alone, with charges false", () => {
    // The load-bearing case. charges_enabled is false for EVERY contractor,
    // permanently, because card_payments is never requested. If this ever
    // starts requiring it, the pay button is shut for the entire user base.
    expect(
      canAcceptStripePayment(contractor({ stripe_charges_enabled: false })),
      "card_payments is never requested — requiring it shuts the pay button for everyone",
    ).toBe(true);
  });

  it("refuses when the account may not receive transfers", () => {
    expect(canAcceptStripePayment(contractor({ stripe_payouts_enabled: false }))).toBe(
      false,
    );
  });

  it("refuses when there is no connected account at all", () => {
    expect(canAcceptStripePayment(contractor({ stripe_account_id: null }))).toBe(false);
  });

  it("is unaffected by outstanding requirements", () => {
    // Requirements due is a prompt, not a block: Stripe still accepts charges
    // while it collects more information, and refusing here would stop a trade
    // taking money over paperwork Stripe has not finished asking for.
    expect(canAcceptStripePayment(contractor({ stripe_requirements_due: true }))).toBe(
      true,
    );
  });
});

describe("onboarding-complete means received-able, not paid-out", () => {
  it("is true on the transfers capability alone", () => {
    expect(isOnboardingComplete(contractor())).toBe(true);
  });

  it("does not consult charges_enabled", () => {
    // Same trap as above, reached through the other function.
    expect(isOnboardingComplete(contractor({ stripe_charges_enabled: true }))).toBe(true);
    expect(isOnboardingComplete(contractor({ stripe_charges_enabled: false }))).toBe(true);
  });
});

describe("the columns are filled from the capabilities their contents claim", () => {
  // Asserting on source here on purpose, and this is the narrow case where it
  // earns its place: the claim IS about which Stripe field feeds which column,
  // which no runtime behaviour of ours can demonstrate — it only shows up when
  // a real account's capabilities diverge from its payouts_enabled.
  // Comments stripped before matching. Every source-text check in this repo
  // that did not do this has at some point been satisfied — or broken — by
  // prose: #306 counted a `defaultOpen={false}` inside a comment, and the first
  // draft of THIS file failed on its own explanatory note mentioning
  // `account.payouts_enabled`. A check about code should read code.
  const source = () =>
    readFileSync("src/lib/stripe-connect.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");

  it("fills stripe_payouts_enabled from capabilities.transfers", () => {
    expect(source()).toMatch(
      /payoutsEnabled\s*=\s*account\.capabilities\?\.transfers === "active"/,
    );
  });

  it("fills stripe_charges_enabled from capabilities.card_payments", () => {
    expect(source()).toMatch(
      /chargesEnabled\s*=\s*account\.capabilities\?\.card_payments === "active"/,
    );
  });

  it("never requests card_payments, which is why charges_enabled stays false", () => {
    expect(source()).toMatch(/capabilities:\s*\{\s*transfers:\s*\{\s*requested:\s*true/);
    expect(
      source(),
      "requesting card_payments changes what charges_enabled means for every contractor",
    ).not.toMatch(/card_payments:\s*\{\s*requested/);
  });

  it("does not read account.payouts_enabled, which is not stored anywhere", () => {
    // If this starts failing, someone has begun storing the real payouts flag.
    // That is fine — but it must go in a NEW column, because this one is what
    // the pay-button gate reads.
    expect(source()).not.toMatch(/account\.payouts_enabled/);
  });
});
