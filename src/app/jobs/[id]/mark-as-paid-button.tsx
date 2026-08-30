"use client";

import { useState, useTransition, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { formatGBP } from "@/lib/format";
import { markPaidFeeLine } from "@/lib/fee-copy";
import { markInvoicePaid } from "@/app/jobs/[id]/mark-paid-actions";
import * as haptics from "@/lib/haptics";
import {
  getLocalDateString,
  getLocalDateBefore,
  MAX_BACKDATE_DAYS,
} from "@/lib/mark-paid-date";

type PaymentMethod = "cash" | "bank_transfer" | "other";

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "other", label: "Other" },
];

type Props = {
  invoiceId: string;
  jobId?: string;
  customerName: string;
  // The trade's free-job allowance remaining right now — drives whether this job
  // is free or will accrue a fee.
  freeJobsRemaining: number;
  // The job's total, used only to show which fee band would apply (£2 / £4).
  quoteTotal: number;
  // Compact text trigger for dense list rows (dashboard); defaults to the full
  // secondary button used on the job page. Never primary either way.
  asLink?: boolean;
};

export const MarkAsPaidButton = ({
  invoiceId,
  jobId,
  customerName,
  freeJobsRemaining,
  quoteTotal,
  asLink = false,
}: Props) => {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [paidOn, setPaidOn] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // Terminal success state, per the settled end-state pattern. Takes precedence
  // over the pending spinner in the button label.
  const [paid, setPaid] = useState(false);
  // Holds the terminal state visible for ~450ms before navigating.
  const navigationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track mount state to prevent setting timer after unmount.
  const isMounted = useRef(true);

  // Compute date bounds using lazy state initializer (satisfies purity lint —
  // Date.now() called once on mount, not on every render)
  const [{ minDate, maxDate }] = useState(() => {
    const now = Date.now();
    return {
      minDate: getLocalDateBefore(now, MAX_BACKDATE_DAYS),
      maxDate: getLocalDateString(now),
    };
  });

  // Clear timer on unmount so a navigation cannot fire from a torn-down component.
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

  const feeLine = markPaidFeeLine({
    freeJobsRemaining,
    quoteTotalPounds: quoteTotal,
  });

  const confirm = () => {
    setError(null);
    setPaid(false);
    start(async () => {
      const res = await markInvoicePaid({
        invoiceId,
        paymentMethod: method,
        ...(paidOn ? { paidOn } : {}),
      });
      if ("error" in res) {
        haptics.error();
        setError(res.error);
        setPaid(false);
        return;
      }
      haptics.success();
      toast("Marked as paid");
      // Terminal "Paid ✓" FIRST, then schedule navigation.
      setPaid(true);
      if (jobId && isMounted.current) {
        navigationTimer.current = setTimeout(() => {
          if (!isMounted.current) return;
          navigationTimer.current = null;
          router.push(`/jobs/${jobId}?sent=paid`);
        }, 450);
      } else if (!jobId) {
        // Fallback to old behavior if jobId is missing.
        setOpen(false);
        router.refresh();
      }
    });
  };

  return (
    <>
      {asLink ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-sm font-medium text-primary hover:text-primary-hover hover:underline"
        >
          Mark as paid
        </button>
      ) : (
        <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
          Mark as paid
        </Button>
      )}

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-label="Mark invoice as paid"
          onClick={() => !pending && setOpen(false)}
        >
          <div
            className="flex w-full max-w-md flex-col gap-4 rounded-t-2xl bg-surface p-5 pb-safe shadow-hover sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-col gap-1">
              <h2 className="text-lg font-semibold">How did they pay?</h2>
              <p className="text-sm text-text-secondary">
                Record a payment {customerName} made outside the app.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              {METHODS.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => setMethod(m.value)}
                  aria-pressed={method === m.value}
                  className={`flex h-11 items-center rounded-control border px-3 text-sm ${
                    method === m.value
                      ? "border-primary bg-primary/5 font-medium text-foreground"
                      : "border-border bg-surface text-text-secondary"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>

            <label htmlFor="paid-on" className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-text-secondary">
                When did they pay? (optional)
              </span>
              <input
                id="paid-on"
                type="date"
                value={paidOn}
                min={minDate}
                max={maxDate}
                onChange={(e) => setPaidOn(e.target.value)}
                className="h-11 rounded-control border border-border bg-surface px-3 text-sm text-foreground"
              />
              <span className="text-xs text-text-muted">Leave blank for today.</span>
            </label>

            <div className="rounded-card bg-surface-hover p-3 text-sm text-text-secondary">
              <p className="mb-1">{feeLine}</p>
              <p>
                This closes the job ({formatGBP(quoteTotal)}) and stops payment
                reminders to {customerName}.
              </p>
            </div>

            {error && <p className="text-sm text-error">{error}</p>}

            <div className="flex flex-col gap-2">
              <Button type="button" variant="primary" disabled={pending || paid} onClick={confirm}>
                {paid ? "Paid ✓" : pending ? "Marking as paid…" : "Mark as paid"}
              </Button>
              <Button
                type="button"
                variant="tertiary"
                disabled={pending || paid}
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
};
