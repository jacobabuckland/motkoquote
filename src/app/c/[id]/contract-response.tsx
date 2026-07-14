"use client";

import { useState, useTransition } from "react";
import { signContract, declineContract } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { formatDate } from "@/lib/format";

type Props = {
  contractId: string;
  status: string;
  signerName: string | null;
  signedAt: string | null;
};

export const ContractResponse = ({ contractId, status, signerName, signedAt }: Props) => {
  const [currentStatus, setCurrentStatus] = useState(status);
  const [currentSigner, setCurrentSigner] = useState(signerName);
  const [currentSignedAt, setCurrentSignedAt] = useState(signedAt);
  const [name, setName] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [pendingAction, setPendingAction] = useState<"sign" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (currentStatus === "signed") {
    return (
      <div className="rounded-card border border-success bg-success-bg p-3">
        <p className="text-sm font-medium text-success">
          Contract signed by {currentSigner ?? "the customer"}
          {currentSignedAt ? ` on ${formatDate(currentSignedAt)}` : ""}.
        </p>
        <p className="mt-1 text-sm text-text-secondary">
          This contract is fully signed — it only needs one signature. There&apos;s nothing more to
          sign here.
        </p>
      </div>
    );
  }

  if (currentStatus === "declined") {
    return (
      <p className="text-sm font-medium text-text-secondary">
        This contract was declined. Get in touch with the contractor if that wasn&apos;t intended.
      </p>
    );
  }

  const canSign = name.trim().length > 0 && agreed;

  const sign = () => {
    setError(null);
    setPendingAction("sign");
    startTransition(async () => {
      try {
        await signContract(contractId, name.trim());
        setCurrentSigner(name.trim());
        setCurrentSignedAt(new Date().toISOString());
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
        <Button type="button" disabled={isPending || !canSign} onClick={sign}>
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
      {!canSign && (
        <p className="text-xs text-text-muted">
          Type your full name and tick the box above to enable signing.
        </p>
      )}
      {error && <p className="text-sm text-error">{error}</p>}
    </div>
  );
};
