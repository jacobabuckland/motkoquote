/**
 * @vitest-environment happy-dom
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

// The component imports Server Actions; they are never invoked on the signed
// branch, but the module still has to resolve.
vi.mock("@/app/c/[id]/actions", () => ({
  signContract: vi.fn(async (_id?: string, _name?: string) => undefined),
  declineContract: vi.fn(async (_id?: string) => undefined),
}));

import { ContractResponse } from "@/app/c/[id]/contract-response";

afterEach(cleanup);

/**
 * The signed-contract panel may not assert that the document is complete.
 *
 * It used to say "This contract is fully signed — it only needs one signature."
 * Both halves are false. Every template carries an unfilled
 * "**Signed by the Contractor:** ______" line (templates.ts:121, 280, 443, 593,
 * 733) and the product has no way for a contractor to sign, so the document
 * requests two signatures and can capture one. 17 contracts have gone out and 15
 * have been signed by a customer who was told the thing was finished.
 *
 * Whether the block comes out of the templates or contractor signing gets built
 * is a legal question under review. This test does not presuppose either: it
 * pins only that the page states what is true of the READER, which holds under
 * both answers, and never speaks for the document as a whole.
 */
describe("a signed contract states only what it can prove", () => {
  const signed = {
    contractId: "contract_1",
    status: "signed",
    signerName: "Dawn Fletcher",
    signedAt: "2026-09-09T10:00:00.000Z",
  };

  it("confirms the customer's own signature", () => {
    render(<ContractResponse {...signed} />);
    expect(screen.getByText(/Contract signed by Dawn Fletcher/)).toBeDefined();
  });

  it("tells the reader they have nothing further to sign", () => {
    render(<ContractResponse {...signed} />);
    // True whether the contractor block is removed or contractor signing is
    // built — in both cases the customer is done on this page.
    expect(screen.getByText(/nothing more for you to sign/i)).toBeDefined();
  });

  it("does not claim the contract is fully signed", () => {
    render(<ContractResponse {...signed} />);
    expect(screen.queryByText(/fully signed/i)).toBeNull();
  });

  it("does not claim it needs only one signature", () => {
    render(<ContractResponse {...signed} />);
    expect(screen.queryByText(/only needs one signature/i)).toBeNull();
  });

  it("makes no claim about the document's overall signature status", () => {
    const { container } = render(<ContractResponse {...signed} />);
    const text = container.textContent ?? "";

    // Phrases that speak for the whole document rather than for the reader.
    // Each would be false today and would stay false under Option A unless the
    // templates change with it — which is exactly the coupling this prevents.
    for (const claim of [/fully signed/i, /only needs one signature/i, /complete/i]) {
      expect(text, `must not assert ${claim}`).not.toMatch(claim);
    }
  });
});
