"use client";

// PASS-13: withdrawing a live contract was a single tap with nothing in the way.
//
// The control renders only while the contract's status is `sent` — that is, in
// the one window where the customer is holding it and could sign it at any
// moment — and it sat directly beneath "Copy contract link" and "Download
// contract", two entirely safe buttons. A mis-tap voided the agreement, and
// `withdrawContract` sends the customer nothing, so nobody found out until
// somebody noticed.
//
// So it asks first, in the idiom this page already uses for its other
// consequential controls (mark-as-paid, refund): a bottom-sheet dialog stating
// the consequence ABOVE the confirm button rather than after it.
//
// The copy is checked against what the code actually does, because the comment
// further down this file is about copy that promised a capability which did not
// exist:
//
//   - the link keeps working; /c/[id] reads `status === "withdrawn"` and shows
//     "This contract has been withdrawn by <company>" with no signing UI, so
//     "they can't sign it" is true and "the link stops working" would not be;
//   - nothing is sent — `withdrawContract`'s own contract says "Does NOT
//     trigger any customer notifications" — which is worth telling the
//     contractor at the moment they decide, not least because it is the half
//     they cannot see from this screen;
//   - a replacement CAN be sent, as of migration 83.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { withdrawContract } from "../actions";
import * as haptics from "@/lib/haptics";

type Props = {
  contractId: string;
  /** The customer's first name, for the confirmation copy. */
  customerName?: string;
};

export const WithdrawContractButton = ({ contractId, customerName }: Props) => {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  // Terminal success state, per the settled end-state pattern. Takes precedence
  // over the pending spinner in the button label.
  const [withdrawn, setWithdrawn] = useState(false);

  const who = customerName?.trim() || "The customer";

  const handleWithdraw = () => {
    start(async () => {
      try {
        await withdrawContract(contractId);
        await haptics.success();
        setWithdrawn(true);

        // Refresh the page after a short delay to show the terminal state. The
        // settled end-state pattern: the button lands on "Withdrawn ✓" before
        // navigation fires, so a slow or wedged router.refresh never strands
        // the control mid-spin.
        setTimeout(() => {
          router.refresh();
          // Both halves are true again as of migration 83, which is applied on
          // production. The partial unique index stops a withdrawn contract
          // holding the quote's slot, so the insert behind "Send contract"
          // simply succeeds rather than colliding.
          //
          // The sentence was cut for one commit while that was NOT true: the
          // second attempt reported "Sent ✓" having created nothing, and the
          // contractor waited for a signature that could never arrive
          // (pass-13 CRITICAL 1). Copy that promises a capability is only
          // correct while the capability exists.
          toast("Contract withdrawn. You can now edit the quote and send a new contract.");
        }, 450);
      } catch (error) {
        await haptics.error();
        const message =
          error instanceof Error ? error.message : "Failed to withdraw contract";
        toast(message);
        // Back to the job page rather than leaving the sheet open over a
        // failure the toast is reporting behind it.
        setConfirming(false);
      }
    });
  };

  const label = withdrawn ? "Withdrawn ✓" : pending ? "Withdrawing..." : "Withdraw contract";

  return (
    <>
      <Button
        onClick={() => setConfirming(true)}
        variant="tertiary"
        disabled={pending || withdrawn}
      >
        {label}
      </Button>

      {confirming && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-label="Withdraw this contract"
          onClick={() => {
            if (!pending && !withdrawn) setConfirming(false);
          }}
        >
          <div
            className="flex w-full max-w-md flex-col gap-4 rounded-t-2xl bg-surface p-5 pb-safe shadow-hover sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold">Withdraw this contract?</h2>

            {/* The consequence, before the confirm, in words a person reads
                rather than skips. */}
            <div className="rounded-card bg-surface-hover p-3 text-sm text-text-secondary">
              {/* ONE text node, not `{who} won't …`. That form renders two
                  adjacent text nodes, and pass 14 read the result back as
                  "QAwon't be able to sign it" — the space is in the DOM (the
                  regression test asserts the whole sentence and passes), but
                  anything that walks child nodes and joins them without a
                  separator loses it, and a screen reader is one such thing.
                  Interpolating the sentence costs nothing and cannot split. */}
              <p className="mb-1 font-medium text-foreground">
                {`${who} won't be able to sign it`}
              </p>
              <p>
                Their link will say you&apos;ve withdrawn the contract. Motko doesn&apos;t
                email them about it, so tell them yourself if they&apos;re expecting to
                sign. You can edit the quote and send a replacement afterwards.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <Button
                type="button"
                variant="primary"
                disabled={pending || withdrawn}
                onClick={handleWithdraw}
              >
                {label}
              </Button>
              <Button
                type="button"
                variant="tertiary"
                disabled={pending || withdrawn}
                onClick={() => setConfirming(false)}
              >
                Keep the contract
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
