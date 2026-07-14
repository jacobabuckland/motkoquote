import { describe, expect, it } from "vitest";
import { normalizeUkPhone } from "@/lib/phone";

describe("normalizeUkPhone", () => {
  it("normalizes a standard 07 mobile number", () => {
    expect(normalizeUkPhone("07123 456789")).toBe("+447123456789");
  });

  it("normalizes a number already in +44 form", () => {
    expect(normalizeUkPhone("+44 7123 456789")).toBe("+447123456789");
  });

  it("normalizes a 0044-prefixed number", () => {
    expect(normalizeUkPhone("00447123456789")).toBe("+447123456789");
  });

  it("strips spaces, dashes and brackets", () => {
    expect(normalizeUkPhone("(0161) 123-4567")).toBe("+441611234567");
  });

  it("returns null for an empty string", () => {
    expect(normalizeUkPhone("")).toBeNull();
  });

  it("returns null for something that isn't a phone number", () => {
    expect(normalizeUkPhone("call me maybe")).toBeNull();
  });

  it("returns null for a too-short number", () => {
    expect(normalizeUkPhone("07123")).toBeNull();
  });
});
