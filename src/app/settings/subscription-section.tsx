"use client";

import { useState } from "react";
import type { SubscriptionProjection } from "@/lib/subscription";

type SubscriptionSectionProps = {
  projection: SubscriptionProjection | null;
  currentPeriodEnd?: number | null;
  onCancel: () => Promise<{ success: boolean; error?: string }>;
};

export function SubscriptionSection({
  projection,
  currentPeriodEnd,
  onCancel,
}: SubscriptionSectionProps) {
  const [isConfirming, setIsConfirming] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!projection) {
    return (
      <div className="text-sm text-text-secondary">
        <p>No active subscription found.</p>
      </div>
    );
  }

  const isCanceled = projection.subscription_status === "canceled";
  const isCancelling = projection.subscription_status === "cancel_at_period_end";
  const isActive =
    projection.subscription_status === "active" ||
    projection.subscription_status === "trialing";

  const handleCancelClick = () => {
    setIsConfirming(true);
    setError(null);
  };

  const handleConfirmCancel = async () => {
    setIsSubmitting(true);
    setError(null);

    const result = await onCancel();

    if (result.success) {
      setIsConfirming(false);
    } else {
      setError(result.error ?? "Failed to cancel subscription");
    }

    setIsSubmitting(false);
  };

  const handleCancelConfirmation = () => {
    setIsConfirming(false);
    setError(null);
  };

  const formatDate = (unixSeconds: number) => {
    return new Date(unixSeconds * 1000).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="text-sm">
          <span className="font-medium">Status: </span>
          {isCanceled && <span className="text-text-secondary">Canceled</span>}
          {isCancelling && (
            <span className="text-text-secondary">
              Cancelling — access ends {currentPeriodEnd ? formatDate(currentPeriodEnd) : "at period end"}
            </span>
          )}
          {isActive && <span className="text-text-secondary">Active</span>}
        </div>

        {isCancelling && currentPeriodEnd && (
          <div className="rounded-md bg-surface-secondary p-3 text-sm">
            <p className="font-medium">Your subscription is set to cancel</p>
            <p className="mt-1 text-text-secondary">
              You&apos;ll continue to have full access until {formatDate(currentPeriodEnd)}.
              After that, your subscription will end.
            </p>
          </div>
        )}

        {isCanceled && (
          <div className="rounded-md bg-surface-secondary p-3 text-sm text-text-secondary">
            <p>
              Your subscription has ended. Signed contracts, invoices and job
              history remain accessible.
            </p>
          </div>
        )}
      </div>

      {isActive && !isConfirming && (
        <div className="space-y-3">
          <button
            type="button"
            onClick={handleCancelClick}
            className="text-sm text-text-secondary underline hover:text-text-primary"
          >
            Cancel subscription
          </button>
        </div>
      )}

      {isConfirming && (
        <div className="space-y-3 rounded-md border border-border p-4">
          <div className="space-y-2 text-sm">
            <p className="font-medium">Cancel your subscription?</p>
            <p className="text-text-secondary">
              If you cancel, your subscription will not renew. You&apos;ll
              continue to have full access until the end of your current billing
              period, then your subscription will end.
            </p>
            <p className="text-text-secondary">
              Your signed contracts, invoices and job history will remain
              accessible after cancellation.
            </p>
          </div>

          {error && (
            <div className="rounded-md bg-red-50 p-3 text-sm text-red-900">
              {error}
            </div>
          )}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleConfirmCancel}
              disabled={isSubmitting}
              className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              {isSubmitting ? "Cancelling..." : "Yes, cancel subscription"}
            </button>
            <button
              type="button"
              onClick={handleCancelConfirmation}
              disabled={isSubmitting}
              className="rounded-md bg-surface-secondary px-4 py-2 text-sm font-medium text-text-primary hover:bg-surface-hover disabled:opacity-50"
            >
              Keep subscription
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
