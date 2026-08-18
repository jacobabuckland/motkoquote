"use client";

import { useState, useTransition } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { startStripeOnboarding } from "./stripe-connect-actions";

type Props = {
  stripeAccountId: string | null;
  stripePayoutsEnabled: boolean;
  stripeRequirementsDue: boolean;
};

export const StripeConnectSection = ({
  stripeAccountId,
  stripePayoutsEnabled,
  stripeRequirementsDue,
}: Props) => {
  const [error, setError] = useState<string | null>(null);
  const [starting, startSetup] = useTransition();

  // Determine onboarding state
  const notStarted = !stripeAccountId; // stripe_account_id is null
  const inProgress = stripeAccountId && !stripePayoutsEnabled; // stripe_payouts_enabled is false
  const complete = stripePayoutsEnabled; // stripe_payouts_enabled is true

  const handleSetup = () => {
    setError(null);
    startSetup(async () => {
      const res = await startStripeOnboarding();
      if ("error" in res) {
        setError(res.error);
        return;
      }
      // Redirect to Stripe-hosted onboarding
      window.location.href = res.url;
    });
  };

  return (
    <section>
      <h2 className="mb-1 text-lg font-semibold">Stripe Connect</h2>
      <p className="mb-3 text-sm text-text-secondary">
        Connect your Stripe account to receive payments. All identity
        verification happens securely on Stripe&apos;s platform.
      </p>
      <Card>
        <div className="flex flex-col gap-4">
          {complete && !stripeRequirementsDue && (
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium text-success">Connected ✓</p>
              {stripeAccountId && (
                <p className="text-xs text-text-secondary">
                  Account: {stripeAccountId}
                </p>
              )}
            </div>
          )}

          {stripeRequirementsDue && ( // stripe_requirements_due
            <div className="flex flex-col gap-3">
              <p className="text-sm font-medium text-error">
                Action required
              </p>
              <p className="text-sm text-text-secondary">
                Stripe needs more information to complete your onboarding.
                Complete the requirements to start receiving payments.
              </p>
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
