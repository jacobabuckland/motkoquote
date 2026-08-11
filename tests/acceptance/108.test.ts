import { describe, expect, it } from "vitest";
import { formatDate, formatRelative } from "@/lib/format";

describe("Issue #108: Show dates in Europe/London rather than UTC", () => {
  describe("formatDate renders the Europe/London calendar day", () => {
    describe("During British Summer Time (UTC+1)", () => {
      it("renders an instant just before UTC midnight as the next London day", () => {
        // 2026-06-01T23:30:00Z is 00:30 on 2 June in London (BST = UTC+1)
        expect(formatDate("2026-06-01T23:30:00Z")).toBe("2 Jun 2026");
      });

      it("renders an instant just after UTC midnight as the same London day", () => {
        // 2026-06-02T00:30:00Z is 01:30 on 2 June in London
        expect(formatDate("2026-06-02T00:30:00Z")).toBe("2 Jun 2026");
      });

      it("renders an instant exactly on London midnight as the beginning day", () => {
        // 2026-06-01T23:00:00Z is exactly midnight on 2 June in London
        expect(formatDate("2026-06-01T23:00:00Z")).toBe("2 Jun 2026");
      });
    });

    describe("During GMT (UTC+0)", () => {
      it("renders an instant just before UTC midnight as the same London day", () => {
        // 2026-01-15T23:30:00Z is 23:30 on 15 January in London (GMT = UTC+0)
        expect(formatDate("2026-01-15T23:30:00Z")).toBe("15 Jan 2026");
      });

      it("renders an instant just after UTC midnight as the same London day", () => {
        // 2026-01-16T00:30:00Z is 00:30 on 16 January in London
        expect(formatDate("2026-01-16T00:30:00Z")).toBe("16 Jan 2026");
      });

      it("renders an instant exactly on London midnight as the beginning day", () => {
        // 2026-01-16T00:00:00Z is exactly midnight on 16 January in London
        expect(formatDate("2026-01-16T00:00:00Z")).toBe("16 Jan 2026");
      });
    });

    describe("Date-only values (Postgres DATE format)", () => {
      it("renders a date-only string as that calendar day without shifting", () => {
        // A plain date like "2026-06-01" has no timezone and must not shift
        expect(formatDate("2026-06-01")).toBe("1 Jun 2026");
      });

      it("renders a winter date-only string as that calendar day", () => {
        expect(formatDate("2026-01-15")).toBe("15 Jan 2026");
      });
    });

    describe("Edge cases remain unchanged", () => {
      it("returns an empty string for unparseable input", () => {
        expect(formatDate("not-a-date")).toBe("");
      });

      it("returns an empty string for empty input", () => {
        expect(formatDate("")).toBe("");
      });
    });
  });

  describe("formatRelative counts whole London calendar days", () => {
    describe("Day calculation uses London time, not UTC", () => {
      it("returns 'today' for the current instant", () => {
        // Basic smoke test - should work regardless of timezone
        expect(formatRelative(new Date().toISOString())).toBe("today");
      });

      it("returns 'yesterday' for ~24 hours ago", () => {
        const yesterday = new Date(Date.now() - 86_400_000 - 3_600_000);
        expect(formatRelative(yesterday.toISOString())).toBe("yesterday");
      });

      it("returns 'tomorrow' for ~24 hours from now", () => {
        const tomorrow = new Date(Date.now() + 86_400_000 + 3_600_000);
        expect(formatRelative(tomorrow.toISOString())).toBe("tomorrow");
      });

      it("returns 'N days ago' for dates in the past", () => {
        const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000 - 3_600_000);
        expect(formatRelative(threeDaysAgo.toISOString())).toBe("3 days ago");
      });

      it("returns 'in N days' for dates in the future", () => {
        const inThreeDays = new Date(Date.now() + 3 * 86_400_000 + 3_600_000);
        expect(formatRelative(inThreeDays.toISOString())).toBe("in 3 days");
      });
    });

    describe("Edge cases remain unchanged", () => {
      it("returns an empty string for unparseable input", () => {
        expect(formatRelative("not-a-date")).toBe("");
      });

      it("returns an empty string for empty input", () => {
        expect(formatRelative("")).toBe("");
      });
    });
  });
});
