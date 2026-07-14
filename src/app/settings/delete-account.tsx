"use client";

import { useState, useTransition } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { requestAccountDeletion, cancelAccountDeletion } from "./actions";

type Props = {
  // ISO date the purge is scheduled for, or null when no deletion is pending.
  purgeAfter: string | null;
};

export const DeleteAccount = ({ purgeAfter }: Props) => {
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (purgeAfter) {
    const purgeDate = new Date(purgeAfter).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    return (
      <section>
        <h3 className="mb-1 text-sm font-semibold text-error">
          Account scheduled for deletion
        </h3>
        <Card className="space-y-3 border-error">
          <p className="text-sm text-text-secondary">
            Your account and personal data will be permanently removed on{" "}
            <strong>{purgeDate}</strong>. Issued invoices and contracts are kept
            in anonymised form for legal and tax records.
          </p>
          <Button
            variant="primary"
            onClick={() => startTransition(() => cancelAccountDeletion())}
            disabled={isPending}
          >
            {isPending ? "Restoring…" : "Keep my account"}
          </Button>
        </Card>
      </section>
    );
  }

  return (
    <section>
      <h3 className="mb-1 text-sm font-semibold text-error">Delete account</h3>
      <Card className="space-y-3 border-error">
        <p className="text-sm text-text-secondary">
          Deletes your account and personal data after a 30-day grace period.
          You&apos;ll be signed out straight away and can cancel any time before
          then by signing back in. Issued invoices and contracts are kept in
          anonymised form for legal and tax records.
        </p>
        {confirming ? (
          <div className="flex flex-wrap gap-3">
            <Button
              variant="secondary"
              onClick={() => setConfirming(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => startTransition(() => requestAccountDeletion())}
              disabled={isPending}
              className="bg-error hover:opacity-90"
            >
              {isPending ? "Deleting…" : "Yes, delete my account"}
            </Button>
          </div>
        ) : (
          <Button variant="secondary" onClick={() => setConfirming(true)}>
            Delete account
          </Button>
        )}
      </Card>
    </section>
  );
};
