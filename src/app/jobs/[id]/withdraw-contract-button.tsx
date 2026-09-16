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
          toast("Contract withdrawn. You can now edit the quote and send a new contract.");
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
