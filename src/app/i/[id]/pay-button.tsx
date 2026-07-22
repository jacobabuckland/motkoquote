"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

// Mints a TrueLayer payment at press time and sends the customer to the Hosted
// Payment Page to authorise it with their bank. Kept as late as possible because
// TrueLayer payments expire ~15 min after creation.
export const PayButton = ({ invoiceId }: { invoiceId: string }) => {
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

  return (
    <div className="flex flex-col gap-2">
      <Button variant="primary" onClick={onPay} disabled={loading}>
        {loading ? "Connecting to your bank…" : "Pay by bank"}
      </Button>
      {error && <p className="text-sm text-error">{error}</p>}
    </div>
  );
};
