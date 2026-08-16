"use client";

import { useToast } from "@/components/ui/toast";

// The manual bank-transfer panel shown on the customer invoice page. It is the
// primary payment path whenever the pay-by-bank rails are unavailable (Stripe
// Connect not yet ready, amount over the limit, or any outage), and stays
// available as a permanent secondary "or pay by bank transfer" toggle once the
// pay button is back. It renders the trade's own account details — the same
// account a pay-by-bank payment would settle into — so there is never a broken
// button: the customer can always pay. No money flows through motko here.
//
// Set like the payee block on a real invoice: ruled rows, labels quiet, values
// in the display face with tabular figures so a sort code and an account
// number line up under each other and can be read off in one go.
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
      // The accessible name names the field, not just "Copy" — three
      // identical "Copy" buttons in a row are indistinguishable out of context.
      aria-label={`Copy ${what.toLowerCase()}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          toast(`${what} copied.`);
        } catch {
          toast("Couldn't copy — try again.");
        }
      }}
      className="inline-flex min-h-11 shrink-0 items-center px-2 text-sm font-semibold text-green transition-colors duration-150 hover:text-green-hover active:text-green-hover"
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
  <div className="flex items-center justify-between gap-3 border-b border-line py-2.5 last:border-b-0">
    <div className="min-w-0">
      <p className="text-xs text-ink-secondary">{label}</p>
      <p className="display truncate text-base font-bold text-ink">{value}</p>
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
  <div className="flex flex-col rounded-card border border-line-strong bg-card px-4 py-1">
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
