"use client";

import { useToast } from "@/components/ui/toast";

// The manual bank-transfer panel shown on the customer invoice page. It is the
// primary payment path whenever the pay-by-bank rails are unavailable (TrueLayer
// live Payments not yet activated, or any outage), and stays available as a
// permanent secondary "or pay by bank transfer" toggle once the pay button is
// back. It renders the trade's own account details — the same account a
// pay-by-bank payment would settle into — so there is never a broken button:
// the customer can always pay. No money flows through motko here.
//
// Copy buttons sit on the fields a customer types into their banking app (sort
// code, account number, reference); the account name and amount are read-only.
type BankTransferDetailsProps = {
  accountHolderName: string;
  // Pre-grouped for display, e.g. "00-00-00".
  sortCode: string;
  accountNumber: string;
  // Pre-formatted amount, e.g. "£8,132.14".
  amount: string;
  reference: string;
};

const CopyValueButton = ({ value, what }: { value: string; what: string }) => {
  const toast = useToast();
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          toast(`${what} copied.`);
        } catch {
          toast("Couldn't copy — try again.");
        }
      }}
      className="inline-flex min-h-11 items-center text-sm font-medium text-primary hover:text-primary-hover"
    >
      Copy
    </button>
  );
};

const Row = ({
  label,
  value,
  copy,
}: {
  label: string;
  value: string;
  copy?: { value: string; what: string };
}) => (
  <div className="flex items-center justify-between gap-3 border-b border-border py-2 last:border-b-0">
    <div className="min-w-0">
      <p className="text-xs text-text-secondary">{label}</p>
      <p className="truncate font-medium tabular-nums">{value}</p>
    </div>
    {copy && <CopyValueButton value={copy.value} what={copy.what} />}
  </div>
);

export const BankTransferDetails = ({
  accountHolderName,
  sortCode,
  accountNumber,
  amount,
  reference,
}: BankTransferDetailsProps) => (
  <div className="flex flex-col gap-1 rounded-card border border-border p-3">
    <Row label="Account name" value={accountHolderName} />
    <Row
      label="Sort code"
      value={sortCode}
      copy={{ value: sortCode, what: "Sort code" }}
    />
    <Row
      label="Account number"
      value={accountNumber}
      copy={{ value: accountNumber, what: "Account number" }}
    />
    <Row label="Amount" value={amount} />
    <Row
      label="Payment reference"
      value={reference}
      copy={{ value: reference, what: "Reference" }}
    />
  </div>
);
