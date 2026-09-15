"use client";

import { useState, useTransition } from "react";
import { acceptQuote, declineQuote } from "./actions";
import { Button } from "@/components/ui/button";
import { UNPRICED_ACCEPT_BLOCKED } from "@/lib/unpriced-quote-copy";

type Props = {
  quoteId: string;
  status: string;
  // False when a line on this quote has no figure behind it. A customer cannot
  // agree to a price the document doesn't state, so the decision is withheld
  // rather than captured. Declining stays available — a customer who doesn't
  // want the work shouldn't be held hostage to the contractor finishing it.
  fullyPriced: boolean;
};

export const QuoteResponse = ({ quoteId, status, fullyPriced }: Props) => {
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

  // ANYTHING ELSE THAT IS NOT AWAITING A DECISION. `acceptQuote` and
  // `declineQuote` both require status "sent", so offering the buttons on a
  // quote in any other state produces a press that changes nothing — and, until
  // they reported their outcome, a page that then claimed it had worked.
  //
  // Quote B3112196 was ARCHIVED by the contractor and still served both buttons
  // (reported 15 Sep). Archiving withdraws a quote from the pipeline, so a
  // customer accepting one binds a trade who is no longer looking at it.
  //
  // Read as "not open" rather than listing the closed states, so a status added
  // later is closed here by default instead of silently acquiring live buttons.
  if (currentStatus !== "sent") {
    return (
      <p className="text-sm font-medium text-text-secondary">
        This quote is no longer open for a response. Please contact us if you would still like
        the work done.
      </p>
    );
  }

  const respond = (action: "accept" | "decline") => {
    setError(null);
    setPendingAction(action);
    startTransition(async () => {
      try {
        // The RESULT decides what the page says. Assuming success is what let a
        // customer be told "You accepted this quote." when nothing was written.
        const result =
          action === "accept" ? await acceptQuote(quoteId) : await declineQuote(quoteId);
        if (result === "not_open") {
          setError(
            "This quote is no longer open for a response. Please contact us if you would " +
              "still like the work done.",
          );
          setPendingAction(null);
          return;
        }
        setCurrentStatus(action === "accept" ? "accepted" : "declined");
      } catch {
        setError("Something went wrong — please try again.");
        setPendingAction(null);
      }
    });
  };

  return (
    <div className="flex flex-col gap-2">
      {!fullyPriced && (
        <p className="text-sm font-medium">{UNPRICED_ACCEPT_BLOCKED}</p>
      )}
      <div className="flex gap-3">
        {fullyPriced && (
          <Button type="button" disabled={isPending} onClick={() => respond("accept")}>
            {isPending && pendingAction === "accept" ? "Accepting…" : "Accept quote"}
          </Button>
        )}
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
