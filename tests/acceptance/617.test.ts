import { describe, expect, it } from "vitest";
import {
  isValidVatNumber,
  normalizeVatNumber,
  vatNumberForDocument,
} from "@/lib/vat-number";

// HMRC VAT number check — mod-97 checksum validation.
//
// UK VAT numbers carry a mod-97 checksum in their last 2 digits. A number that
// has the right SHAPE (GB + 9 digits) but fails the checksum is a typo or
// fabrication, and printing it on a customer-facing document damages
// credibility and blocks the customer's VAT reclaim.
//
// The checksum algorithm for d₁d₂d₃d₄d₅d₆d₇d₈d₉:
//   weighted_sum = 8×d₁ + 7×d₂ + 6×d₃ + 5×d₄ + 4×d₅ + 3×d₆ + 2×d₇ + 10×d₈ + 1×d₉
//   valid = (weighted_sum mod 97 == 0)
//
// For 12-digit branch trader numbers, only the first 9 digits are validated;
// the last 3 are a branch suffix and carry no checksum.

describe("VAT number mod-97 checksum validation", () => {
  describe("valid checksums are accepted", () => {
    it("accepts GB000000000 (all zeros, checksum valid)", () => {
      // weighted_sum = 0, 0 mod 97 = 0 ✓
      expect(normalizeVatNumber("GB000000000")).toBe("GB000000000");
      expect(isValidVatNumber("GB000000000")).toBe(true);
    });

    it("accepts GB123456782 (computed valid checksum)", () => {
      // First 7 digits: 8×1 + 7×2 + 6×3 + 5×4 + 4×5 + 3×6 + 2×7 = 112
      // 112 mod 97 = 15, checksum = 97 - 15 = 82
      // Full sum: 112 + 10×8 + 1×2 = 194, 194 mod 97 = 0 ✓
      expect(normalizeVatNumber("GB123456782")).toBe("GB123456782");
      expect(isValidVatNumber("GB123456782")).toBe(true);
    });

    it("accepts GB000000097 (checksum at edge of mod range)", () => {
      // weighted_sum = 10×9 + 1×7 = 97, 97 mod 97 = 0 ✓
      expect(normalizeVatNumber("GB000000097")).toBe("GB000000097");
      expect(isValidVatNumber("GB000000097")).toBe(true);
    });

    it("accepts a valid number with forgiving input formatting", () => {
      expect(normalizeVatNumber("gb 123 456 782")).toBe("GB123456782");
      expect(normalizeVatNumber("GB-123-456-782")).toBe("GB123456782");
      expect(normalizeVatNumber("123456782")).toBe("GB123456782");
    });
  });

  describe("invalid checksums are rejected", () => {
    it("rejects GB123456789 (wrong checksum)", () => {
      // weighted_sum = 8×1 + 7×2 + 6×3 + 5×4 + 4×5 + 3×6 + 2×7 + 10×8 + 1×9
      //              = 8 + 14 + 18 + 20 + 20 + 18 + 14 + 80 + 9 = 201
      // 201 mod 97 = 7 ✗
      expect(normalizeVatNumber("GB123456789")).toBeNull();
      expect(isValidVatNumber("GB123456789")).toBe(false);
    });

    it("rejects GB000000001 (single digit off)", () => {
      // weighted_sum = 1, 1 mod 97 = 1 ✗
      expect(normalizeVatNumber("GB000000001")).toBeNull();
      expect(isValidVatNumber("GB000000001")).toBe(false);
    });

    it("rejects GB999999999 (all nines, invalid checksum)", () => {
      // weighted_sum = 8×9 + 7×9 + 6×9 + 5×9 + 4×9 + 3×9 + 2×9 + 10×9 + 1×9
      //              = 9×(8+7+6+5+4+3+2+10+1) = 9×46 = 414
      // 414 mod 97 = 26 ✗
      expect(normalizeVatNumber("GB999999999")).toBeNull();
      expect(isValidVatNumber("GB999999999")).toBe(false);
    });
  });

  describe("12-digit branch trader numbers", () => {
    it("accepts a valid 12-digit number if the first 9 digits pass checksum", () => {
      // GB123456782 is valid (tested above), so GB123456782001 should be valid too
      expect(normalizeVatNumber("GB123456782001")).toBe("GB123456782001");
      expect(isValidVatNumber("GB123456782001")).toBe(true);
    });

    it("accepts any 3-digit suffix on a valid base", () => {
      expect(normalizeVatNumber("GB123456782999")).toBe("GB123456782999");
      expect(isValidVatNumber("GB000000000123")).toBe(true);
    });

    it("rejects a 12-digit number if the first 9 digits fail checksum", () => {
      // GB123456789 is invalid (tested above), so GB123456789001 is invalid too
      expect(normalizeVatNumber("GB123456789001")).toBeNull();
      expect(isValidVatNumber("GB123456789001")).toBe(false);
    });
  });

  describe("existing format validation is preserved", () => {
    it("rejects the live defect case: VAT 162512 (six digits)", () => {
      // This was printed on a customer-facing SoW before validation existed
      expect(normalizeVatNumber("162512")).toBeNull();
      expect(isValidVatNumber("VAT 162512")).toBe(false);
    });

    it("rejects wrong digit counts", () => {
      expect(normalizeVatNumber("GB12345678")).toBeNull(); // 8 digits
      expect(normalizeVatNumber("GB1234567890")).toBeNull(); // 10 digits
      expect(normalizeVatNumber("GB12345678901")).toBeNull(); // 11 digits
      expect(normalizeVatNumber("GB1234567890123")).toBeNull(); // 13 digits
    });

    it("rejects non-GB prefixes", () => {
      expect(normalizeVatNumber("IE1234567AB")).toBeNull();
      expect(normalizeVatNumber("XI123456782")).toBeNull();
    });

    it("rejects GD/HA government and health numbers", () => {
      expect(normalizeVatNumber("GBGD001")).toBeNull();
      expect(normalizeVatNumber("GBHA500")).toBeNull();
    });
  });

  describe("blank and absent values", () => {
    it("treats blank as absent, not invalid", () => {
      // A non-registered trade leaves vat_number blank; this is legitimate and
      // should not be rejected
      expect(normalizeVatNumber(null)).toBeNull();
      expect(normalizeVatNumber("")).toBeNull();
      expect(normalizeVatNumber("   ")).toBeNull();
      expect(isValidVatNumber(null)).toBe(false);
      expect(isValidVatNumber("")).toBe(false);
    });
  });

  describe("document output with checksum validation", () => {
    it("prints a valid number", () => {
      expect(vatNumberForDocument("GB123456782")).toBe("GB123456782");
      expect(vatNumberForDocument("gb 123456782")).toBe("GB123456782");
    });

    it("omits an invalid checksum rather than printing it", () => {
      expect(vatNumberForDocument("GB123456789")).toBeNull();
      expect(vatNumberForDocument("GB000000001")).toBeNull();
    });

    it("omits the malformed number from the live defect", () => {
      expect(vatNumberForDocument("162512")).toBeNull();
      expect(vatNumberForDocument("VAT 162512")).toBeNull();
    });

    it("omits an absent value", () => {
      expect(vatNumberForDocument(null)).toBeNull();
      expect(vatNumberForDocument("")).toBeNull();
    });
  });
});
