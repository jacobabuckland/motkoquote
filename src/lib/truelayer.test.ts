import { describe, expect, it } from "vitest";
import { buildHostedPaymentPageUrl } from "@/lib/truelayer";

describe("buildHostedPaymentPageUrl", () => {
  const payment = { id: "pay-123", resourceToken: "tok-abc" };

  it("builds the sandbox HPP URL with hash params and encoded return_uri", () => {
    const url = buildHostedPaymentPageUrl(
      "sandbox",
      payment,
      "https://motko.app/i/inv-1/paid",
    );
    expect(url).toBe(
      "https://payment.truelayer-sandbox.com/payments#payment_id=pay-123" +
        "&resource_token=tok-abc" +
        "&return_uri=https%3A%2F%2Fmotko.app%2Fi%2Finv-1%2Fpaid",
    );
  });

  it("uses the live host in live mode", () => {
    const url = buildHostedPaymentPageUrl("live", payment, "https://motko.app/done");
    expect(url.startsWith("https://payment.truelayer.com/payments#")).toBe(true);
  });
});
