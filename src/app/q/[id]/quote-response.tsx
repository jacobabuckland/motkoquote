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
  const [isPending, startTransition] = useTransition();

  if (currentStatus === "accepted") {
    return <p className="text-sm font-medium text-success">You accepted this quote.</p>;
  }

  if (currentStatus === "declined") {
    return <p className="text-sm font-medium text-text-secondary">You declined this quote.</p>;
  }

  return (
    <div className="flex gap-3">
      <Button
        type="button"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            await acceptQuote(quoteId);
            setCurrentStatus("accepted");
          })
        }
      >
        Accept quote
      </Button>
      <Button
        type="button"
        variant="secondary"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            await declineQuote(quoteId);
            setCurrentStatus("declined");
          })
        }
      >
        Decline
      </Button>
    </div>
  );
};
