"use client";

import { useState, useTransition } from "react";
import { signContract, declineContract } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";

type Props = {
  contractId: string;
  status: string;
  signerName: string | null;
};

export const ContractResponse = ({ contractId, status, signerName }: Props) => {
  const [currentStatus, setCurrentStatus] = useState(status);
  const [currentSigner, setCurrentSigner] = useState(signerName);
  const [name, setName] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [pendingAction, setPendingAction] = useState<"sign" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (currentStatus === "signed") {
    return (
      <p className="text-sm font-medium text-success">
        Signed by {currentSigner ?? "you"}.
      </p>
    );
  }

  if (currentStatus === "declined") {
    return <p className="text-sm font-medium text-text-secondary">You declined this contract.</p>;
  }

  const sign = () => {
    setError(null);
    setPendingAction("sign");
    startTransition(async () => {
      try {
        await signContract(contractId, name.trim());
        setCurrentSigner(name.trim());
        setCurrentStatus("signed");
      } catch {
        setError("Something went wrong — please try again.");
        setPendingAction(null);
      }
    });
  };

  const decline = () => {
    setError(null);
    setPendingAction("decline");
    startTransition(async () => {
      try {
        await declineContract(contractId);
        setCurrentStatus("declined");
      } catch {
        setError("Something went wrong — please try again.");
        setPendingAction(null);
      }
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <Input
        label="Type your full name to sign"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <Checkbox
        label="I have read this contract and agree to be legally bound by its terms. Typing my name above and clicking “Sign contract” counts as my signature."
        checked={agreed}
        onChange={(e) => setAgreed(e.target.checked)}
      />
      <div className="flex gap-3">
        <Button
          type="button"
          disabled={isPending || name.trim().length === 0 || !agreed}
          onClick={sign}
        >
          {isPending && pendingAction === "sign" ? "Signing…" : "Sign contract"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={isPending}
          onClick={decline}
        >
          {isPending && pendingAction === "decline" ? "Declining…" : "Decline contract"}
        </Button>
      </div>
      {error && <p className="text-sm text-error">{error}</p>}
    </div>
  );
};
