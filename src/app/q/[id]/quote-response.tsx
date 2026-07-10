"use client";

import { useState, useTransition } from "react";
import { acceptQuote, declineQuote } from "./actions";

type Props = {
  quoteId: string;
  status: string;
};

export const QuoteResponse = ({ quoteId, status }: Props) => {
  const [currentStatus, setCurrentStatus] = useState(status);
  const [isPending, startTransition] = useTransition();

  if (currentStatus === "accepted") {
    return <p className="text-sm text-green-700 font-medium">You accepted this quote.</p>;
  }

  if (currentStatus === "declined") {
    return <p className="text-sm text-neutral-500 font-medium">You declined this quote.</p>;
  }

  return (
    <div className="flex gap-3">
      <button
        type="button"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            await acceptQuote(quoteId);
            setCurrentStatus("accepted");
          })
        }
        className="bg-black text-white rounded-md px-4 py-2 text-sm disabled:opacity-50"
      >
        Accept quote
      </button>
      <button
        type="button"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            await declineQuote(quoteId);
            setCurrentStatus("declined");
          })
        }
        className="border rounded-md px-4 py-2 text-sm disabled:opacity-50"
      >
        Decline
      </button>
    </div>
  );
};
