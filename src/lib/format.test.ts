import { describe, expect, it } from "vitest";
import { formatDate, formatGBP, formatRelative } from "./format";

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
