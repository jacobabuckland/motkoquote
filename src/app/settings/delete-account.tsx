"use client";

import { useState, useTransition } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { requestAccountDeletion } from "./actions";

// Erasure is immediate and irreversible (D9 — no grace period, no restore in
// V1), so the confirmation carries the whole weight of the decision. It is two
// steps and it says plainly what cannot be undone; there is no "Keep my
// account" to come back to, because there is nothing left to come back to.
export const DeleteAccount = () => {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // A deletion that could not complete has to say so. The old flow had no
  // failure state at all — it fired the action and redirected regardless, so a
  // failed write was indistinguishable from a successful erasure. On success
  // the action redirects and this component never re-renders.
  const submit = () => {
    setError(null);
    startTransition(async () => {
      const result = await requestAccountDeletion();
      if (!result.ok) {
        setError(result.message);
        setConfirming(false);
      }
    });
  };

  return (
    <section>
      <h3 className="mb-1 text-sm font-semibold text-error">Delete account</h3>
      <Card className="space-y-3 border-error">
        <p className="text-sm text-text-secondary">
          Permanently deletes your account, your business profile, your voice
          recordings and transcripts, your draft quotes, your uploaded logo and
          receipts, and your sign-in details. Issued invoices and signed
          contracts are kept in anonymised form for legal and tax records.
        </p>

        {error ? (
          <p role="alert" className="text-sm font-medium text-error">
            {error}
          </p>
        ) : null}

        {confirming ? (
          <>
            <p className="text-sm font-semibold">
              This cannot be undone. There&apos;s no grace period and no way to
              restore the account — if you want to use Motko again you&apos;ll
              need to sign up from scratch.
            </p>
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
                onClick={submit}
                disabled={isPending}
                className="bg-error hover:opacity-90"
              >
                {isPending ? "Deleting…" : "Delete my account permanently"}
              </Button>
            </div>
          </>
        ) : (
          <Button variant="secondary" onClick={() => setConfirming(true)}>
            Delete account
          </Button>
        )}
      </Card>
    </section>
  );
};
