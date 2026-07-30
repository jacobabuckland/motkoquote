import { describe, expect, it } from "vitest";
import { chaseEmailLinkLabel, chaseSmsLinkLabel } from "./chase-cta";

describe("chase CTA wording by rails availability", () => {
  it("promises payment when the one-tap rails are live", () => {
    expect(chaseEmailLinkLabel(true)).toBe("Pay now");
    expect(chaseSmsLinkLabel(true)).toBe("Pay");
  });

  it("does NOT promise one-tap payment when rails are unavailable", () => {
    // The link points at the same invoice page (which shows the manual
    // bank-transfer details), so the copy must read as a view/reference link,
    // never "Pay now" / "Pay:".
    expect(chaseEmailLinkLabel(false)).toBe("View invoice");
    expect(chaseSmsLinkLabel(false)).toBe("Invoice");
    expect(chaseEmailLinkLabel(false)).not.toContain("Pay");
    expect(chaseSmsLinkLabel(false)).not.toContain("Pay");
  });
});
