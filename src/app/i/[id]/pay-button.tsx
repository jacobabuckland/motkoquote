"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { formatGBP } from "@/lib/format";
import { BankTransferDetails } from "./bank-transfer-details";

type TransferDetails = {
  accountHolderName: string;
  sortCode: string;
  accountNumber: string;
  amount: string;
  reference: string;
};

export const PayButton = ({
  invoiceId,
  amount,
}: {
  invoiceId: string;
  amount?: number | null;
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showTransferFallback, setShowTransferFallback] = useState(false);
  const [transferDetails, setTransferDetails] = useState<TransferDetails | null>(null);
  const [loadingTransferDetails, setLoadingTransferDetails] = useState(false);

  const fetchTransferDetails = async () => {
    setLoadingTransferDetails(true);
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/transfer-details`);
      if (res.ok) {
        const details = (await res.json()) as TransferDetails;
        setTransferDetails(details);
      }
    } catch {
      // Fail silently - the customer already has an error message
    } finally {
      setLoadingTransferDetails(false);
    }
  };

  const onPay = async () => {
    setLoading(true);
    setError(null);
    setShowTransferFallback(false);
    setTransferDetails(null);
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
        setShowTransferFallback(true);
        setLoading(false);
        return;
      }

      if (!res.ok || !json.clientSecret || !json.publishableKey) {
        setError(json.error ?? "Couldn't start the payment. Please try again.");
        setShowTransferFallback(true);
        setLoading(false);
        return;
      }

      const { loadStripe } = await import("@stripe/stripe-js");
      const stripe = await loadStripe(json.publishableKey);
      if (!stripe) {
        setError("Couldn't load payment provider. Please try again.");
        setShowTransferFallback(true);
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
        setShowTransferFallback(true);
        setLoading(false);
      }
    } catch {
      setError("Couldn't start the payment. Please try again.");
      setShowTransferFallback(true);
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
      {showTransferFallback && !transferDetails && (
        <button
          type="button"
          onClick={fetchTransferDetails}
          disabled={loadingTransferDetails}
          className="inline-flex min-h-11 items-center justify-center text-sm font-semibold text-ink-secondary underline underline-offset-4 transition-colors duration-150 hover:text-ink active:text-ink disabled:opacity-50"
        >
          {loadingTransferDetails
            ? "Loading transfer details…"
            : "Pay by bank transfer instead"}
        </button>
      )}
      {transferDetails && (
        <div className="mt-2">
          <BankTransferDetails {...transferDetails} />
        </div>
      )}
    </div>
  );
};
