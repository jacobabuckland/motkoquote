import { describe, expect, it } from "vitest";
import { daysOverdue, isDateOverdue } from "@/lib/overdue";

const at = (iso: string) => new Date(iso).getTime();

describe("daysOverdue — London calendar days", () => {
  it("is 0 on the due date and 1 the next day", () => {
    expect(daysOverdue("2026-06-01", at("2026-06-01T09:00:00Z"))).toBe(0);
    expect(daysOverdue("2026-06-01", at("2026-06-02T09:00:00Z"))).toBe(1);
  });

  it("counts whole days regardless of the time of day", () => {
    // Late on 2026-06-04 London is still 3 calendar days past 2026-06-01.
    expect(daysOverdue("2026-06-01", at("2026-06-04T22:30:00Z"))).toBe(3);
  });

  it("returns a negative count for a future due date", () => {
    expect(daysOverdue("2026-06-10", at("2026-06-01T09:00:00Z"))).toBe(-9);
  });

  it("accepts a full ISO due date, reading only its calendar date", () => {
    expect(daysOverdue("2026-06-01T00:00:00.000Z", at("2026-06-04T00:00:00Z"))).toBe(3);
  });
});

describe("isDateOverdue — end-of-day, DST-safe", () => {
  it("is not overdue on the due date itself (end-of-day semantics)", () => {
    // 23:30 UTC on the due date is already 00:30 the NEXT day in BST — but the
    // London CALENDAR day is what counts, and at 23:30 UTC on 1 June London has
    // only just passed midnight into 2 June, so it IS a day over. Use a time
    // safely inside the London day to assert the "due today" case.
    expect(isDateOverdue("2026-06-01", at("2026-06-01T12:00:00Z"))).toBe(false);
  });

  it("becomes overdue once London ticks into the following day", () => {
    expect(isDateOverdue("2026-06-01", at("2026-06-02T09:00:00Z"))).toBe(true);
  });

  it("is never overdue for a null due date", () => {
    expect(isDateOverdue(null, at("2030-01-01T00:00:00Z"))).toBe(false);
  });

  // BST boundary: 30 Jun 2026 23:30 UTC is 00:30 on 1 Jul in London (UTC+1),
  // so an invoice due 30 Jun is a fresh calendar day overdue.
  it("respects the London day boundary in summer (BST, UTC+1)", () => {
    expect(daysOverdue("2026-06-30", at("2026-06-30T23:30:00Z"))).toBe(1);
    expect(daysOverdue("2026-06-30", at("2026-06-30T22:30:00Z"))).toBe(0);
  });

  // GMT boundary: in winter London == UTC, so the flip happens at 00:00 UTC.
  it("respects the London day boundary in winter (GMT, UTC+0)", () => {
    expect(daysOverdue("2026-01-15", at("2026-01-15T23:30:00Z"))).toBe(0);
    expect(daysOverdue("2026-01-15", at("2026-01-16T00:30:00Z"))).toBe(1);
  });
});
