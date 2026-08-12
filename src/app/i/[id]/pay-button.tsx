"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { formatGBP } from "@/lib/format";

// Mints a TrueLayer payment at press time and sends the customer to the Hosted
// Payment Page to authorise it with their bank. Kept as late as possible because
// TrueLayer payments expire ~15 min after creation.
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
      const res = await fetch("/api/truelayer/create-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceId }),
      });
      const json = (await res.json()) as { hostedPageUrl?: string; error?: string };
      if (!res.ok || !json.hostedPageUrl) {
        setError(json.error ?? "Couldn't start the payment. Please try again.");
        setLoading(false);
        return;
      }
      window.location.href = json.hostedPageUrl;
    } catch {
      setError("Couldn't start the payment. Please try again.");
      setLoading(false);
    }
  };

  // Build button label: include amount if present and not null
  if (process.env.NODE_ENV === "development" && amount == null) {
    console.warn("PayButton: null amount for invoice", invoiceId);
  }
  const buttonLabel =
    amount != null ? `Pay ${formatGBP(amount)} by bank` : "Pay by bank";

  return (
    <div className="flex flex-col gap-2">
      <Button variant="primary" onClick={onPay} disabled={loading}>
        {loading ? "Connecting to your bank…" : buttonLabel}
      </Button>
      {error && <p className="text-sm text-error">{error}</p>}
    </div>
  );
};
