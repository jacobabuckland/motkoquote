"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { withdrawContract } from "../actions";
import * as haptics from "@/lib/haptics";

type Props = {
  contractId: string;
};

export const WithdrawContractButton = ({ contractId }: Props) => {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  // Terminal success state, per the settled end-state pattern. Takes precedence
  // over the pending spinner in the button label.
  const [withdrawn, setWithdrawn] = useState(false);

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
          // Promises only what the product can currently do. Editing the quote
          // works from this commit; SENDING a new contract does not, because
          // `contracts.quote_id` is UNIQUE and the withdrawn row still holds
          // the slot (pass-13 CRITICAL 1). The old copy promised both, the
          // second attempt then reported "Sent ✓" without creating anything,
          // and the contractor waited for a signature that could not arrive.
          // The sentence goes back the moment migration 83 lands re-issue.
          toast("Contract withdrawn. You can now edit the quote.");
        }, 450);
      } catch (error) {
        await haptics.error();
        const message =
          error instanceof Error ? error.message : "Failed to withdraw contract";
        toast(message);
      }
    });
  };

  const label = withdrawn ? "Withdrawn ✓" : pending ? "Withdrawing..." : "Withdraw contract";

  return (
    <Button
      onClick={handleWithdraw}
      variant="tertiary"
      disabled={pending || withdrawn}
    >
      {label}
    </Button>
  );
};
