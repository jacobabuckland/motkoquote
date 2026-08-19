// The customer invoice page's payment section as a pure decision, extracted so
// its branching is unit-testable without a DOM/server-render harness.
//
// Three mutually exclusive modes:
//   setup_incomplete — the trade hasn't finished payout setup; no way to pay
//                      yet (neither button nor transfer details exist).
//   button_only      — pay-by-bank rails are live: the one-tap button is the
//                      path, and NO transfer details are produced at all.
//   transfer_only    — rails unavailable (Stripe Connect not ready, amount
//                      exceeds the £10k limit, or any outage): the manual
//                      bank-transfer block is the primary and ONLY path.
//
// Under PAY-4 fee-at-source, motko earns only when money moves through the
// Stripe rail, so a sort code rendered beside the pay button is a documented
// bypass — the customer transfers direct, the contractor is paid in full, and
// motko earns nothing. `button_only` therefore carries no `transfer` property
// at all rather than one the page declines to render: the details must be
// absent from the response body, not merely hidden in it. See PAY-8, which
// recommends exactly this gating.
//
// The gate is rail CAPABILITY, not account existence — see
// canAcceptStripePayment. A contractor mid-verification has a Connect account
// and cannot take a charge, so they fall to transfer_only and their customer
// can still pay.
//
// Where transfer details ARE produced they are the trade's own account (the
// same account a pay-by-bank payment settles into), pre-formatted for display.

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
  // No `transfer` member: the type is what stops a caller spreading details
  // onto the page on this branch.
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

// The display shape of a trade's payout account. Exported because the
// on-demand fallback endpoint must serve byte-identical details to the ones
// transfer_only renders — a customer comparing a reference from one path
// against the other must not see two different strings.
export const buildTransferDetails = (
  input: Pick<
    PayPanelInput,
    "accountHolderName" | "sortCode" | "accountNumber" | "amount" | "invoiceId"
  >,
): TransferDetails => ({
  accountHolderName: input.accountHolderName as string,
  sortCode: formatSortCode(input.sortCode as string),
  accountNumber: input.accountNumber as string,
  amount: formatGBP(input.amount),
  reference: invoicePaymentReference(input.invoiceId),
});

// Whether a contractor's payout account is complete enough to be shown at all.
// A prerequisite for BOTH the button and the manual transfer — both settle into
// the same account — so without it there is no payable surface.
export const hasPayoutDetails = (
  input: Pick<
    PayPanelInput,
    "payoutDetailsComplete" | "accountHolderName" | "sortCode" | "accountNumber"
  >,
): boolean =>
  input.payoutDetailsComplete &&
  Boolean(input.accountHolderName) &&
  Boolean(input.sortCode) &&
  Boolean(input.accountNumber);

export const buildPayPanel = (input: PayPanelInput): PayPanel => {
  // Payout details present is a prerequisite for BOTH the button and the manual
  // transfer (both settle into the trade's account). Without them there is no
  // payable surface at all.
  if (!hasPayoutDetails(input)) return { mode: "setup_incomplete" };

  const amountPennies = Math.round(input.amount * 100);
  const exceedsLimit = amountPennies > PAY_BY_BANK_LIMIT_PENNIES;

  // Decided BEFORE the details are built, so the rail-eligible path never
  // constructs them. Building them first and withholding them later is how
  // they end up in a response body by accident.
  if (input.railsAvailable && !exceedsLimit) {
    return { mode: "button_only" };
  }

  const guidanceName = input.firstName?.trim() || input.companyName;
  return { mode: "transfer_only", transfer: buildTransferDetails(input), guidanceName };
};
