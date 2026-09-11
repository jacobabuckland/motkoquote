"use client";

import { useState } from "react";

type BillingSectionProps = {
  /** Whether Stripe holds a default payment method for this contractor. */
  hasCard: boolean;
  /** Null when the contractor has no subscription yet — there is nothing to bill. */
  hasSubscription: boolean;
  onAddCard: () => Promise<{ success: boolean; url?: string; error?: string }>;
};

/**
 * Settings → Billing. The card motko charges the £9.99 subscription to.
 *
 * THIS PAGE DID NOT EXIST until 10 Sep, and three separate lockout messages
 * already told trades to come here — "Update your card details in Settings →
 * Billing to restore access." There was no SetupIntent, no billing portal and no
 * Checkout session anywhere in the tree, so a trade whose payment failed was
 * sent to a section that was not there, with no way to pay.
 *
 * Stripe Checkout in `setup` mode rather than Elements: the card is entered on
 * Stripe's own page, so motko never touches the number and the PCI surface stays
 * out of this codebase. It also works unchanged inside the iOS WKWebView shell
 * and brings Apple Pay with it.
 */
export function BillingSection({ hasCard, hasSubscription, onAddCard }: BillingSectionProps) {
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = async () => {
    setIsStarting(true);
    setError(null);

    const result = await onAddCard();

    if (result.success && result.url) {
      // Stripe hosts the card form. It returns to /settings#billing, where the
      // webhook-updated state is read fresh.
      window.location.href = result.url;
      return;
    }

    setError(result.error ?? "Couldn't open the card form. Try again in a moment.");
    setIsStarting(false);
  };

  if (!hasSubscription) {
    return (
      <p className="text-sm text-text-secondary">
        You don&apos;t have a subscription yet, so there&apos;s nothing to bill.
        Start one under Subscription above and you can add a card here.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-text-secondary">
        {hasCard
          ? "A card is on file. Motko charges it £9.99 a month once your three free jobs are used."
          : "No card on file. Add one now and your next job goes through without interruption — nothing is charged until your three free jobs are used."}
      </p>

      <button
        type="button"
        onClick={handleClick}
        disabled={isStarting}
        className="rounded-md bg-green px-4 py-2 text-sm font-medium text-white disabled:bg-muted-fill disabled:text-muted-ink"
      >
        {isStarting ? "Opening…" : hasCard ? "Replace card" : "Add a card"}
      </button>

      {error && (
        <div className="rounded-md border border-red bg-error-bg p-3 text-sm text-error">{error}</div>
      )}
    </div>
  );
}
