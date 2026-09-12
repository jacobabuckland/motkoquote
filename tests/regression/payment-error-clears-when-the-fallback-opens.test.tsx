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
/** Fails the first intent call, then never resolves the second — so the state
 *  DURING an in-flight retry is observable rather than raced past. */
const stubFetchThenHang = () => {
  let calls = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        return {
          ok: false,
          status: 500,
          json: async () => ({ error: "nope" }),
        } as Response;
      }
      return new Promise<Response>(() => {});
    }),
  );
};

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
  fireEvent.click(screen.getByRole("button", { name: /by bank$/ }));
  await waitFor(() =>
    expect(screen.getByText("We couldn't reach your bank")).toBeTruthy(),
  );
};

describe("the payment error says what it means for the customer's money", () => {
  it("leads with 'Nothing has been charged' and offers both routes", async () => {
    stubFetch(true);
    render(<PayButton invoiceId={INVOICE_ID} amount={8132.14} companyName="Acme Ltd" />);

    await failTheCardPayment();

    const panel = screen.getByRole("alert");
    expect(panel.textContent).toContain("We couldn't reach your bank");
    expect(panel.textContent).toContain("Nothing has been charged.");
    expect(panel.textContent).toContain(
      "You can try again, or pay by bank transfer below.",
    );
  });

  it("relabels the button to say what pressing it will now do", async () => {
    stubFetch(true);
    render(<PayButton invoiceId={INVOICE_ID} amount={8132.14} companyName="Acme Ltd" />);

    expect(screen.getByRole("button", { name: /by bank$/ })).toBeTruthy();
    await failTheCardPayment();

    expect(screen.getByRole("button", { name: "Try paying by bank again" })).toBeTruthy();
  });

  it("does not relabel when a retry cannot succeed", async () => {
    stubFetch(true, 422, { code: "AMOUNT_TOO_HIGH", error: "too high" });
    render(<PayButton invoiceId={INVOICE_ID} amount={20000} companyName="Acme Ltd" />);

    fireEvent.click(screen.getByRole("button", { name: /by bank$/ }));
    await screen.findByRole("alert");

    expect(screen.queryByRole("button", { name: "Try paying by bank again" })).toBeNull();
  });

  it("is a contained panel ABOVE the pay button, not loose text below it", async () => {
    stubFetch(true);
    const { container } = render(
      <PayButton invoiceId={INVOICE_ID} amount={8132.14} companyName="Acme Ltd" />,
    );

    await failTheCardPayment();

    const panel = screen.getByRole("alert");
    // Named exactly: once the error is up there are two buttons containing
    // "by bank" — the relabelled primary and the fallback link ("Pay by bank
    // transfer instead"). This is the primary.
    const button = screen.getByRole("button", { name: "Try paying by bank again" });
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
    stubFetch(true, 422, { code: "AMOUNT_TOO_HIGH", error: "too high" });
    render(<PayButton invoiceId={INVOICE_ID} amount={20000} companyName="Acme Ltd" />);

    fireEvent.click(screen.getByRole("button", { name: /by bank$/ }));

    const panel = await screen.findByRole("alert");
    expect(panel.textContent).toContain("above the online payment limit");
    expect(panel.textContent).toContain("Nothing has been charged.");
    // The route out is still stated — it is just not a retry.
    expect(panel.textContent).toContain("Pay by bank transfer below.");
    expect(panel.textContent).not.toContain("You can try again");
  });
});

describe("the failure stands until the customer tries again", () => {
  it("keeps the panel up alongside the bank details", async () => {
    // This REVERSES an earlier contract, deliberately. It used to clear the
    // error once the details loaded, on the reasoning that a red line above
    // fresh bank details reads as "this route is broken too".
    //
    // The panel no longer reads that way — it ends "...or pay by bank transfer
    // below", so it is the signpost that sent them here, and the only thing on
    // screen saying why the details appeared. Clearing it would leave a sort
    // code with no explanation.
    stubFetch(true);
    render(<PayButton invoiceId={INVOICE_ID} amount={8132.14} companyName="Acme Ltd" />);

    await failTheCardPayment();
    fireEvent.click(screen.getByRole("button", { name: /bank transfer/i }));

    await waitFor(() => expect(screen.getByText("Pay by bank transfer")).toBeTruthy());
    expect(screen.getByRole("alert").textContent).toContain(
      "We couldn't reach your bank",
    );
  });

  it("clears it when the next attempt starts, and not before", async () => {
    stubFetchThenHang();
    render(<PayButton invoiceId={INVOICE_ID} amount={8132.14} companyName="Acme Ltd" />);

    await failTheCardPayment();
    expect(screen.getByRole("alert")).toBeTruthy();

    // The retry clears the error and the stub would re-fail it in the same
    // tick, so the second call is held open instead: the in-flight state is
    // observable rather than raced past.
    fireEvent.click(screen.getByRole("button", { name: "Try paying by bank again" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Connecting to your bank/ })).toBeTruthy(),
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps the panel when the bank details themselves fail to load", async () => {
    // The customer now has no route at all. Both failures are real and both
    // are shown.
    stubFetch(false);
    render(<PayButton invoiceId={INVOICE_ID} amount={8132.14} companyName="Acme Ltd" />);

    await failTheCardPayment();
    fireEvent.click(screen.getByRole("button", { name: /bank transfer/i }));

    await waitFor(() =>
      expect(screen.getByText(/couldn't load the bank details/i)).toBeTruthy(),
    );
    expect(screen.getByText("We couldn't reach your bank")).toBeTruthy();
  });
});
