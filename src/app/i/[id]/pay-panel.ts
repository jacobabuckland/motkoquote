// The customer invoice page's payment section as a pure decision, extracted so
// its branching is unit-testable without a DOM/server-render harness.
//
// Three mutually exclusive modes:
//   setup_incomplete — the trade hasn't finished payout setup; no way to pay
//                      yet (neither button nor transfer details exist).
//   button_only      — pay-by-bank rails are live and invoice is within the
//                      limit: show only the one-tap button. Transfer details
//                      are NOT in the response (not merely unrendered).
//   transfer_only    — rails unavailable (Stripe Connect not ready, amount
//                      exceeds £10k limit, or any outage): the manual
//                      bank-transfer block is the primary and ONLY path.
//
// The transfer details are the trade's own account (the same account a
// pay-by-bank payment settles into), pre-formatted for display.

import { formatGBP, formatSortCode, invoicePaymentReference } from "@/lib/format";

const PAY_BY_BANK_LIMIT_PENNIES = 10_000_00;

export type TransferDetails = {
  accountHolderName: string;
  sortCode: string;
  accountNumber: string;
  amount: string;
  reference: string;
};

export type PayPanel =
  | { mode: "setup_incomplete" }
  | { mode: "button_only" }
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

  const amountPennies = Math.round(input.amount * 100);
  const exceedsLimit = amountPennies > PAY_BY_BANK_LIMIT_PENNIES;

  if (input.railsAvailable && !exceedsLimit) {
    return { mode: "button_only" };
  }

  const transfer: TransferDetails = {
    accountHolderName: input.accountHolderName as string,
    sortCode: formatSortCode(input.sortCode as string),
    accountNumber: input.accountNumber as string,
    amount: formatGBP(input.amount),
    reference: invoicePaymentReference(input.invoiceId),
  };

  const guidanceName = input.firstName?.trim() || input.companyName;
  return { mode: "transfer_only", transfer, guidanceName };
};
