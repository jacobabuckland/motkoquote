"use client";

import { useState, useTransition } from "react";
import { signContract, declineContract } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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

  return (
    <div className="flex flex-col gap-3">
      <Input
        label="Type your full name to sign"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          className="mt-1"
        />
        <span>
          I have read this contract and agree to be legally bound by its terms. Typing my name
          above and clicking &quot;Sign contract&quot; counts as my signature.
        </span>
      </label>
      <div className="flex gap-3">
        <Button
          type="button"
          disabled={isPending || name.trim().length === 0 || !agreed}
          onClick={() =>
            startTransition(async () => {
              await signContract(contractId, name.trim());
              setCurrentSigner(name.trim());
              setCurrentStatus("signed");
            })
          }
        >
          Sign contract
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              await declineContract(contractId);
              setCurrentStatus("declined");
            })
          }
        >
          Decline
        </Button>
      </div>
    </div>
  );
};
