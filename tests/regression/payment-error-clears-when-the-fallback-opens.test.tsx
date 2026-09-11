/**
 * @vitest-environment happy-dom
 *
 * The card error must not still be on screen once the customer has the bank
 * details in front of them.
 *
 * The payment page is the highest-stakes screen in the product and the only
 * one a customer ever sees. When the Stripe rail fails it shows an error and
 * offers bank transfer as the way out. `revealTransfer` cleared its OWN error
 * state and not the card one, so the bank details arrived underneath a red
 * line still saying the payment had failed — at the exact moment that route
 * needs to be trusted, the screen said it was broken too.
 *
 * Cleared on SUCCESS only. If the details themselves fail to load, the
 * customer has no route left and the card error is still the relevant
 * history — `transferError` is what appears, and the original error stays.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PayButton } from "@/app/i/[id]/pay-button";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const INVOICE_ID = "a1b2c3d4-e5f6-4000-8000-000000000001";

/**
 * Fails the payment-intent call, then answers the transfer-details call with
 * `transferOk`. Two different endpoints, so the stub routes on the URL rather
 * than on call order — an ordering assumption would pass even if the component
 * called them the wrong way round.
 */
const stubFetch = (transferOk: boolean) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input?: RequestInfo | URL) => {
      const url = String(input ?? "");
      if (url.includes("create-payment-intent")) {
        return {
          ok: false,
          status: 500,
          json: async () => ({ error: "Couldn't start the payment. Please try again." }),
        } as Response;
      }
      if (url.includes("transfer-details")) {
        return {
          ok: transferOk,
          status: transferOk ? 200 : 500,
          json: async () => ({
            accountHolderName: "Acme Ltd",
            sortCode: "123456",
            accountNumber: "12345678",
          }),
        } as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );

const failTheCardPayment = async () => {
  fireEvent.click(screen.getByRole("button", { name: /pay/i }));
  await waitFor(() =>
    expect(screen.getByText(/couldn't start the payment/i)).toBeTruthy(),
  );
};

describe("payment error clears when the bank-transfer fallback opens", () => {
  it("drops the card error once the bank details load", async () => {
    stubFetch(true);
    render(<PayButton invoiceId={INVOICE_ID} amount={8132.14} companyName="Acme Ltd" />);

    await failTheCardPayment();

    fireEvent.click(screen.getByRole("button", { name: /bank transfer/i }));

    await waitFor(() => expect(screen.getByText("Pay by bank transfer")).toBeTruthy());
    expect(screen.queryByText(/couldn't start the payment/i)).toBeNull();
  });

  it("keeps the card error when the bank details fail to load", async () => {
    // The customer now has no route at all. Clearing the first error here
    // would leave the screen explaining less than it knows.
    stubFetch(false);
    render(<PayButton invoiceId={INVOICE_ID} amount={8132.14} companyName="Acme Ltd" />);

    await failTheCardPayment();

    fireEvent.click(screen.getByRole("button", { name: /bank transfer/i }));

    await waitFor(() =>
      expect(screen.getByText(/couldn't load the bank details/i)).toBeTruthy(),
    );
    expect(screen.getByText(/couldn't start the payment/i)).toBeTruthy();
  });
});
