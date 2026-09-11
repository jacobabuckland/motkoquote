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
const stubFetch = (transferOk: boolean, intentStatus = 500, intentBody?: object) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input?: RequestInfo | URL) => {
      const url = String(input ?? "");
      if (url.includes("create-payment-intent")) {
        return {
          ok: false,
          status: intentStatus,
          json: async () =>
            intentBody ?? { error: "Couldn't start the payment. Please try again." },
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

describe("the payment error says what it means for the customer's money", () => {
  it("leads with 'Nothing has been charged' and offers both routes", async () => {
    stubFetch(true);
    render(<PayButton invoiceId={INVOICE_ID} amount={8132.14} companyName="Acme Ltd" />);

    await failTheCardPayment();

    const panel = screen.getByRole("alert");
    expect(panel.textContent).toContain("Nothing has been charged.");
    expect(panel.textContent).toContain(
      "You can try again, or pay by bank transfer below.",
    );
  });

  it("is a contained panel ABOVE the pay button, not loose text below it", async () => {
    stubFetch(true);
    const { container } = render(
      <PayButton invoiceId={INVOICE_ID} amount={8132.14} companyName="Acme Ltd" />,
    );

    await failTheCardPayment();

    const panel = screen.getByRole("alert");
    // /by bank$/, not /pay/i: once the error is up there are two matching
    // buttons — the primary ("Pay £8,132.00 by bank") and the fallback link
    // ("Pay by bank transfer instead"). Only the primary ends this way.
    const button = screen.getByRole("button", { name: /by bank$/ });
    // Node.compareDocumentPosition: FOLLOWING (4) means the button comes after
    // the panel in document order. An explanation under the button is read
    // only after the customer has already gone looking for a way out.
    expect(panel.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Contained, not a loose coloured line: it carries the panel's own tint.
    expect(container.querySelector(".bg-red-tint")).toBeTruthy();
  });

  it("does not tell the customer to retry a payment that cannot succeed", async () => {
    // Above the online ceiling. Nothing was charged — but pressing the button
    // again cannot help, and that message already routes to bank transfer.
    stubFetch(true, 422, {
      code: "AMOUNT_TOO_HIGH",
      error: "This invoice amount exceeds the online payment limit. Please use bank transfer.",
    });
    render(<PayButton invoiceId={INVOICE_ID} amount={20000} companyName="Acme Ltd" />);

    fireEvent.click(screen.getByRole("button", { name: /pay/i }));

    const panel = await screen.findByRole("alert");
    expect(panel.textContent).toContain("Nothing has been charged.");
    expect(panel.textContent).toContain("Please use bank transfer.");
    expect(panel.textContent).not.toContain("You can try again");
  });
});

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
