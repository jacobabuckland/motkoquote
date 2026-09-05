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
  stripeRequirementsDue: boolean;
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
  stripeRequirementsDue,
}: Props) => {
  const [error, setError] = useState<string | null>(null);
  const [starting, startSetup] = useTransition();
  const [requirements, setRequirements] = useState<string[] | null>(null);

  // Determine onboarding state
  const notStarted = !stripeAccountId; // stripe_account_id is null
  const inProgress = stripeAccountId && !stripePayoutsEnabled; // stripe_payouts_enabled is false
  const complete = stripePayoutsEnabled; // stripe_payouts_enabled is true

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

    const listener = Browser.addListener("browserFinished", handleBrowserFinished);

    return () => {
      listener.then((handle) => handle.remove());
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
              {/* Says what is actually true — the account is set up and can
                  take payments — and stops short of the bit that isn't. */}
              <p className="text-sm font-medium text-success">
                Set up ✓ — you can take payments
              </p>
              <p className="text-xs text-text-secondary">
                Money your customers pay lands in your Stripe balance. Paying it
                out to your bank isn&apos;t switched on yet.
              </p>
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

          {inProgress && !stripeRequirementsDue && (
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
