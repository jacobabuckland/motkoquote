"use client";

import { useState, useTransition } from "react";
import { createContract } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DEFAULT_CONTRACT_TERMS } from "@/lib/contract-terms";

type Props = {
  quoteId: string;
};

export const CreateContractForm = ({ quoteId }: Props) => {
  const [depositPct, setDepositPct] = useState("");
  const [termsText, setTermsText] = useState(DEFAULT_CONTRACT_TERMS);
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<{ contractUrl: string; delivered: boolean } | null>(null);

  if (result) {
    return (
      <div className="text-sm text-success">
        Contract sent{result.delivered ? " and emailed." : "."}{" "}
        <a href={result.contractUrl} className="underline underline-offset-4">
          View contract
        </a>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          const res = await createContract({
            quoteId,
            depositPct: depositPct ? Number(depositPct) : undefined,
            termsText,
          });
          setResult({ contractUrl: res.contractUrl, delivered: res.delivered });
        });
      }}
    >
      <Input
        label="Deposit (%, optional)"
        type="number"
        step="1"
        min="0"
        max="100"
        value={depositPct}
        onChange={(e) => setDepositPct(e.target.value)}
      />
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-text-secondary">Terms</span>
        <textarea
          className="min-h-24 rounded-md border border-border bg-transparent p-2 text-sm"
          value={termsText}
          onChange={(e) => setTermsText(e.target.value)}
        />
      </label>
      <Button type="submit" disabled={isPending} className="self-start">
        {isPending ? "Sending…" : "Send contract"}
      </Button>
    </form>
  );
};
