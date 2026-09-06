"use client";

// REFUND-1 — the trade-facing refund control and its confirmation.
//
// The card's requirement is that the trade sees the balance consequence BEFORE
// confirming, "in terms a person understands". So the dialog states in plain
// words that the money leaves their account and that the account may go
// negative, and it states it above the confirm button rather than after it.
//
// Every amount in this file is held in PENNIES and converted exactly once, at
// the point of display. formatGBP takes POUNDS — the whole app's one money
// formatter says so in its first line — and handing it pennies overstates
// every figure by 100x. In a dialog whose entire job is to tell someone how
// much is about to leave their bank account, that is the worst possible place
// for that mistake, so the conversion is named rather than inlined.

import { useState, useTransition, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { formatGBP } from "@/lib/format";
import { checkRefundEligibility, processRefund } from "@/app/jobs/[id]/refund-actions";
import * as haptics from "@/lib/haptics";

type Props = {
  jobId: string;
  customerName: string;
  /** What the customer paid, in pennies. The dialog re-checks with Stripe on open. */
  settledAmountPennies: number;
};

/** Pennies to the pounds formatGBP expects. The only conversion in this file. */
const gbp = (pennies: number): string => formatGBP(pennies / 100);

export default function RefundButton({
  jobId,
  customerName,
  settledAmountPennies,
}: Props) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [refundAmountPennies, setRefundAmountPennies] = useState(settledAmountPennies);
  const [maxRefundablePennies, setMaxRefundablePennies] = useState(settledAmountPennies);
  const [error, setError] = useState<string | null>(null);
  const [checking, startCheck] = useTransition();
  const [pending, start] = useTransition();
  const [refunded, setRefunded] = useState(false);
  const navigationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMounted = useRef(true);

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

  // The page's figure is what the customer paid; what is still REFUNDABLE is a
  // question only Stripe can answer, because an earlier partial refund is
  // recorded there. Asked on open so the ceiling in the dialog is live.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    startCheck(async () => {
      const eligibility = await checkRefundEligibility(jobId);
      if (cancelled || !isMounted.current) return;
      if (!eligibility.eligible) {
        setError(eligibility.reason);
        setMaxRefundablePennies(0);
        setRefundAmountPennies(0);
        return;
      }
      setError(null);
      setMaxRefundablePennies(eligibility.maxRefundablePennies);
      setRefundAmountPennies(eligibility.maxRefundablePennies);
    });
    return () => {
      cancelled = true;
    };
  }, [open, jobId]);

  const confirm = () => {
    setError(null);
    start(async () => {
      const result = await processRefund(jobId, refundAmountPennies);
      if (!result.success) {
        haptics.error();
        setError(result.error);
        return;
      }
      haptics.success();
      toast(
        result.newState === "refunded"
          ? `Refunded ${gbp(refundAmountPennies)} to ${customerName}`
          : `Refunded ${gbp(refundAmountPennies)} — part of this job is still paid`,
      );
      // The button lands on its terminal label BEFORE the navigation fires, so
      // a slow router.push can never strand it mid-spin.
      setRefunded(true);
      if (!isMounted.current) return;
      navigationTimer.current = setTimeout(() => {
        if (!isMounted.current) return;
        navigationTimer.current = null;
        router.push(`/jobs/${jobId}?sent=refunded`);
      }, 450);
    });
  };

  const busy = pending || checking;
  const canConfirm =
    !busy && !refunded && refundAmountPennies > 0 && refundAmountPennies <= maxRefundablePennies;

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
          aria-label="Refund this payment"
          onClick={() => !busy && !refunded && setOpen(false)}
        >
          <div
            className="flex w-full max-w-md flex-col gap-4 rounded-t-2xl bg-surface p-5 pb-safe shadow-hover sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-col gap-1">
              <h2 className="text-lg font-semibold">Refund {customerName}</h2>
              <p className="text-sm text-text-secondary">
                Send back all or part of what {customerName} paid you.
              </p>
            </div>

            <label htmlFor="refund-amount" className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-text-secondary">
                How much are you sending back?
              </span>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-text-secondary">
                  £
                </span>
                <input
                  id="refund-amount"
                  type="number"
                  value={(refundAmountPennies / 100).toFixed(2)}
                  min={0.01}
                  max={maxRefundablePennies / 100}
                  step={0.01}
                  disabled={busy || refunded}
                  onChange={(e) => {
                    const pounds = parseFloat(e.target.value);
                    setRefundAmountPennies(
                      Number.isFinite(pounds) ? Math.round(pounds * 100) : 0,
                    );
                  }}
                  className="h-11 w-full rounded-control border border-border bg-surface pl-7 pr-3 text-sm text-foreground"
                />
              </div>
              <span className="text-xs text-text-muted">
                {checking
                  ? "Checking what's still refundable…"
                  : `Most you can send back: ${gbp(maxRefundablePennies)}`}
              </span>
            </label>

            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy || refunded || maxRefundablePennies <= 0}
                onClick={() => setRefundAmountPennies(maxRefundablePennies)}
                className={`flex-1 rounded-control border px-3 py-2 text-sm ${
                  refundAmountPennies === maxRefundablePennies && maxRefundablePennies > 0
                    ? "border-primary bg-primary/5 font-medium text-foreground"
                    : "border-border bg-surface text-text-secondary"
                }`}
              >
                Everything
              </button>
              <button
                type="button"
                disabled={busy || refunded || maxRefundablePennies <= 0}
                onClick={() => setRefundAmountPennies(Math.round(maxRefundablePennies / 2))}
                className={`flex-1 rounded-control border px-3 py-2 text-sm ${
                  maxRefundablePennies > 0 &&
                  refundAmountPennies === Math.round(maxRefundablePennies / 2) &&
                  refundAmountPennies !== maxRefundablePennies
                    ? "border-primary bg-primary/5 font-medium text-foreground"
                    : "border-border bg-surface text-text-secondary"
                }`}
              >
                Half
              </button>
            </div>

            {/* The card's central requirement: the consequence, before the
                confirm, in words a person reads rather than skips. */}
            <div className="rounded-card bg-surface-hover p-3 text-sm text-text-secondary">
              <p className="mb-1 font-medium text-foreground">
                This comes out of your account
              </p>
              <p>
                {gbp(refundAmountPennies)} goes back to {customerName} from your Stripe
                balance. If you&apos;ve already been paid out, that balance will go
                negative and the next payment you take will cover it. Motko&apos;s fee on
                this job isn&apos;t returned.
              </p>
            </div>

            {error && <p className="text-sm text-error">{error}</p>}

            <div className="flex flex-col gap-2">
              <Button type="button" variant="primary" disabled={!canConfirm} onClick={confirm}>
                {refunded
                  ? "Refunded ✓"
                  : pending
                    ? "Sending it back…"
                    : `Refund ${gbp(refundAmountPennies)}`}
              </Button>
              <Button
                type="button"
                variant="tertiary"
                disabled={busy || refunded}
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
