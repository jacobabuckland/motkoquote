"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { formatGBP } from "@/lib/format";

export const PayButton = ({
  invoiceId,
  amount,
}: {
  invoiceId: string;
  amount?: number | null;
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        setError("This invoice amount exceeds the online payment limit. Please use bank transfer.");
        setLoading(false);
        return;
      }

      if (!res.ok || !json.clientSecret || !json.publishableKey) {
        setError(json.error ?? "Couldn't start the payment. Please try again.");
        setLoading(false);
        return;
      }

      const { loadStripe } = await import("@stripe/stripe-js");
      const stripe = await loadStripe(json.publishableKey);
      if (!stripe) {
        setError("Couldn't load payment provider. Please try again.");
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
        setError(confirmError.message ?? "Payment failed. Please try again.");
        setLoading(false);
      }
    } catch {
      setError("Couldn't start the payment. Please try again.");
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
      <Button
        variant="primary"
        onClick={onPay}
        disabled={loading}
        className="w-full"
      >
        {loading ? "Connecting to your bank…" : buttonLabel}
      </Button>
      {error && <p className="text-sm text-red">{error}</p>}
    </div>
  );
};
