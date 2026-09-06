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
  it("accepts a standard 9-digit registration with valid checksum", () => {
    expect(normalizeVatNumber("GB123456782")).toBe("GB123456782");
  });

  it("accepts a 12-digit branch-trader registration with valid checksum", () => {
    // Rejecting this would lock out legitimate traders — worse than the
    // invalid number the check exists to catch.
    expect(normalizeVatNumber("GB123456782001")).toBe("GB123456782001");
  });

  it("rejects a 9-digit number with invalid checksum", () => {
    // GB123456789 has the right shape but wrong checksum
    expect(normalizeVatNumber("GB123456789")).toBeNull();
    expect(isValidVatNumber("GB123456789")).toBe(false);
  });

  it("rejects a 12-digit number if the first 9 digits have invalid checksum", () => {
    expect(normalizeVatNumber("GB123456789001")).toBeNull();
  });

  it("accepts GB000000000 (all zeros, valid checksum)", () => {
    expect(normalizeVatNumber("GB000000000")).toBe("GB000000000");
  });

  it("forgives how it was typed, not what it says", () => {
    expect(normalizeVatNumber("gb 123 456 782")).toBe("GB123456782");
    expect(normalizeVatNumber("GB 123-456-782")).toBe("GB123456782");
    expect(normalizeVatNumber("123456782")).toBe("GB123456782");
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

  it("omits a number with invalid checksum rather than printing it", () => {
    expect(vatNumberForDocument("GB123456789")).toBeNull();
  });

  it("prints a valid one, canonicalised", () => {
    expect(vatNumberForDocument("gb 123456782")).toBe("GB123456782");
  });

  it("omits nothing-at-all quietly", () => {
    // A missing VAT number reads as "not VAT registered", which is unremarkable.
    expect(vatNumberForDocument(null)).toBeNull();
  });
});
