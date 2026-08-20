"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { formatGBP } from "@/lib/format";
import { markPaidFeeLine } from "@/lib/fee-copy";
import { markInvoicePaid } from "./mark-paid-actions";
import * as haptics from "@/lib/haptics";

type PaymentMethod = "cash" | "bank_transfer" | "other";

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "other", label: "Other" },
];

type Props = {
  invoiceId: string;
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

// Yesterday-safe local date bounds for the backdate picker (matches the server's
// 90-day window).
const todayIso = () => new Date().toISOString().slice(0, 10);
const minIso = () =>
  new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);

export const MarkAsPaidButton = ({
  invoiceId,
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

  const feeLine = markPaidFeeLine({
    freeJobsRemaining,
    quoteTotalPounds: quoteTotal,
  });

  const confirm = () => {
    setError(null);
    start(async () => {
      const res = await markInvoicePaid({
        invoiceId,
        paymentMethod: method,
        ...(paidOn ? { paidOn } : {}),
      });
      if ("error" in res) {
        haptics.error();
        setError(res.error);
        return;
      }
      haptics.success();
      setOpen(false);
      toast("Marked as paid");
      router.refresh();
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
                min={minIso()}
                max={todayIso()}
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
              <Button type="button" variant="primary" disabled={pending} onClick={confirm}>
                {pending ? "Marking as paid…" : "Mark as paid"}
              </Button>
              <Button
                type="button"
                variant="tertiary"
                disabled={pending}
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
