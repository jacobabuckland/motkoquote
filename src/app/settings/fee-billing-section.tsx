"use client";

import { useState, useTransition } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { startFeeMandate } from "./fee-billing-actions";

type Props = {
  // TrueLayer mandate status: null before setup, 'authorized' once the trade has
  // authorised it at their bank.
  mandateStatus: string | null;
  // Dunning state: 'active' normally, 'past_due' while a failed fee is retried,
  // 'paused' once retries are exhausted.
  collectionStatus: string;
};

export const FeeBillingSection = ({ mandateStatus, collectionStatus }: Props) => {
  const [error, setError] = useState<string | null>(null);
  const [starting, startSetup] = useTransition();

  const authorized = mandateStatus === "authorized";

  const handleSetup = () => {
    setError(null);
    startSetup(async () => {
      const res = await startFeeMandate();
      if ("error" in res) {
        setError(res.error);
        return;
      }
      window.location.href = res.hostedPageUrl;
    });
  };

  return (
    <section>
      <h2 className="mb-1 text-lg font-semibold">Fee billing</h2>
      <p className="mb-3 text-sm text-text-secondary">
        Motko is free until you get paid. After your first 5 paid jobs, a small
        fee applies per paid job (£2, or £4 over £1,000). We collect it monthly
        by bank — set up billing once to authorise it.
      </p>
      <Card>
        <div className="flex flex-col gap-4">
          {authorized ? (
            <p className="text-sm font-medium text-success">Fee billing active</p>
          ) : (
            <>
              <p className="text-sm text-text-secondary">
                You haven&apos;t set up fee billing yet. You can keep working —
                you&apos;ll need this before your free jobs run out.
              </p>
              <Button
                type="button"
                variant="primary"
                disabled={starting}
                onClick={handleSetup}
              >
                {starting ? "Connecting to your bank…" : "Set up fee billing"}
              </Button>
            </>
          )}
          {collectionStatus === "past_due" && (
            <p className="text-sm text-error">
              A fee payment didn&apos;t go through. We&apos;ll retry it
              automatically over the next few days.
            </p>
          )}
          {collectionStatus === "paused" && (
            <p className="text-sm text-error">
              Fee billing is paused after repeated failed payments. Re-authorise
              your bank below or contact support to continue.
            </p>
          )}
          {authorized && collectionStatus !== "active" && (
            <Button
              type="button"
              variant="secondary"
              disabled={starting}
              onClick={handleSetup}
            >
              {starting ? "Connecting to your bank…" : "Re-authorise bank"}
            </Button>
          )}
          {error && <p className="text-sm text-error">{error}</p>}
        </div>
      </Card>
    </section>
  );
};
