import Link from "next/link";
import { Card } from "@/components/ui/card";
import { buttonClass } from "@/components/ui/button";
import { SUBSCRIPTION_PRICE_PENNIES } from "@/lib/subscription";
import { FREE_JOB_ALLOWANCE } from "@/lib/motko-fee";

/**
 * Shown once the free-job allowance is spent and nothing is yet paying for what
 * comes next.
 *
 * WHY IT EXISTS. Before this, hitting zero was silent: the "N free jobs left"
 * badge simply disappeared and the trade found out what happened when their card
 * was charged — or, with no card on file, when Stripe moved them to `past_due`
 * and the app locked them out. This is the moment a card actually gets added, so
 * it is load-bearing rather than decorative.
 *
 * IT DOES NOT BLOCK. The trade keeps full access while trialing; the trial is
 * held open by `endTrialIfAllowanceExhausted` until a card exists. So this is a
 * panel on the dashboard, never a modal over it — the third door is simply
 * carrying on, and closing the page must not be a trap.
 *
 * THE REFERRAL DOOR IS NOW A REAL ONE. REF-4 moved activation to the referred
 * trade's FIRST SENT QUOTE (`referral-activation.ts`), so the reward can arrive
 * the same day rather than weeks later when they finally get paid. That is what
 * makes it worth offering here at all: under the old paid-job trigger this
 * button could not help a trade who had run out today, and the copy had to say
 * so. It still states the condition rather than implying the reward is instant.
 */
export function AllowanceSpentPanel() {
  const price = (SUBSCRIPTION_PRICE_PENNIES / 100).toFixed(2);

  return (
    <Card className="flex flex-col items-start gap-3">
      <h2 className="display text-xl font-bold">
        You&apos;ve used your {FREE_JOB_ALLOWANCE} free jobs
      </h2>
      <p className="max-w-prose text-sm text-ink-secondary">
        Nothing has changed yet — you can carry on quoting as normal. Motko is
        £{price} a month from your next paid job, plus the usual fee on each job
        you get paid for.
      </p>
      <p className="max-w-prose text-sm text-ink-secondary">
        Add a card so your next job goes through without interruption. Without
        one, motko can&apos;t take payment and your account moves to view-only.
      </p>

      <div className="flex flex-wrap gap-3">
        <Link href="/settings#billing" className={buttonClass("primary", "shrink-0")}>
          Add a card
        </Link>
        <Link href="/settings#referral" className={buttonClass("secondary", "shrink-0")}>
          Earn free jobs
        </Link>
      </div>

      <p className="max-w-prose text-xs text-ink-secondary">
        Refer another trade and you&apos;ll earn 3 more free jobs as soon as they
        send their first quote with Motko. You can cancel any time in Settings —
        your signed contracts, invoices and job history stay available.
      </p>
    </Card>
  );
}
