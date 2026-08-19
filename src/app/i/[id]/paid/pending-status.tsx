"use client";

import { useEffect, useState } from "react";
import { formatGBP } from "@/lib/format";

// The pending half of the payment-return page.
//
// Stripe sends the customer here the moment they come back from their bank,
// which is before payment_intent.succeeded has settled anything. The page is
// right to refuse to claim payment it cannot see — but it used to say
// "Payment pending" and then stop, forever, with no polling and no prompt to
// reload. The overwhelmingly common case is someone who HAS paid, looking at a
// page that would confirm it if they refreshed and never tells them to. The
// worst case is someone whose payment failed being told there is nothing else
// they need to do.
//
// Only this branch is a client component. An invoice that is already settled
// renders as a receipt on the server and must not pay for this bundle.

type PaymentState = "paid" | "processing" | "failed" | "unknown";

type StatusResponse = {
  state: PaymentState;
  amount: number | null;
  paidAt: string | null;
};

// Pay by Bank usually settles in seconds. Poll tightly while that is the live
// question, then back off, then stop: a page left polling forever is a page
// nobody closes and a request nobody stops paying for.
const FAST_INTERVAL_MS = 3_000;
const SLOW_INTERVAL_MS = 10_000;
const FAST_PHASE_MS = 30_000;
const CEILING_MS = 3 * 60_000;

type Resolution = "pending" | "paid" | "failed" | "timeout";

export const PendingStatus = ({
  invoiceId,
  companyName,
}: {
  invoiceId: string;
  companyName: string | null;
}) => {
  const [resolution, setResolution] = useState<Resolution>("pending");
  const [amount, setAmount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();

    const poll = async () => {
      if (cancelled) return;

      try {
        const res = await fetch(`/api/invoices/${invoiceId}/payment-status`, {
          cache: "no-store",
        });
        if (res.ok) {
          const json = (await res.json()) as StatusResponse;
          if (cancelled) return;

          if (json.state === "paid") {
            setAmount(json.amount);
            setResolution("paid");
            return; // terminal — no further polling
          }
          if (json.state === "failed") {
            setResolution("failed");
            return; // terminal
          }
        }
      } catch {
        // A dropped request is not an answer. Stay pending and try again on
        // the next tick; the ceiling below is what ends this, not one failure.
      }

      if (cancelled) return;

      const elapsed = Date.now() - startedAt;
      if (elapsed >= CEILING_MS) {
        setResolution("timeout");
        return;
      }

      timer = setTimeout(poll, elapsed < FAST_PHASE_MS ? FAST_INTERVAL_MS : SLOW_INTERVAL_MS);
    };

    void poll();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [invoiceId]);

  if (resolution === "paid") {
    return (
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Payment received</h1>
        {amount !== null && (
          <p className="text-sm text-text-secondary">
            You paid {formatGBP(amount)}
            {companyName ? ` to ${companyName}` : ""}
          </p>
        )}
      </div>
    );
  }

  if (resolution === "failed") {
    return (
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Payment not completed</h1>
        <p className="text-sm text-text-secondary">
          Your bank didn&apos;t complete the payment, so nothing has been taken.
        </p>
        <p className="text-sm text-text-secondary">
          <a href={`/i/${invoiceId}`} className="font-medium text-primary underline">
            The invoice is still open
          </a>{" "}
          if you&apos;d like to try again.
        </p>
      </div>
    );
  }

  if (resolution === "timeout") {
    // Deliberately NOT a failure. An unconfirmed payment is not a failed one,
    // and telling someone it failed is how you get paid twice.
    return (
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Still waiting on your bank</h1>
        <p className="text-sm text-text-secondary">
          We haven&apos;t had confirmation yet. Your payment may still go through — please
          don&apos;t pay again.
        </p>
        <p className="text-sm text-text-secondary">
          Reopen this page later to check, or{" "}
          <a href={`/i/${invoiceId}`} className="font-medium text-primary underline">
            view the invoice
          </a>
          .
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-2xl font-semibold">Payment pending</h1>
      <p className="text-sm text-text-secondary">
        We&apos;re waiting for confirmation from your bank. This can take a few moments —
        there&apos;s nothing else you need to do, and this page will update on its own.
      </p>
      <p className="text-sm text-text-secondary">
        If you didn&apos;t finish paying,{" "}
        <a href={`/i/${invoiceId}`} className="font-medium text-primary underline">
          the invoice is still open
        </a>
        .
      </p>
    </div>
  );
};
