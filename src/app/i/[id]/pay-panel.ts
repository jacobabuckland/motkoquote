// The customer invoice page's payment section as a pure decision, extracted so
// its branching is unit-testable without a DOM/server-render harness.
//
// Three mutually exclusive modes:
//   setup_incomplete    — the trade hasn't finished payout setup; no way to pay
//                         yet (neither button nor transfer details exist).
//   button_with_transfer — pay-by-bank rails are live: lead with the one-tap
//                         button, keep the manual transfer as a secondary toggle.
//   transfer_only       — rails unavailable (TrueLayer activation, or any
//                         outage): the manual bank-transfer block is the primary
//                         and ONLY path — never a broken button.
//
// The transfer details are the trade's own account (the same account a
// pay-by-bank payment settles into), pre-formatted for display.

import { formatGBP, formatSortCode, invoicePaymentReference } from "@/lib/format";

export type TransferDetails = {
  accountHolderName: string;
  sortCode: string;
  accountNumber: string;
  amount: string;
  reference: string;
};

export type PayPanel =
  | { mode: "setup_incomplete" }
  | { mode: "button_with_transfer"; transfer: TransferDetails }
  | { mode: "transfer_only"; transfer: TransferDetails; guidanceName: string };

export type PayPanelInput = {
  railsAvailable: boolean;
  payoutDetailsComplete: boolean;
  accountHolderName: string | null;
  sortCode: string | null;
  accountNumber: string | null;
  companyName: string;
  firstName: string | null;
  amount: number;
  invoiceId: string;
};

export const buildPayPanel = (input: PayPanelInput): PayPanel => {
  // Payout details present is a prerequisite for BOTH the button and the manual
  // transfer (both settle into the trade's account). Without them there is no
  // payable surface at all.
  const payoutReady =
    input.payoutDetailsComplete &&
    Boolean(input.accountHolderName) &&
    Boolean(input.sortCode) &&
    Boolean(input.accountNumber);
  if (!payoutReady) return { mode: "setup_incomplete" };

  const transfer: TransferDetails = {
    accountHolderName: input.accountHolderName as string,
    sortCode: formatSortCode(input.sortCode as string),
    accountNumber: input.accountNumber as string,
    amount: formatGBP(input.amount),
    reference: invoicePaymentReference(input.invoiceId),
  };

  if (input.railsAvailable) return { mode: "button_with_transfer", transfer };

  const guidanceName = input.firstName?.trim() || input.companyName;
  return { mode: "transfer_only", transfer, guidanceName };
};
