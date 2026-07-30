import { describe, expect, it } from "vitest";
import {
  formatDate,
  formatGBP,
  formatMaterialsSentence,
  formatRelative,
  formatSortCode,
  invoicePaymentReference,
} from "./format";

describe("formatGBP", () => {
  it("formats pounds with thousands separators and 2dp", () => {
    expect(formatGBP(1234.5)).toBe("£1,234.50");
  });

  it("always shows two decimal places", () => {
    expect(formatGBP(80)).toBe("£80.00");
  });

  it("falls back to £0.00 for non-finite input", () => {
    expect(formatGBP(Number.NaN)).toBe("£0.00");
  });
});

describe("formatDate", () => {
  it("formats an ISO date as D Mon YYYY", () => {
    expect(formatDate("2026-07-12T10:00:00.000Z")).toBe("12 Jul 2026");
  });

  it("returns an empty string for invalid input", () => {
    expect(formatDate("not-a-date")).toBe("");
  });
});

describe("formatRelative", () => {
  it("returns 'today' for the current instant", () => {
    expect(formatRelative(new Date().toISOString())).toBe("today");
  });

  it("returns 'N days ago' for past dates", () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000).toISOString();
    expect(formatRelative(threeDaysAgo)).toBe("3 days ago");
  });

  it("returns an empty string for invalid input", () => {
    expect(formatRelative("nope")).toBe("");
  });
});

describe("formatSortCode", () => {
  it("groups six stored digits into NN-NN-NN", () => {
    expect(formatSortCode("123456")).toBe("12-34-56");
  });

  it("renders the same whether stored with or without separators", () => {
    expect(formatSortCode("12-34-56")).toBe("12-34-56");
    expect(formatSortCode("12 34 56")).toBe("12-34-56");
  });

  it("leaves the all-zero placeholder legible", () => {
    expect(formatSortCode("000000")).toBe("00-00-00");
  });
});

describe("invoicePaymentReference", () => {
  it("derives a stable INV-prefixed reference from the invoice UUID", () => {
    expect(invoicePaymentReference("a1b2c3d4-e5f6-7890-abcd-ef1234567890")).toBe(
      "INVA1B2C3D4E5",
    );
  });

  it("is deterministic for the same invoice id", () => {
    const id = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
    expect(invoicePaymentReference(id)).toBe(invoicePaymentReference(id));
  });
});

describe("formatMaterialsSentence", () => {
  it("capitalises a lowercase fragment and adds a full stop", () => {
    expect(
      formatMaterialsSentence(["multi-finish plaster", "standard PVA bonding agent, supplied by the contractor"]),
    ).toBe("Multi-finish plaster, standard PVA bonding agent, supplied by the contractor.");
  });

  it("leaves an already-capitalised, punctuated sentence untouched", () => {
    expect(formatMaterialsSentence(["Copper pipe and standard fittings."])).toBe(
      "Copper pipe and standard fittings.",
    );
  });

  it("returns an empty string for no materials", () => {
    expect(formatMaterialsSentence([])).toBe("");
  });
});
