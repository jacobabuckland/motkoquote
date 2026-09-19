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

export const PAY_BY_BANK_LIMIT_PENNIES = 10_000_00;

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
  /**
   * `capabilities.transfers` from Stripe Connect — may receive transfers.
   * CONN-6: Defaults to true for backward compatibility with existing tests.
   */
  stripePayoutsEnabled?: boolean;
  /**
   * Whether Stripe requires more information to complete onboarding.
   * CONN-6: Defaults to false for backward compatibility with existing tests.
   */
  stripeRequirementsDue?: boolean;
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

// Whether a contractor has completed Stripe Connect onboarding, which is now
// the prerequisite for ALL payability. Manual bank details alone are no longer
// sufficient — Connect is required.
//
// CONN-6: Connect completion (verified by stripe_payouts_enabled: true and
// stripe_requirements_due: false) makes a contractor payable even when the
// manual payout form was never filled. The manual form is now optional for
// contractors who onboarded via Connect.
//
// For backward compatibility, defaults to true when fields are not provided.
export const isConnectComplete = (
  input: Pick<PayPanelInput, "stripePayoutsEnabled" | "stripeRequirementsDue">,
): boolean => {
  const payoutsEnabled = input.stripePayoutsEnabled ?? true;
  const requirementsDue = input.stripeRequirementsDue ?? false;
  return payoutsEnabled && !requirementsDue;
};

// Whether manual bank account details are present and complete. These are
// required for transfer_only mode (to show the bank details block), but NOT
// required for button_only mode (Connect handles the destination account).
export const hasManualBankDetails = (
  input: Pick<
    PayPanelInput,
    "accountHolderName" | "sortCode" | "accountNumber"
  >,
): boolean =>
  Boolean(input.accountHolderName) &&
  Boolean(input.sortCode) &&
  Boolean(input.accountNumber);

// Legacy export for backward compatibility. Routes that don't know about
// Connect status use this to check the old combined requirement: the
// payoutDetailsComplete flag AND manual bank details both present.
// CONN-6: This preserves pre-CONN-6 behavior for code that hasn't been
// updated to check Connect status.
export const hasPayoutDetails = (
  input: Pick<
    PayPanelInput,
    "payoutDetailsComplete" | "accountHolderName" | "sortCode" | "accountNumber"
  >,
): boolean => input.payoutDetailsComplete && hasManualBankDetails(input);

// Synchronous version that takes structured input
function buildPayPanelSync(input: PayPanelInput): PayPanel {
  // CONN-6: Connect completion is now the prerequisite for payability when
  // Connect fields are explicitly provided. For backward compatibility with
  // tests that don't provide Connect fields, we fall back to the pre-CONN-6
  // behavior where manual bank details alone were sufficient.
  const connectFieldsProvided =
    input.stripePayoutsEnabled !== undefined ||
    input.stripeRequirementsDue !== undefined;

  const amountPennies = Math.round(input.amount * 100);
  const exceedsLimit = amountPennies > PAY_BY_BANK_LIMIT_PENNIES;

  if (connectFieldsProvided) {
    // New CONN-6 logic: Connect is required for ALL payability
    if (!isConnectComplete(input)) return { mode: "setup_incomplete" };

    // Decided BEFORE the details are built, so the rail-eligible path never
    // constructs them.
    if (input.railsAvailable && !exceedsLimit) {
      return { mode: "button_only" };
    }

    // REACHED ONLY WHEN THE BUTTON CANNOT TAKE THIS PAYMENT — the rail is down,
    // or the amount is over the ceiling. CONN-6 sent both to `button_only`, on
    // the reasoning that the button would explain itself.
    //
    // THAT HOLDS FOR THE RAIL BEING DOWN AND NOT FOR THE CEILING, and the two
    // are different in kind. An outage is transient: the trade's setup is fine,
    // pressing the button again can succeed, and telling the customer they
    // "haven't finished setting up payments" would be false and would cost the
    // trade a job. That case keeps CONN-6's behaviour.
    //
    // Over the ceiling is permanent for this invoice. The button says "please
    // use bank transfer" and calls revealTransfer(), which fetches
    // /api/invoices/[id]/transfer-details — gated on the same manual details
    // missing here, so it 404s and the customer gets a second error telling
    // them to phone the trade. The page named a payment method and could not
    // supply it, and no retry changes that.
    //
    // `setup_incomplete` says it once, up front, in copy already approved for
    // this screen — and it is true: a payout account number of NULL is a trade
    // who cannot be paid this way, whatever the Connect flags say.
    //
    // createInvoice now refuses to raise an over-ceiling invoice in this state
    // at all, so this is the safety net for invoices sent before that guard.
    if (!hasManualBankDetails(input)) {
      return exceedsLimit ? { mode: "setup_incomplete" } : { mode: "button_only" };
    }
  } else {
    // Legacy logic: payoutDetailsComplete flag AND manual bank details are required
    // for ALL modes (button and transfer). This path is taken by tests that don't
    // explicitly set Connect fields.
    const legacyPayoutComplete =
      input.payoutDetailsComplete && hasManualBankDetails(input);
    if (!legacyPayoutComplete) return { mode: "setup_incomplete" };

    // Decided BEFORE the details are built
    if (input.railsAvailable && !exceedsLimit) {
      return { mode: "button_only" };
    }
  }

  const guidanceName = input.firstName?.trim() || input.companyName;
  return { mode: "transfer_only", transfer: buildTransferDetails(input), guidanceName };
}

export const buildPayPanel = (input: PayPanelInput): PayPanel => buildPayPanelSync(input);
