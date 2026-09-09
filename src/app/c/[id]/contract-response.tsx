"use client";

import { useState, useTransition } from "react";
import { signContract, declineContract } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { formatDate } from "@/lib/format";
import * as haptics from "@/lib/haptics";

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
        {/* Says only what is true of the READER, and asserts nothing about the
            document's overall signature status.

            It used to read "This contract is fully signed — it only needs one
            signature." Both halves were untrue: all five templates carry
            "**Signed by the Contractor:** ______" (templates.ts:121, 280, 443,
            593, 733) and the product has no contractor signing step, so the
            document asks for two signatures and can capture one. 17 contracts
            have been sent and 15 signed carrying that contradiction.

            Whether to remove the contractor block or build contractor signing is
            a legal drafting question and is under review. This copy deliberately
            survives either answer: the customer has nothing further to sign on
            this page whether the contractor's signature is dropped from the
            template or collected before send. Removing a claim needs no advice;
            making one would. */}
        <p className="mt-1 text-sm text-text-secondary">
          There&apos;s nothing more for you to sign.
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
        haptics.success();
        setCurrentStatus("signed");
      } catch {
        haptics.error();
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
        haptics.error();
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
