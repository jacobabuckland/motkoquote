"use client";

import { useState, useTransition } from "react";
import { acceptQuote, declineQuote } from "./actions";
import { Button } from "@/components/ui/button";

type Props = {
  quoteId: string;
  status: string;
};

export const QuoteResponse = ({ quoteId, status }: Props) => {
  const [currentStatus, setCurrentStatus] = useState(status);
  const [pendingAction, setPendingAction] = useState<"accept" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (currentStatus === "accepted") {
    return <p className="text-sm font-medium text-success">You accepted this quote.</p>;
  }

  if (currentStatus === "declined") {
    return <p className="text-sm font-medium text-text-secondary">You declined this quote.</p>;
  }

  const respond = (action: "accept" | "decline") => {
    setError(null);
    setPendingAction(action);
    startTransition(async () => {
      try {
        if (action === "accept") {
          await acceptQuote(quoteId);
          setCurrentStatus("accepted");
        } else {
          await declineQuote(quoteId);
          setCurrentStatus("declined");
        }
      } catch {
        setError("Something went wrong — please try again.");
        setPendingAction(null);
      }
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-3">
        <Button type="button" disabled={isPending} onClick={() => respond("accept")}>
          {isPending && pendingAction === "accept" ? "Accepting…" : "Accept quote"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={isPending}
          onClick={() => respond("decline")}
        >
          {isPending && pendingAction === "decline" ? "Declining…" : "Decline quote"}
        </Button>
      </div>
      {error && <p className="text-sm text-error">{error}</p>}
    </div>
  );
};
