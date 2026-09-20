"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Capacitor } from "@capacitor/core";
import { Browser } from "@capacitor/browser";
import { Button, buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { startStripeOnboarding } from "@/app/settings/stripe-connect-actions";

type Props = {
  /** True once a connected account exists — the trade started and stopped. */
  started: boolean;
};

/**
 * The last screen of setup: the offer to get on the payment rail.
 *
 * SKIPPABLE BY DESIGN. Nothing here blocks a trade from reaching the
 * dashboard, quoting, contracting or invoicing — the point of the step is that
 * the offer is made at all, at the moment a trade is already in a setting-up
 * frame of mind, instead of waiting for them to discover it in a collapsed
 * Settings row or in the banner after their first invoice has already gone
 * out unpayable.
 */
export const PayoutStep = ({ started }: Props) => {
  const [error, setError] = useState<string | null>(null);
  const [starting, startSetup] = useTransition();

  const handleSetup = () => {
    setError(null);
    startSetup(async () => {
      const res = await startStripeOnboarding("setup");
      if ("error" in res) {
        setError(res.error);
        return;
      }

      // The same platform branch as the Settings section's twin
      // (src/app/settings/stripe-connect-section.tsx). Kept inline rather than
      // shared: extracting it would move the mock target under frozen
      // acceptance tests that cover that section, for no behavioural gain.
      if (Capacitor.isNativePlatform()) {
        try {
          await Browser.open({ url: res.url });
        } catch {
          // Plugin absent from the native binary, or otherwise unavailable.
          window.location.href = res.url;
        }
      } else {
        window.location.href = res.url;
      }
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Get paid through Motko</h1>
        {/* Nothing here may claim a SPEED — scripts/ci/check-forbidden-copy.sh
            rejects that, and the payout schedule is Stripe's to state, not
            ours. The honest advantage is that the customer can pay from the
            invoice, and that Motko can then chase it. */}
        <p className="text-sm text-text-secondary">
          Set this up and your customers can pay straight from the invoice you
          send them, into your own bank account. Stripe verifies who you are and
          passes the money through — identity checks happen on Stripe&rsquo;s
          platform, not here.
        </p>
      </div>

      <Card>
        <div className="flex flex-col gap-4">
          {started && (
            <p className="text-sm font-medium text-ink">
              You started this and didn&rsquo;t finish. Stripe still needs a few
              details from you.
            </p>
          )}
          <Button
            type="button"
            variant="primary"
            onClick={handleSetup}
            disabled={starting}
            loading={starting}
          >
            {starting
              ? "Opening Stripe…"
              : started
                ? "Finish setting up payments"
                : "Set up payments"}
          </Button>
          {error && <p className="text-sm text-error">{error}</p>}
        </div>
      </Card>

      <div className="flex flex-col gap-2">
        <Link href="/dashboard" className={buttonClass("secondary", "w-full sm:w-auto")}>
          Skip for now
        </Link>
        {/* Says what skipping costs, because a skip offered without one reads
            as "this doesn't matter". It does: until Connect is set up, an
            invoice has no way to be paid through Motko. */}
        <p className="text-xs text-text-secondary">
          You can set this up any time in Settings. Until you do, you can still
          send quotes, contracts and invoices — you&rsquo;ll just need to arrange
          payment with the customer yourself.
        </p>
      </div>
    </div>
  );
};

export default PayoutStep;
