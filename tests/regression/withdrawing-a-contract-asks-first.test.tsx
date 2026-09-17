/**
 * @vitest-environment happy-dom
 */
// PASS-13: one tap voided a live agreement.
//
// "Withdraw contract" renders only while the contract's status is `sent` —
// the window in which the customer is holding it and could sign at any moment —
// and it sat directly under "Copy contract link" and "Download contract", two
// buttons that do nothing at all. A mis-tap ended the agreement, and
// `withdrawContract` notifies nobody, so the customer's next act would have been
// opening a link that told them the contract was gone.
//
// The assertions below are about the GATE, so they are about what the component
// called and when — not about what a stub returned. `withdrawContract` is
// replaced by a recorder; an empty call list after a tap is the whole claim.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

// vi.hoisted: a vi.mock factory is lifted above the file body, so a plain
// top-level const sits in its temporal dead zone the first time the mock runs.
const { withdrawCalls } = vi.hoisted(() => ({ withdrawCalls: [] as string[] }));

vi.mock("@/app/jobs/actions", () => ({
  withdrawContract: async (contractId?: string) => {
    withdrawCalls.push(contractId ?? "");
    return { success: true };
  },
}));

import { WithdrawContractButton } from "@/app/jobs/[id]/withdraw-contract-button";

const CONTRACT_ID = "00000000-0000-4000-8000-000000000001";

beforeEach(() => {
  withdrawCalls.length = 0;
});

afterEach(cleanup);

const renderButton = () =>
  render(<WithdrawContractButton contractId={CONTRACT_ID} customerName="Dawn Whitlock" />);

const tapTrigger = () =>
  fireEvent.click(screen.getByRole("button", { name: "Withdraw contract" }));

const confirmInDialog = async () => {
  // Scoped to the dialog: the trigger carries the same label, and an unscoped
  // query would find it first and prove nothing about the confirm.
  const dialog = within(screen.getByRole("dialog"));
  await act(async () => {
    fireEvent.click(dialog.getByRole("button", { name: "Withdraw contract" }));
  });
};

describe("withdrawing a contract asks before it acts", () => {
  it("does not withdraw anything on the first tap", async () => {
    renderButton();

    await act(async () => {
      tapTrigger();
    });

    expect(
      withdrawCalls,
      "the contract was withdrawn by a single tap, with nothing in the way",
    ).toEqual([]);
  });

  it("opens a dialog instead", async () => {
    renderButton();

    expect(screen.queryByRole("dialog")).toBeNull();

    await act(async () => {
      tapTrigger();
    });

    expect(screen.getByRole("dialog")).toBeDefined();
  });

  it("withdraws once the contractor confirms, naming the contract", async () => {
    renderButton();

    await act(async () => {
      tapTrigger();
    });
    await confirmInDialog();

    expect(withdrawCalls).toEqual([CONTRACT_ID]);
  });

  it("withdraws nothing when the contractor backs out", async () => {
    renderButton();

    await act(async () => {
      tapTrigger();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Keep the contract" }));
    });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(withdrawCalls).toEqual([]);
  });
});

describe("what the dialog tells the contractor", () => {
  it("says the customer cannot sign, by name", async () => {
    renderButton();

    await act(async () => {
      tapTrigger();
    });

    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByText(/Dawn Whitlock won't be able to sign it/)).toBeDefined();
  });

  it("says nobody is emailed, which is the half the contractor cannot see", async () => {
    // `withdrawContract`'s own contract: "Does NOT trigger any customer
    // notifications". A customer expecting to sign finds out by opening a dead
    // link, so the moment to say so is before the tap, not after it.
    renderButton();

    await act(async () => {
      tapTrigger();
    });

    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByText(/doesn't email them/)).toBeDefined();
  });

  it("falls back to a neutral noun when the customer has no name on the job", async () => {
    render(<WithdrawContractButton contractId={CONTRACT_ID} customerName="  " />);

    await act(async () => {
      tapTrigger();
    });

    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByText(/The customer won't be able to sign it/)).toBeDefined();
  });
});
