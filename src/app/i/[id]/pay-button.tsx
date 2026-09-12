"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { formatGBP } from "@/lib/format";
import { BankTransferDetails } from "./bank-transfer-details";
import { describePayFailure } from "@/lib/pay-failure";
import type { TransferDetails } from "./pay-panel";

type PayError = { message: string; retryable: boolean };

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
  const [error, setError] = useState<PayError | null>(null);
  // Fetched on demand, never on mount. Bank details are a fee-free route around
  // the Stripe rail, so they are offered only once the rail has actually failed
  // this customer — but then they are offered, because the alternative is a
  // customer who cannot pay at all.
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
      // The card error has been answered: the customer asked for another way
      // to pay and now has one. Leaving it up means the bank details arrive
      // underneath a red line still saying the payment failed, which reads as
      // "this route is broken too" at the exact moment we need it trusted.
      // Cleared only on SUCCESS — if the details did not load, transferError
      // is what shows and the card error is still the relevant history.
      setError(null);
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
        return;
      }

      const { loadStripe } = await import("@stripe/stripe-js");
      const stripe = await loadStripe(json.publishableKey);
      if (!stripe) {
        setError({
          message: "Couldn't load payment provider. Please try again.",
          retryable: true,
        });
        setLoading(false);
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
      }
    } catch {
      setError({
        message: "Couldn't start the payment. Please try again.",
        retryable: true,
      });
      setLoading(false);
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
            {/* The retry half is dropped for the above-ceiling case rather than
                reworded, because pressing the button again there cannot
                succeed — and that message already ends "Please use bank
                transfer", so the route out is stated once, by the line that
                knows why. */}
            {error.retryable && " You can try again, or pay by bank transfer below."}
          </p>
        </div>
      )}
      <Button
        variant="primary"
        onClick={onPay}
        disabled={loading}
        className="w-full"
      >
        {loading ? "Connecting to your bank…" : buttonLabel}
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
