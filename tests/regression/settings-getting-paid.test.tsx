/**
 * @vitest-environment happy-dom
 */

// Settings rendered the two halves of getting paid as unlike objects: bank
// details inside a Disclosure, Stripe Connect as a bare always-open section
// directly below it. So the screen showed one closed row and then an expanded
// block on the same subject, reading as two unrelated settings rather than two
// steps of one thing.
//
// And the Connect half said something untrue. A bare green "Connected ✓", under
// copy promising the account was there "to receive payments", reads as "your
// money is reaching your bank". `stripe_payouts_enabled` is Stripe's flag for
// the account being PERMITTED to pay out; it says nothing about whether motko
// ever asks it to, and nothing in src/ calls stripe.payouts.create. This is the
// surface the "marked as paid but no monies received" complaint came through.
//
// The frozen tests covering this area (306, 216) read the page's SOURCE. These
// render the components and assert what a contractor can actually perceive.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StripeConnectSection } from "@/app/settings/stripe-connect-section";
import { Disclosure } from "@/components/ui/disclosure";

afterEach(cleanup);

type ConnectProps = {
  stripeAccountId: string | null;
  stripePayoutsEnabled: boolean;
  stripeRequirementsDue: boolean;
};

const connect = (over: Partial<ConnectProps> = {}) =>
  render(
    <StripeConnectSection
      // `in`, not `??`: null is a MEANINGFUL value here (never onboarded), and
      // `null ?? "acct_123"` would quietly substitute the default and render
      // the wrong branch.
      stripeAccountId={
        "stripeAccountId" in over ? over.stripeAccountId! : "acct_123"
      }
      stripePayoutsEnabled={over.stripePayoutsEnabled ?? true}
      stripeRequirementsDue={over.stripeRequirementsDue ?? false}
    />,
  );

describe("what the set-up state claims", () => {
  it("does not tell a trade they are 'Connected' full stop", () => {
    // The exact string that caused the complaint. If it comes back, so does
    // the reading that money is arriving.
    connect();
    expect(
      screen.queryByText("Connected ✓"),
      "a bare 'Connected ✓' reads as 'your money is reaching your bank'",
    ).toBeNull();
  });

  it("says what is true — the account is set up and can take payments", () => {
    connect();
    expect(screen.getByText(/Set up ✓/)).toBeDefined();
    expect(screen.getByText(/can take payments/i)).toBeDefined();
  });

  it("says plainly that paying out to the bank is not switched on", () => {
    // The half that was missing. Until PAY-8 builds the payout leg this is the
    // single most important sentence on the screen, because its absence is
    // what made a trade believe they had been paid.
    connect();
    expect(screen.getByText(/isn't switched on yet/i)).toBeDefined();
  });

  it("still shows the account id, so support can identify them", () => {
    connect({ stripeAccountId: "acct_abc789" });
    expect(screen.getByText(/acct_abc789/)).toBeDefined();
  });

  it("promises nothing about a payout having happened or being scheduled", () => {
    connect();
    const body = document.body.textContent ?? "";
    for (const promise of [
      "paid out",
      "in your bank",
      "transferred",
      "on its way",
    ]) {
      expect(
        body.toLowerCase(),
        `the set-up state must not imply a payout: "${promise}"`,
      ).not.toContain(promise);
    }
  });
});

describe("the other states are untouched", () => {
  it("still asks an unconnected trade to connect", () => {
    connect({ stripeAccountId: null, stripePayoutsEnabled: false });
    expect(
      screen.getByRole("button", { name: "Connect to Stripe" }),
    ).toBeDefined();
  });

  it("still surfaces outstanding requirements as an action", () => {
    connect({ stripeRequirementsDue: true });
    expect(screen.getByText("Action required")).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Complete requirements" }),
    ).toBeDefined();
  });

  it("still asks a half-onboarded trade to finish", () => {
    connect({ stripePayoutsEnabled: false });
    expect(
      screen.getByRole("button", { name: "Complete onboarding" }),
    ).toBeDefined();
  });
});

describe("both halves live in one collapsible section", () => {
  // The page is a server component, so it cannot be rendered here. This binds
  // the shape the page composes: a Disclosure whose title carries the
  // requirements signal, holding Connect and the bank form together.
  const GettingPaid = ({ requirementsDue }: { requirementsDue: boolean }) => (
    <Disclosure
      id="payout-details"
      title={
        requirementsDue ? "Getting paid — action required" : "Getting paid"
      }
      defaultOpen={false}
    >
      <div className="space-y-6">
        <StripeConnectSection
          stripeAccountId="acct_123"
          stripePayoutsEnabled
          stripeRequirementsDue={requirementsDue}
        />
        <p>Bank details form</p>
      </div>
    </Disclosure>
  );

  it("shows one row, and both halves once it is opened", () => {
    render(<GettingPaid requirementsDue={false} />);

    const row = screen.getByRole("button", { name: /Getting paid/ });
    expect(row.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(row);

    expect(screen.getByText(/Set up ✓/)).toBeDefined();
    expect(screen.getByText("Bank details form")).toBeDefined();
  });

  it("names an outstanding requirement on the collapsed row itself", () => {
    // Grouping's one real cost is burying an "Action required" behind a closed
    // row. The row carries it instead — visible without expanding anything,
    // and without needing the section to spring open.
    render(<GettingPaid requirementsDue />);
    expect(
      screen.getByRole("button", { name: /Getting paid — action required/ }),
    ).toBeDefined();
  });

  it("says nothing about an action when there is none", () => {
    render(<GettingPaid requirementsDue={false} />);
    expect(screen.queryByText(/action required/i)).toBeNull();
  });
});
