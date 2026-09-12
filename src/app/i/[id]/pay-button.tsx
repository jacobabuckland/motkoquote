"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { formatGBP } from "@/lib/format";
import { BankTransferDetails } from "./bank-transfer-details";
import { describePayFailure, type PayFailure } from "@/lib/pay-failure";
import type { TransferDetails } from "./pay-panel";

// Every customer-facing failure string lives in lib/pay-failure.ts, which owns
// the rule that no provider text reaches a customer. This screen had its own
// two headlines for a while; that module says the same thing with more
// resolution — it distinguishes a bank that declined from the SENDER's account
// being misconfigured, which is the difference between "try again" and "this
// is not yours to fix" — so it wins.
export const PayButton = ({
  invoiceId,
  amount,
  companyName,
}: {
  invoiceId: string;
  amount?: number | null;
  companyName?: string;
}) => {
  const [loading, setLoading] = useState(false);
  // `retryable` is the difference between "the rail dropped the call" and "this
  // invoice is above the online ceiling". Both mean nothing was charged, but
  // only one is worth pressing the button again for — telling a customer to
  // retry a payment that cannot succeed is worse than saying nothing.
  const [error, setError] = useState<PayFailure | null>(null);
  // Fetched only after a failure, never on mount — that half of the PAY-4
  // rail-gating contract is unchanged and is what keeps a fee-free route from
  // being handed to customers who never needed it.
  //
  // What changed on 12 Sep: once the rail HAS failed, the details now open
  // themselves rather than waiting behind a text link. A customer who has just
  // been told a payment did not go through should not have to find a second
  // control to discover there is another way — and by that point the rail has
  // already refused them, which is the condition the contract is really about.
  const [transfer, setTransfer] = useState<TransferDetails | null>(null);
  const [transferError, setTransferError] = useState<string | null>(null);

  const revealTransfer = async () => {
    setTransferError(null);
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/transfer-details`, {
        cache: "no-store",
      });
      if (!res.ok) {
        setTransferError(
          `Couldn't load the bank details. Please contact ${companyName ?? "the sender"} to pay.`,
        );
        return;
      }
      setTransfer((await res.json()) as TransferDetails);
      // The error is NOT cleared here, and that is a change of mind worth
      // recording. It used to be: the customer asked for another way to pay,
      // got one, so the red line had been answered and leaving it up read as
      // "this route is broken too".
      //
      // The panel no longer reads that way. It now ends "...or pay by bank
      // transfer below", so it is the signpost that sent them here rather than
      // a contradiction of what they are looking at — and it is the only thing
      // on screen explaining why the bank details appeared at all. The spec's
      // state machine says the same: a failed attempt stays failed until the
      // next attempt starts. `onPay` clears it, and nothing else does.
    } catch {
      setTransferError(
        `Couldn't load the bank details. Please contact ${companyName ?? "the sender"} to pay.`,
      );
    }
  };

  const onPay = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/stripe/create-payment-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceId }),
      });
      const json = (await res.json()) as {
        clientSecret?: string;
        publishableKey?: string;
        error?: string;
        code?: string;
      };

      if (res.status === 422 && json.code === "AMOUNT_TOO_HIGH") {
        setError({
          message:
            "This invoice amount exceeds the online payment limit. Please use bank transfer.",
          retryable: false,
        });
        setLoading(false);
        void revealTransfer();
        return;
      }

      if (!res.ok || !json.clientSecret || !json.publishableKey) {
        // The route's own messages are written for this screen and are safe to
        // show. It already refuses to forward a provider message on a failed
        // create (route.ts returns a fixed line from its catch), so this is the
        // app talking, not Stripe.
        setError({
          message: json.error ?? "Couldn't start the payment. Please try again.",
          retryable: true,
        });
        setLoading(false);
        void revealTransfer();
        return;
      }

      const { loadStripe } = await import("@stripe/stripe-js");
      const stripe = await loadStripe(json.publishableKey);
      if (!stripe) {
        setError(describePayFailure(null));
        setLoading(false);
        void revealTransfer();
        return;
      }

      const { error: confirmError } = await stripe.confirmPayment({
        clientSecret: json.clientSecret,
        confirmParams: {
          return_url: `${window.location.origin}/i/${invoiceId}/paid`,
        },
      });

      if (confirmError) {
        // NEVER `confirmError.message`. That put Stripe's own API text — with
        // backticks, parameter names and two capability names in it — on a
        // customer's invoice on 12 Sep. The real message goes to the console
        // for whoever is debugging; the customer gets copy we own.
        console.error("Payment confirmation failed:", confirmError);
        setError(describePayFailure(confirmError));
        setLoading(false);
        void revealTransfer();
      }
    } catch {
      setError(describePayFailure(null));
      setLoading(false);
      void revealTransfer();
    }
  };

  if (process.env.NODE_ENV === "development" && amount == null) {
    console.warn("PayButton: null amount for invoice", invoiceId);
  }

  // The money rule applies inside the label too: the amount is set in the
  // display face with tabular figures, the surrounding words are not. The
  // accessible name is unchanged — "Pay £8,132.00 by bank".
  // Wrapped in a single span on purpose: Button is `inline-flex ... gap-2`, so
  // a bare fragment would make "Pay", the amount and "by bank" three flex items
  // and add 8px of gap either side of the figure.
  const buttonLabel =
    amount != null ? (
      <span>
        Pay <span className="display">{formatGBP(amount)}</span> by bank
      </span>
    ) : (
      "Pay by bank"
    );

  return (
    <div className="flex flex-col gap-2">
      {/* ABOVE the button, and a contained panel rather than a loose red line.
          A customer who has just had a payment fail reads downward from the
          thing they pressed; an explanation under the button is found after
          they have already decided something went wrong and started looking
          for a way out.

          "Nothing has been charged" leads, because at this moment it is the
          question the customer actually has — not what failed, but whether
          they have just paid twice. It is unconditionally true here: every
          path that sets this error is one where no charge was created, and
          a successful confirmPayment redirects away rather than landing
          here. */}
      {error && (
        <div
          role="alert"
          className="flex flex-col gap-1 rounded-card border border-red bg-red-tint p-4"
        >
          <p className="text-sm font-semibold text-red">{error.message}</p>
          <p className="text-sm text-red">
            <strong className="font-semibold">Nothing has been charged.</strong>
            {/* Both branches end with the route out, which is the third thing
                an error panel owes the reader. Only the retry half is
                conditional: above the ceiling, pressing the button again
                cannot succeed, and telling someone to retry a payment that
                cannot work is worse than saying nothing. */}
            {error.retryable
              ? " You can try again, or pay by bank transfer below."
              : " Pay by bank transfer below."}
          </p>
        </div>
      )}
      <Button
        variant="primary"
        onClick={onPay}
        disabled={loading}
        className="w-full"
      >
        {loading
          ? "Connecting to your bank…"
          : error?.retryable
            ? "Try paying by bank again"
            : buttonLabel}
      </Button>

      {/* Only after a failed attempt. The rail was available, so the customer
          was never shown bank details; now that it has not worked for them,
          they must still have a way to pay. */}
      {error && !transfer && (
        <button
          type="button"
          onClick={revealTransfer}
          className="inline-flex min-h-11 items-center self-start text-sm font-semibold text-ink-secondary underline underline-offset-4 transition-colors duration-150 hover:text-ink active:text-ink"
        >
          Pay by bank transfer instead
        </button>
      )}
      {transferError && (
        <div
          role="alert"
          className="flex flex-col gap-1 rounded-card border border-red bg-red-tint p-4"
        >
          <p className="text-sm font-semibold text-red">{transferError}</p>
        </div>
      )}
      {transfer && (
        <div className="mt-2 flex flex-col gap-2">
          <p className="display text-lg font-bold">Pay by bank transfer</p>
          <BankTransferDetails {...transfer} />
        </div>
      )}
    </div>
  );
};
