"use client";

import { useState, type FormEvent } from "react";
import { useTransition } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { payoutDetailsSchema } from "@/lib/schemas/payout";
import { savePayoutDetails } from "./payout-details-actions";

type Props = {
  initialHolderName: string;
  initialSortCode: string;
  initialAccountNumber: string;
  complete: boolean;
};

const formatSortCode = (value: string): string => {
  const digits = value.replace(/\D/g, "").slice(0, 6);
  return digits.replace(/(\d{2})(?=\d)/g, "$1-");
};

export const PayoutDetailsSection = ({
  initialHolderName,
  initialSortCode,
  initialAccountNumber,
  complete,
}: Props) => {
  const toast = useToast();
  const [holderName, setHolderName] = useState(initialHolderName);
  const [sortCode, setSortCode] = useState(formatSortCode(initialSortCode));
  const [accountNumber, setAccountNumber] = useState(initialAccountNumber);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    const parsed = payoutDetailsSchema.safeParse({
      account_holder_name: holderName,
      sort_code: sortCode,
      account_number: accountNumber,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check your bank details.");
      return;
    }

    startSaving(async () => {
      const res = await savePayoutDetails(parsed.data);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      toast("Bank details saved.");
    });
  };

  return (
    <section>
      <h2 className="mb-1 text-lg font-semibold">Bank account</h2>
      <p className="mb-3 text-sm text-text-secondary">
        Customers pay by bank and the money lands here — straight into your
        account, in full, the moment they pay. We never hold your money.
      </p>
      <Card>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {complete && (
            <p className="text-sm font-medium text-success">
              Ready to receive payments
            </p>
          )}
          <Input
            label="Account holder name"
            autoComplete="name"
            required
            placeholder="As it appears on your bank account"
            value={holderName}
            onChange={(event) => setHolderName(event.target.value)}
          />
          <Input
            label="Sort code"
            inputMode="numeric"
            required
            placeholder="12-34-56"
            value={sortCode}
            onChange={(event) => setSortCode(formatSortCode(event.target.value))}
          />
          <Input
            label="Account number"
            inputMode="numeric"
            required
            placeholder="12345678"
            maxLength={8}
            value={accountNumber}
            onChange={(event) =>
              setAccountNumber(event.target.value.replace(/\D/g, "").slice(0, 8))
            }
          />
          {error && <p className="text-sm text-error">{error}</p>}
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? "Saving…" : complete ? "Update bank details" : "Save bank details"}
          </Button>
        </form>
      </Card>
    </section>
  );
};
