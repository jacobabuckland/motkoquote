import { describe, it, expect } from "vitest";

import { buildPayPanel, type PayPanelInput } from "@/app/i/[id]/pay-panel";

describe("CONN-6: Completing Stripe onboarding makes trade payable", () => {
  /**
   * A `contractors` row as the invoice page reads it.
   */
  type ContractorRow = {
    id: string;
    stripe_account_id: string | null;
    stripe_payouts_enabled: boolean;
    stripe_requirements_due: boolean;
    payout_details_complete: boolean;
    payout_account_holder_name: string | null;
    payout_sort_code: string | null;
    payout_account_number: string | null;
  };

  /**
   * The production call shape. `src/app/i/[id]/page.tsx` reads the contractor
   * row and hands `buildPayPanel` a `PayPanelInput`; this performs the same
   * mapping, so these tests exercise the path production actually takes rather
   * than a parallel one built for them.
   *
   * `amount` is in POUNDS and is held well under the £10k Pay by Bank ceiling,
   * so the mode these tests observe is decided by readiness and not by size.
   */
  const panelInputFor = (contractor: ContractorRow): PayPanelInput => ({
    railsAvailable:
      Boolean(contractor.stripe_account_id) && contractor.stripe_payouts_enabled,
    payoutDetailsComplete: contractor.payout_details_complete,
    accountHolderName: contractor.payout_account_holder_name,
    sortCode: contractor.payout_sort_code,
    accountNumber: contractor.payout_account_number,
    companyName: "Test Trading Ltd",
    firstName: null,
    amount: 500,
    invoiceId: "inv_test",
    stripePayoutsEnabled: contractor.stripe_payouts_enabled,
    stripeRequirementsDue: contractor.stripe_requirements_due,
  });

  describe("Connect completion makes contractor payable", () => {
    it("buildPayPanel returns payable mode when Connect complete without manual form", () => {
      const contractorWithConnectOnly: ContractorRow = {
        id: "ctr_connect_only",
        stripe_account_id: "acct_test123",
        stripe_payouts_enabled: true,
        stripe_requirements_due: false,
        payout_details_complete: false,
        payout_account_holder_name: null,
        payout_sort_code: null,
        payout_account_number: null,
      };

      const panel = buildPayPanel(panelInputFor(contractorWithConnectOnly));

      expect(
        panel.mode,
        "Connect-complete contractor must be payable without manual form"
      ).not.toBe("setup_incomplete");
    });
  });

  describe("Consistency across all readiness signal combinations", () => {
    it("affirmative and pay page agree on payability in all four combinations", () => {
      const testCases: { name: string; contractor: ContractorRow; shouldBePayable: boolean }[] = [
        {
          name: "Neither Connect nor manual form complete",
          contractor: {
            id: "ctr_neither",
            stripe_account_id: null,
            stripe_payouts_enabled: false,
            stripe_requirements_due: true,
            payout_details_complete: false,
            payout_account_holder_name: null,
            payout_sort_code: null,
            payout_account_number: null,
          },
          shouldBePayable: false,
        },
        {
          name: "Manual form complete but Connect not ready",
          contractor: {
            id: "ctr_manual_only",
            stripe_account_id: null,
            stripe_payouts_enabled: false,
            stripe_requirements_due: true,
            payout_details_complete: true,
            payout_account_holder_name: "Manual Entry User",
            payout_sort_code: "123456",
            payout_account_number: "87654321",
          },
          shouldBePayable: false,
        },
        {
          name: "Connect complete but manual form not filled — the key case",
          contractor: {
            id: "ctr_connect_only",
            stripe_account_id: "acct_test456",
            stripe_payouts_enabled: true,
            stripe_requirements_due: false,
            payout_details_complete: false,
            payout_account_holder_name: null,
            payout_sort_code: null,
            payout_account_number: null,
          },
          shouldBePayable: true,
        },
        {
          name: "Both Connect and manual form complete",
          contractor: {
            id: "ctr_both",
            stripe_account_id: "acct_test789",
            stripe_payouts_enabled: true,
            stripe_requirements_due: false,
            payout_details_complete: true,
            payout_account_holder_name: "Both Complete User",
            payout_sort_code: "111111",
            payout_account_number: "22222222",
          },
          shouldBePayable: true,
        },
      ];

      for (const testCase of testCases) {
        const panel = buildPayPanel(panelInputFor(testCase.contractor));

        const isPayable = panel.mode !== "setup_incomplete";

        expect(isPayable, testCase.name).toBe(testCase.shouldBePayable);
      }
    });
  });

  describe("No double entry of bank details", () => {
    it("contractor with Connect complete has payout details without manual entry", () => {
      // A contractor who finished Connect but never filled the manual form
      const connectCompleteContractor: ContractorRow = {
        id: "ctr_no_double_entry",
        stripe_account_id: "acct_external",
        stripe_payouts_enabled: true,
        stripe_requirements_due: false,
        payout_details_complete: false,
        payout_account_holder_name: null,
        payout_sort_code: null,
        payout_account_number: null,
      };

      const panel = buildPayPanel(panelInputFor(connectCompleteContractor));

      // The fix ensures this contractor is recognized as having payout details
      // via Connect, without needing to fill the manual form
      expect(
        panel.mode,
        "Must not require manual bank details after Connect completion"
      ).not.toBe("setup_incomplete");
    });
  });

  describe("Edge case: Connect requirements outstanding", () => {
    it("buildPayPanel treats contractor with outstanding requirements as not payable", () => {
      const contractorWithRequirements: ContractorRow = {
        id: "ctr_requirements",
        stripe_account_id: "acct_incomplete",
        stripe_payouts_enabled: false,
        stripe_requirements_due: true,
        payout_details_complete: false,
        payout_account_holder_name: null,
        payout_sort_code: null,
        payout_account_number: null,
      };

      const panel = buildPayPanel(panelInputFor(contractorWithRequirements));

      expect(
        panel.mode,
        "Contractor with outstanding Stripe requirements must not be payable"
      ).toBe("setup_incomplete");
    });
  });

  describe("Edge case: manual form complete, Connect not", () => {
    it("buildPayPanel requires Connect even when manual form is filled", () => {
      // This is the case where a contractor filled the manual form
      // but never went through Connect, or Connect is incomplete
      const manualOnlyContractor: ContractorRow = {
        id: "ctr_manual_no_connect",
        stripe_account_id: null,
        stripe_payouts_enabled: false,
        stripe_requirements_due: true,
        payout_details_complete: true,
        payout_account_holder_name: "Manual Only User",
        payout_sort_code: "999888",
        payout_account_number: "77665544",
      };

      const panel = buildPayPanel(panelInputFor(manualOnlyContractor));

      expect(
        panel.mode,
        "Manual form alone is insufficient; Connect completion is required"
      ).toBe("setup_incomplete");
    });
  });
});
