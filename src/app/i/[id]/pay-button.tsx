"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { formatGBP } from "@/lib/format";
import { BankTransferDetails } from "./bank-transfer-details";
import type { TransferDetails } from "./pay-panel";

// What the customer is told, in plain words, and whether pressing the button
// again could possibly help. The raw provider string is not surfaced: on this
// screen it is either our own generic fallback (which carries no information)
// or a rail message written for a developer. What a customer needs at this
// moment is what happened, what it means for their money, and the way out.
type PayError = { headline: string; retryable: boolean };

const RAIL_FAILURE: PayError = {
  headline: "We couldn't reach your bank",
  retryable: true,
};

// Above the online ceiling. Nothing was charged, but pressing the button again
// cannot succeed, so the retry half of the copy is withheld and the transfer
// route is stated instead.
const ABOVE_CEILING: PayError = {
  headline: "This invoice is above the online payment limit",
  retryable: false,
};

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
        setError(ABOVE_CEILING);
        setLoading(false);
        return;
      }

      if (!res.ok || !json.clientSecret || !json.publishableKey) {
        setError(RAIL_FAILURE);
        setLoading(false);
        return;
      }

      const { loadStripe } = await import("@stripe/stripe-js");
      const stripe = await loadStripe(json.publishableKey);
      if (!stripe) {
        setError(RAIL_FAILURE);
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
        setError(RAIL_FAILURE);
        setLoading(false);
      }
    } catch {
      setError(RAIL_FAILURE);
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
          <p className="text-sm font-semibold text-red">{error.headline}</p>
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
