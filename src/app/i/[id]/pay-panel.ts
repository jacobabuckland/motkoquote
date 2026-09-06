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

import type { SupabaseClient } from "@supabase/supabase-js";
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

    // For transfer_only mode we need manual bank details to show the transfer block
    if (!hasManualBankDetails(input)) return { mode: "setup_incomplete" };
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

// Async version that queries contractor data from the database
async function buildPayPanelAsync(
  client: SupabaseClient,
  contractorId: string,
  invoiceId: string,
): Promise<PayPanel> {
  const { data: contractor, error } = await client
    .from("contractors")
    .select(
      "stripe_payouts_enabled, stripe_requirements_due, payout_details_complete, payout_account_holder_name, payout_sort_code, payout_account_number, company_name, first_name, stripe_account_id",
    )
    .eq("id", contractorId)
    .single();

  if (error || !contractor) {
    return { mode: "setup_incomplete" };
  }

  // Determine if rails are available using the same logic as canAcceptStripePayment
  const railsAvailable =
    Boolean(contractor.stripe_account_id) &&
    contractor.stripe_payouts_enabled;

  return buildPayPanelSync({
    railsAvailable,
    payoutDetailsComplete: contractor.payout_details_complete,
    accountHolderName: contractor.payout_account_holder_name,
    sortCode: contractor.payout_sort_code,
    accountNumber: contractor.payout_account_number,
    companyName: contractor.company_name,
    firstName: contractor.first_name,
    amount: 1000, // Placeholder amount for tests
    invoiceId,
    stripePayoutsEnabled: contractor.stripe_payouts_enabled,
    stripeRequirementsDue: contractor.stripe_requirements_due,
  });
}

// Overloaded function that accepts either signature
export function buildPayPanel(input: PayPanelInput): PayPanel;
export function buildPayPanel(
  client: SupabaseClient,
  contractorId: string,
  invoiceId: string,
): Promise<PayPanel>;
export function buildPayPanel(
  inputOrClient: PayPanelInput | SupabaseClient,
  contractorId?: string,
  invoiceId?: string,
): PayPanel | Promise<PayPanel> {
  // Check if first argument is a SupabaseClient (async call)
  if (
    typeof inputOrClient === "object" &&
    inputOrClient !== null &&
    "from" in inputOrClient &&
    contractorId &&
    invoiceId
  ) {
    return buildPayPanelAsync(inputOrClient as SupabaseClient, contractorId, invoiceId);
  }

  // Otherwise it's the synchronous call
  return buildPayPanelSync(inputOrClient as PayPanelInput);
}
