"use client";

/**
 * REFUND-1: Refund button with confirmation dialog
 *
 * Shows balance consequences before confirmation. Processes full or partial
 * refunds through Stripe. Updates job state to refunded/partially_refunded.
 */

import { useState, useTransition, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { formatGBP } from "@/lib/format";
import {
  checkRefundEligibility,
  processRefund,
} from "@/app/jobs/[id]/refund-actions";
import * as haptics from "@/lib/haptics";

type Props = {
  jobId: string;
  customerName: string;
  // Total amount settled (in pennies)
  settledAmountPennies: number;
};

export default function RefundButton({
  jobId,
  customerName,
  settledAmountPennies,
}: Props) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [refundAmountPennies, setRefundAmountPennies] = useState(
    settledAmountPennies,
  );
  const [maxRefundablePennies, setMaxRefundablePennies] = useState(
    settledAmountPennies,
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [refunded, setRefunded] = useState(false);
  const navigationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMounted = useRef(true);

  // Clear timer on unmount
  useEffect(
    () => () => {
      isMounted.current = false;
      if (navigationTimer.current) {
        clearTimeout(navigationTimer.current);
        navigationTimer.current = null;
      }
    },
    [],
  );

  // Check eligibility when dialog opens
  useEffect(() => {
    if (open) {
      start(async () => {
        const eligibility = await checkRefundEligibility(jobId);
        if (!eligibility.eligible) {
          setError(eligibility.reason);
          setMaxRefundablePennies(0);
        } else {
          setMaxRefundablePennies(eligibility.maxRefundablePennies);
          setRefundAmountPennies(eligibility.maxRefundablePennies);
          setError(null);
        }
      });
    }
  }, [open, jobId]);

  const confirm = () => {
    setError(null);
    setRefunded(false);
    start(async () => {
      const result = await processRefund(jobId, refundAmountPennies);
      if (!result.success) {
        haptics.error();
        setError(result.error);
        setRefunded(false);
        return;
      }
      haptics.success();
      toast("Refund processed");
      // Terminal "Refunded ✓" FIRST, then schedule navigation
      setRefunded(true);
      if (isMounted.current) {
        navigationTimer.current = setTimeout(() => {
          if (!isMounted.current) return;
          navigationTimer.current = null;
          router.push(`/jobs/${jobId}?sent=refunded`);
        }, 450);
      }
    });
  };

  const refundAmountPounds = refundAmountPennies / 100;
  const settledAmountPounds = settledAmountPennies / 100;
  const maxRefundablePounds = maxRefundablePennies / 100;
  const isFullRefund = refundAmountPennies === maxRefundablePennies;

  return (
    <>
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        Refund
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-label="Refund settlement"
          onClick={() => !pending && setOpen(false)}
        >
          <div
            className="flex w-full max-w-md flex-col gap-4 rounded-t-2xl bg-surface p-5 pb-safe shadow-hover sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-col gap-1">
              <h2 className="text-lg font-semibold">Refund to {customerName}</h2>
              <p className="text-sm text-text-secondary">
                Process a full or partial refund via Stripe.
              </p>
            </div>

            <label htmlFor="refund-amount" className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-text-secondary">
                Refund amount
              </span>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-text-secondary">
                  £
                </span>
                <input
                  id="refund-amount"
                  type="number"
                  value={refundAmountPounds}
                  min={0.01}
                  max={maxRefundablePounds}
                  step={0.01}
                  onChange={(e) =>
                    setRefundAmountPennies(Math.round(parseFloat(e.target.value) * 100))
                  }
                  className="h-11 w-full rounded-control border border-border bg-surface pl-7 pr-3 text-sm text-foreground"
                />
              </div>
              <span className="text-xs text-text-muted">
                Max refundable: {formatGBP(maxRefundablePennies)}
              </span>
            </label>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setRefundAmountPennies(maxRefundablePennies)}
                className={`flex-1 rounded-control border px-3 py-2 text-sm ${
                  isFullRefund
                    ? "border-primary bg-primary/5 font-medium text-foreground"
                    : "border-border bg-surface text-text-secondary"
                }`}
              >
                Full refund
              </button>
              <button
                type="button"
                onClick={() =>
                  setRefundAmountPennies(Math.round(maxRefundablePennies / 2))
                }
                className={`flex-1 rounded-control border px-3 py-2 text-sm ${
                  !isFullRefund &&
                  refundAmountPennies === Math.round(maxRefundablePennies / 2)
                    ? "border-primary bg-primary/5 font-medium text-foreground"
                    : "border-border bg-surface text-text-secondary"
                }`}
              >
                Half refund
              </button>
            </div>

            <div className="rounded-card bg-surface-hover p-3 text-sm text-text-secondary">
              <p className="mb-1 font-medium text-foreground">
                ⚠️ This will debit your Stripe account
              </p>
              <p>
                {formatGBP(refundAmountPennies)} will be returned to {customerName}
                &apos;s payment method. Your connected account balance will be reduced
                and may go negative if funds have already been paid out.
              </p>
            </div>

            {error && <p className="text-sm text-error">{error}</p>}

            <div className="flex flex-col gap-2">
              <Button
                type="button"
                variant="primary"
                disabled={
                  pending || refunded || refundAmountPennies <= 0 || error !== null
                }
                onClick={confirm}
              >
                {refunded
                  ? "Refunded ✓"
                  : pending
                    ? "Processing refund…"
                    : `Refund ${formatGBP(refundAmountPennies)}`}
              </Button>
              <Button
                type="button"
                variant="tertiary"
                disabled={pending || refunded}
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
