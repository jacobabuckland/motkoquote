"use client";

import { useTransition } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { startPayoutOnboarding, getExpressDashboardUrl } from "./payout-actions";

type Props = {
  hasAccount: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  requirementsDue: boolean;
};

export const PayoutsSection = ({
  hasAccount,
  chargesEnabled,
  requirementsDue,
}: Props) => {
  const toast = useToast();
  const [starting, startOnboarding] = useTransition();
  const [opening, openDashboard] = useTransition();

  const status: "none" | "in_progress" | "ready" = !hasAccount
    ? "none"
    : chargesEnabled && !requirementsDue
      ? "ready"
      : "in_progress";

  const onStart = () => {
    startOnboarding(async () => {
      const res = await startPayoutOnboarding();
      if ("url" in res) {
        window.location.href = res.url;
        return;
      }
      toast(res.error);
    });
  };

  const onOpenDashboard = () => {
    openDashboard(async () => {
      const res = await getExpressDashboardUrl();
      if ("url" in res) {
        window.open(res.url, "_blank", "noopener,noreferrer");
        return;
      }
      toast(res.error);
    });
  };

  return (
    <section>
      <h2 className="mb-1 text-lg font-semibold">Payouts</h2>
      <p className="mb-3 text-sm text-text-secondary">
        Get paid straight to your own bank. Stripe handles all the details
        securely — we never see or store your bank information.
      </p>
      <Card className="space-y-3">
        {status === "none" && (
          <>
            <p className="text-sm font-medium">Not set up</p>
            <p className="text-sm text-text-secondary">
              Set up payouts so customers can pay you online and the money lands
              in your account.
            </p>
            <Button variant="primary" onClick={onStart} disabled={starting}>
              {starting ? "Starting…" : "Set up payouts"}
            </Button>
          </>
        )}

        {status === "in_progress" && (
          <>
            <p className="text-sm font-medium text-amber-600">
              In progress — Stripe needs more info
            </p>
            <p className="text-sm text-text-secondary">
              {requirementsDue
                ? "Stripe needs a bit more information before you can receive payments."
                : "You haven't finished payout setup yet."}
            </p>
            <Button variant="primary" onClick={onStart} disabled={starting}>
              {starting ? "Opening…" : "Finish payout setup"}
            </Button>
          </>
        )}

        {status === "ready" && (
          <>
            <p className="text-sm font-medium text-green-700">
              Ready to receive payments
            </p>
            <p className="text-sm text-text-secondary">
              Online payments settle to your connected account.
            </p>
            <Button
              variant="secondary"
              onClick={onOpenDashboard}
              disabled={opening}
            >
              {opening ? "Opening…" : "View payouts in Stripe"}
            </Button>
          </>
        )}
      </Card>
    </section>
  );
};
