import { describe, expect, it } from "vitest";
import {
  deriveCompletionDate,
  durationFromDays,
  durationHintFromTimeline,
  formatDurationText,
  isIsoDate,
  todayIso,
} from "@/lib/contracts/dates";

// 2024-01-01 is a Monday; 2024-01-06 a Saturday. All maths is UTC/inclusive of
// the start day, skipping weekends.
describe("deriveCompletionDate — working-day maths", () => {
  it("counts the start day as day one (3 working days Mon → Wed)", () => {
    expect(deriveCompletionDate("2024-01-01", 3, "days")).toBe("2024-01-03");
  });

  it("stops on Friday for a 5-day week", () => {
    expect(deriveCompletionDate("2024-01-01", 5, "days")).toBe("2024-01-05");
  });

  it("skips the weekend when the span crosses it (6 days Mon → next Mon)", () => {
    expect(deriveCompletionDate("2024-01-01", 6, "days")).toBe("2024-01-08");
  });

  it("treats weeks as five working days each (1 week Mon → Fri)", () => {
    expect(deriveCompletionDate("2024-01-01", 1, "weeks")).toBe("2024-01-05");
  });

  it("nudges a weekend start onto the following Monday", () => {
    expect(deriveCompletionDate("2024-01-06", 1, "days")).toBe("2024-01-08");
  });

  it("returns empty for an unparseable start or non-positive duration", () => {
    expect(deriveCompletionDate("Wednesday 25th August", 3, "days")).toBe("");
    expect(deriveCompletionDate("2024-01-01", 0, "days")).toBe("");
    expect(deriveCompletionDate("2024-01-01", -2, "weeks")).toBe("");
  });
});

describe("durationFromDays — seed structured inputs from captured day count", () => {
  it("prefers whole weeks when days divide evenly by five", () => {
    expect(durationFromDays(10)).toEqual({ value: "2", unit: "weeks" });
    expect(durationFromDays(5)).toEqual({ value: "1", unit: "weeks" });
  });

  it("keeps days for non-week multiples and sub-week spans", () => {
    expect(durationFromDays(3)).toEqual({ value: "3", unit: "days" });
    expect(durationFromDays(7)).toEqual({ value: "7", unit: "days" });
  });

  it("returns null for absent or non-positive input (no prose leaks in)", () => {
    expect(durationFromDays(null)).toBeNull();
    expect(durationFromDays(0)).toBeNull();
    expect(durationFromDays(undefined)).toBeNull();
  });
});

describe("formatDurationText", () => {
  it("pluralises and omits empty/zero (contract fallback takes over)", () => {
    expect(formatDurationText("3", "weeks")).toBe("3 weeks");
    expect(formatDurationText("1", "days")).toBe("1 day");
    expect(formatDurationText("1", "weeks")).toBe("1 week");
    expect(formatDurationText("", "days")).toBe("");
    expect(formatDurationText("0", "days")).toBe("");
  });
});

describe("durationHintFromTimeline", () => {
  it("quotes a meaningful captured timeline", () => {
    expect(durationHintFromTimeline("about a fortnight")).toBe(
      'From the call: "about a fortnight" — enter a number of days or weeks.',
    );
  });

  it("suppresses the hint for the fallback string and empties (no leak)", () => {
    expect(durationHintFromTimeline("To be confirmed before work begins.")).toBeUndefined();
    expect(durationHintFromTimeline("")).toBeUndefined();
    expect(durationHintFromTimeline(null)).toBeUndefined();
    expect(durationHintFromTimeline(undefined)).toBeUndefined();
  });
});

describe("isIsoDate / todayIso", () => {
  it("accepts only real yyyy-mm-dd values", () => {
    expect(isIsoDate("2024-01-01")).toBe(true);
    expect(isIsoDate("2024-13-01")).toBe(false);
    expect(isIsoDate("2024-1-1")).toBe(false);
    expect(isIsoDate("Wednesday 25th August")).toBe(false);
  });

  it("formats today's local calendar day", () => {
    expect(todayIso(new Date(2026, 6, 27))).toBe("2026-07-27");
  });
});
