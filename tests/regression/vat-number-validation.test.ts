import { describe, expect, it } from "vitest";
import {
  isValidVatNumber,
  normalizeVatNumber,
  vatNumberForDocument,
} from "@/lib/vat-number";

// A statement of work went to a customer reading "VAT 162512" — six digits,
// not a VAT number in any format. Nothing validated the field: it was a plain
// text input written straight through and read unvalidated into every PDF
// header.

describe("normalizeVatNumber", () => {
  it("accepts a standard 9-digit registration", () => {
    expect(normalizeVatNumber("GB123456789")).toBe("GB123456789");
  });

  it("accepts a 12-digit branch-trader registration", () => {
    // Rejecting this would lock out legitimate traders — worse than the
    // invalid number the check exists to catch.
    expect(normalizeVatNumber("GB123456789001")).toBe("GB123456789001");
  });

  it("forgives how it was typed, not what it says", () => {
    expect(normalizeVatNumber("gb 123 4567 89")).toBe("GB123456789");
    expect(normalizeVatNumber("GB 123-456-789")).toBe("GB123456789");
    expect(normalizeVatNumber("123456789")).toBe("GB123456789");
  });

  it("rejects the number that shipped on a customer document", () => {
    expect(normalizeVatNumber("162512")).toBeNull();
    expect(isValidVatNumber("VAT 162512")).toBe(false);
  });

  it("rejects wrong digit counts and non-GB registrations", () => {
    expect(normalizeVatNumber("GB12345678")).toBeNull();
    expect(normalizeVatNumber("GB1234567890")).toBeNull();
    expect(normalizeVatNumber("IE1234567AB")).toBeNull();
    expect(normalizeVatNumber("GBGD001")).toBeNull();
  });

  it("treats absent as absent, not invalid input to argue with", () => {
    expect(normalizeVatNumber(null)).toBeNull();
    expect(normalizeVatNumber("")).toBeNull();
    expect(normalizeVatNumber("   ")).toBeNull();
  });
});

describe("vatNumberForDocument", () => {
  it("omits an invalid stored number rather than printing it", () => {
    // Rows written before this check existed hold whatever was typed, so the
    // document paths cannot trust the column.
    expect(vatNumberForDocument("162512")).toBeNull();
  });

  it("prints a valid one, canonicalised", () => {
    expect(vatNumberForDocument("gb 123456789")).toBe("GB123456789");
  });

  it("omits nothing-at-all quietly", () => {
    // A missing VAT number reads as "not VAT registered", which is unremarkable.
    expect(vatNumberForDocument(null)).toBeNull();
  });
});
