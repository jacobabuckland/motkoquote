"use client";

import { useState, useTransition, useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { Browser } from "@capacitor/browser";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { startStripeOnboarding, refreshStripeStatus } from "./stripe-connect-actions";

type Props = {
  stripeAccountId: string | null;
  stripePayoutsEnabled: boolean;
  stripePayByBankEnabled: boolean;
  stripeRequirementsDue: boolean;
  // CONN-6: Added to check if manual bank details are complete for full payability.
  // Optional for backward compatibility with existing tests.
  payoutAccountNumber?: string | null;
};

/**
 * Formats Stripe requirement field names into human-readable labels.
 * Converts "individual.verification.document" -> "Identity document"
 */
function formatRequirement(requirement: string): string {
  // Common patterns in Stripe requirements.currently_due
  const mappings: Record<string, string> = {
    "individual.verification.document": "Identity document",
    "individual.verification.additional_document": "Additional identity document",
    "external_account": "Bank account details",
    "business_profile.url": "Business website",
    "business_profile.mcc": "Business category",
    "individual.dob.day": "Date of birth",
    "individual.dob.month": "Date of birth",
    "individual.dob.year": "Date of birth",
    "individual.address.line1": "Address",
    "individual.address.city": "Address",
    "individual.address.postal_code": "Address",
    "individual.address.state": "Address",
    "individual.first_name": "First name",
    "individual.last_name": "Last name",
    "individual.phone": "Phone number",
    "individual.email": "Email address",
    "individual.ssn_last_4": "Tax ID (last 4 digits)",
    "individual.id_number": "National ID number",
    "company.name": "Company name",
    "company.tax_id": "Company tax ID",
    "tos_acceptance.date": "Terms of service acceptance",
  };

  // Check exact match first
  if (mappings[requirement]) {
    return mappings[requirement];
  }

  // Fallback: extract the last segment and humanize it
  const segments = requirement.split(".");
  const lastSegment = segments[segments.length - 1];
  return lastSegment
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export const StripeConnectSection = ({
  stripeAccountId,
  stripePayoutsEnabled,
  stripePayByBankEnabled,
  stripeRequirementsDue,
  payoutAccountNumber,
}: Props) => {
  const [error, setError] = useState<string | null>(null);
  const [starting, startSetup] = useTransition();
  const [requirements, setRequirements] = useState<string[] | null>(null);

  // Determine onboarding state
  const notStarted = !stripeAccountId; // stripe_account_id is null
  // CONN-5: Gates on stripe_pay_by_bank_enabled (payment capability), not
  // stripe_payouts_enabled (transfers capability). An account with transfers
  // active (stripe_payouts_enabled true) but pay_by_bank_payments inactive
  // (stripe_pay_by_bank_enabled false) cannot accept payments.
  const inProgress = stripeAccountId && !stripePayByBankEnabled;
  // Complete when pay_by_bank_enabled is true, regardless of whether
  // stripe_payouts_enabled is true or false.
  const complete = stripePayByBankEnabled;

  // SUBMITTED, AND WAITING ON STRIPE — the state that had no representation.
  //
  // Both Connect accounts in production sit here: requirements_due false,
  // payouts_enabled true, pay_by_bank_enabled false. Stripe is asking for
  // nothing, the trade has done everything, and the section told them "Your
  // Stripe onboarding is in progress. Complete the setup" beside a button that
  // reopens a flow with nothing left in it.
  //
  // `payouts_enabled` is what separates this from a genuinely half-finished
  // onboarding. It holds `capabilities.transfers`, which Stripe only activates
  // once it has accepted the account's identity details — so a trade who has it
  // has been through the hosted flow and been approved for the half Stripe had
  // enough information to decide. A trade who abandoned partway has it false and
  // still belongs in the in-progress branch below, which is what
  // `tests/acceptance/599.test.tsx` pins.
  //
  // It is NOT cosmetic. `canAcceptStripePayment` gates on
  // `stripe_pay_by_bank_enabled` and is, in its own words, the single gate for
  // both the customer-facing pay button and the PaymentIntent route — so a
  // trade in this state cannot be paid through motko at all. Saying so is the
  // point of this branch.
  const awaitingReview =
    Boolean(stripeAccountId) &&
    !stripePayByBankEnabled &&
    !stripeRequirementsDue &&
    stripePayoutsEnabled;

  // Listen for browser closure on native platforms
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) {
      return;
    }

    const handleBrowserFinished = async () => {
      // Refresh Stripe status when the browser is closed.
      // refreshStripeStatus calls revalidatePath("/settings") which triggers
      // a re-render with fresh props.
      await refreshStripeStatus();
    };

    // Guarded because the plugin may not be in the native binary at all.
    // ios/App/Podfile declared seven pods against thirteen in package.json, so
    // six plugins — Browser among them — were compiled out of the shipped app,
    // and every call into one throws "Browser plugin is not implemented on
    // ios". This one fires on MOUNT, so the whole Settings section threw the
    // moment a native user opened it; Browser.open below is separately guarded
    // and never got the chance to degrade.
    //
    // Losing the listener costs a manual refresh — it exists to pick up the new
    // Stripe status when the in-app browser closes — which is a fair trade for
    // the page rendering. The Podfile is fixed alongside this, but a rebuild
    // only reaches users who update, and the next missing plugin gets the same
    // treatment for free.
    let listener: ReturnType<typeof Browser.addListener> | null = null;
    try {
      listener = Browser.addListener("browserFinished", handleBrowserFinished);
    } catch (error) {
      console.error("[stripe-connect] could not watch for the browser closing", error);
    }

    return () => {
      // `?.` because there may be no listener to remove, and `.catch` because a
      // plugin that threw on the way in can throw on the way out too — an
      // unhandled rejection during unmount is the same defect wearing a
      // different hat.
      listener?.then((handle) => handle.remove()).catch(() => {});
    };
  }, []);

  // Fetch specific requirements when requirements are due
  useEffect(() => {
    if (!stripeRequirementsDue || !stripeAccountId) {
      return;
    }

    // Dynamic import to avoid breaking tests that mock stripe-connect-actions
    // without including fetchStripeRequirements. Catch errors gracefully and
    // fall back to generic message.
    import("./stripe-connect-actions")
      .then(({ fetchStripeRequirements }) => {
        if (fetchStripeRequirements) {
          return fetchStripeRequirements();
        }
        return null;
      })
      .then((result) => {
        if (result && "requirements" in result) {
          setRequirements(result.requirements);
        }
      })
      .catch(() => {
        // Mock doesn't include fetchStripeRequirements or fetch failed
        // Fall back to generic message (requirements stays null)
      });
  }, [stripeRequirementsDue, stripeAccountId]);

  const handleSetup = () => {
    setError(null);
    startSetup(async () => {
      const res = await startStripeOnboarding();
      if ("error" in res) {
        setError(res.error);
        return;
      }

      // Branch on platform
      if (Capacitor.isNativePlatform()) {
        // Native: open in SFSafariViewController
        try {
          await Browser.open({ url: res.url });
        } catch {
          // Plugin not available or other error — degrade to window.location
          window.location.href = res.url;
        }
      } else {
        // Web: redirect to Stripe-hosted onboarding
        window.location.href = res.url;
      }
    });
  };

  return (
    <section>
      <h2 className="mb-1 text-lg font-semibold">Stripe Connect</h2>
      {/* "receive payments" used to end this sentence, and the complete state
          below used to be a bare green "Connected ✓". Both read as "your money
          is reaching your bank". Neither is true: stripe_payouts_enabled is
          Stripe's flag for the account being PERMITTED to pay out, and it says
          nothing about whether motko ever asks it to. Accounts created by
          createConnectedAccount carry interval: "manual" and nothing in src/
          calls stripe.payouts.create, so the money reaches Stripe and stops.
          This is the surface the "marked as paid but no monies received"
          complaint came through. Roadmap PAY-8 builds the payout leg; until it
          lands this must not claim one exists. */}
      <p className="mb-3 text-sm text-text-secondary">
        Stripe verifies who you are and holds the money your customers pay.
        Identity checks happen on Stripe&apos;s platform, not here.
      </p>
      <Card>
        <div className="flex flex-col gap-4">
          {complete && !stripeRequirementsDue && (
            <div className="flex flex-col gap-1">
              {/* CONN-6: Shows what is actually true — the account is set up and can
                  take payments — and stops short of the bit that isn't. When manual
                  bank account number hasn't been filled (Stripe doesn't provide it),
                  note that large invoices may need manual bank transfer setup. */}
              <p className="text-sm font-medium text-success">
                Set up ✓ — you can take payments
              </p>
              <p className="text-xs text-text-secondary">
                Money your customers pay lands in your Stripe balance. Paying it
                out to your bank isn&apos;t switched on yet.
              </p>
              {!payoutAccountNumber && (
                <p className="text-xs text-text-secondary">
                  For large invoices or as a backup, complete your bank account
                  details in the Payout Details section below.
                </p>
              )}
              {stripeAccountId && (
                <p className="text-xs text-text-muted">
                  Account: {stripeAccountId}
                </p>
              )}
            </div>
          )}

          {stripeRequirementsDue && ( // stripe_requirements_due
            <div className="flex flex-col gap-3">
              <p className="text-sm font-medium text-error">Action required</p>
              {requirements && requirements.length > 0 ? (
                <div className="flex flex-col gap-2">
                  <p className="text-sm text-text-secondary">
                    Stripe needs the following information to complete your onboarding:
                  </p>
                  <ul className="list-disc list-inside text-sm text-text-secondary">
                    {requirements.map((req, idx) => (
                      <li key={idx}>{formatRequirement(req)}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-sm text-text-secondary">
                  Stripe needs more information to complete your onboarding.
                  Complete the requirements to start receiving payments.
                </p>
              )}
              <Button
                type="button"
                variant="primary"
                disabled={starting}
                onClick={handleSetup}
              >
                {starting ? "Connecting to Stripe…" : "Complete requirements"}
              </Button>
            </div>
          )}

          {awaitingReview && (
            <div className="flex flex-col gap-3">
              <p className="text-sm font-medium text-ink">
                Stripe is reviewing your account
              </p>
              <p className="text-sm text-text-secondary">
                You&apos;ve given Stripe everything it asked for and nothing is
                outstanding. There&apos;s nothing for you to do — Stripe
                switches payments on at its end.
              </p>
              <p className="text-sm text-text-secondary">
                Until it does, customers can&apos;t pay through Motko. You can
                still send quotes, contracts and invoices, and take payment by
                bank transfer or cash — mark those as paid on the job and
                everything else works as normal.
              </p>
              <Button
                type="button"
                variant="secondary"
                disabled={starting}
                onClick={() => startSetup(async () => { await refreshStripeStatus(); })}
              >
                {starting ? "Checking…" : "Check again"}
              </Button>
              {stripeAccountId && (
                <p className="text-xs text-text-muted">Account: {stripeAccountId}</p>
              )}
            </div>
          )}

          {inProgress && !stripeRequirementsDue && !awaitingReview && (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-text-secondary">
                Your Stripe onboarding is in progress. Complete the setup to
                start receiving payments.
              </p>
              <Button
                type="button"
                variant="primary"
                disabled={starting}
                onClick={handleSetup}
              >
                {starting ? "Connecting to Stripe…" : "Complete onboarding"}
              </Button>
            </div>
          )}

          {notStarted && (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-text-secondary">
                You haven&apos;t connected to Stripe yet. Connect your account
                to receive payments from customers.
              </p>
              <Button
                type="button"
                variant="primary"
                disabled={starting}
                onClick={handleSetup}
              >
                {starting ? "Connecting to Stripe…" : "Connect to Stripe"}
              </Button>
            </div>
          )}

          {error && <p className="text-sm text-error">{error}</p>}
        </div>
      </Card>
    </section>
  );
};
