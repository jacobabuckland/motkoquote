import { describe, expect, it } from "vitest";
import { resolveManualPaidAt, MAX_BACKDATE_DAYS } from "@/lib/mark-paid-date";

// A fixed "now" so the day maths is deterministic: 2026-07-26T12:00:00Z.
const NOW = new Date("2026-07-26T12:00:00.000Z").getTime();
const DAY = 86_400_000;

describe("resolveManualPaidAt", () => {
  it("defaults an omitted date to now", () => {
    expect(resolveManualPaidAt(undefined, NOW)).toBe(new Date(NOW).toISOString());
  });

  it("respects a valid backdated date (settled at midday UTC)", () => {
    expect(resolveManualPaidAt("2026-07-20", NOW)).toBe("2026-07-20T12:00:00.000Z");
  });

  it("accepts today", () => {
    expect(resolveManualPaidAt("2026-07-26", NOW)).toBe("2026-07-26T12:00:00.000Z");
  });

  it("accepts a date exactly at the backdate window edge", () => {
    const edge = new Date(NOW - MAX_BACKDATE_DAYS * DAY);
    const iso = edge.toISOString().slice(0, 10);
    expect(resolveManualPaidAt(iso, NOW)).not.toBeNull();
  });

  it("rejects a future date", () => {
    expect(resolveManualPaidAt("2026-07-27", NOW)).toBeNull();
  });

  it("rejects a date older than the backdate window", () => {
    const tooOld = new Date(NOW - (MAX_BACKDATE_DAYS + 1) * DAY);
    const iso = tooOld.toISOString().slice(0, 10);
    expect(resolveManualPaidAt(iso, NOW)).toBeNull();
  });

  it("rejects an unparseable date", () => {
    expect(resolveManualPaidAt("not-a-date", NOW)).toBeNull();
  });
});
