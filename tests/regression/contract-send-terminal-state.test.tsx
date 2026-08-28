/**
 * @vitest-environment happy-dom
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

// CLAUDE.md, UI conventions: a completing action lands its button on the
// terminal "Sent ✓" BEFORE the navigation fires, so a slow or wedged
// router.push can never strand the control mid-spin. This send read
// `isPending ? "Sending…" : …` and pushed from inside the same transition —
// the note in the file about router.refresh() "wedging the transition, leaving
// the button on Sending…" described the hazard exactly, but there was no
// terminal state for the label to land on.

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
}));

const createContract = vi.fn(
  async (): Promise<{
    contractId: string;
    contractUrl: string;
    delivered: boolean;
    hadContactChannel: boolean;
  }> => ({
    contractId: "contract-1",
    contractUrl: "https://example.test/c/contract-1",
    delivered: true,
    hadContactChannel: true,
  }),
);
vi.mock("@/app/dashboard/actions", () => ({ createContract }));

afterEach(() => {
  cleanup();
  push.mockClear();
  push.mockImplementation(() => {});
  createContract.mockClear();
  vi.useRealTimers();
});

const sendAContract = async () => {
  const { CreateContractForm } = await import("@/app/dashboard/create-contract-form");
  render(
    <CreateContractForm
      quoteId="quote-1"
      jobId="job-1"
      customerName="A customer"
      customerEmail="customer@example.test"
      initialJobInput={{ scope_of_work: "Consumer unit replacement" }}
    />,
  );

  // Open the confirm panel, then send.
  fireEvent.click(screen.getByRole("button", { name: "Send contract" }));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Yes, send it" }));
  });
};

describe("contract send", () => {
  it("lands on Sent ✓ before it navigates", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    await sendAContract();

    // The window in which a wedged push used to strand the button on a spinner.
    expect(screen.getByRole("button", { name: "Sent ✓" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Sending…" })).toBeNull();
    expect(push).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(450);
    });

    expect(push).toHaveBeenCalledWith("/jobs/job-1?sent=contract");
  });

  it("stays on Sent ✓ when the navigation never completes", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    push.mockImplementation(() => {
      // A push that wedges — the exact case the pattern exists for.
      return new Promise(() => {}) as unknown as void;
    });

    await sendAContract();
    await act(async () => {
      vi.advanceTimersByTime(5_000);
    });

    expect(screen.getByRole("button", { name: "Sent ✓" })).toBeDefined();
  });

  it("cannot be sent twice from the terminal state", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    await sendAContract();
    const button = screen.getByRole("button", { name: "Sent ✓" });

    expect((button as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      fireEvent.click(button);
    });
    expect(createContract).toHaveBeenCalledTimes(1);
  });
});
