import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
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

  describe("BST/GMT edge cases around London midnight", () => {
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

  describe("BST/GMT edge cases: boundaries cross at London midnight, not UTC midnight", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    describe("During British Summer Time (UTC+1)", () => {
      it("treats instants either side of London midnight as different days", () => {
        // 2026-06-01T22:50:00Z is 23:50 on June 1 in London
        const beforeMidnight = "2026-06-01T22:50:00Z";
        // 2026-06-01T23:10:00Z is 00:10 on June 2 in London
        const afterMidnight = "2026-06-01T23:10:00Z";

        // Mock the current time to be on June 1, 2026 in London
        // Using 2026-06-01T12:00:00Z which is 13:00 on June 1 in London
        vi.setSystemTime(new Date("2026-06-01T12:00:00Z"));

        // beforeMidnight is still "today" (same London day)
        expect(formatRelative(beforeMidnight)).toBe("today");
        // afterMidnight is "tomorrow" (next London day)
        expect(formatRelative(afterMidnight)).toBe("tomorrow");
      });

      it("treats an instant exactly on London midnight as the beginning day", () => {
        // 2026-06-01T23:00:00Z is exactly midnight on June 2 in London
        const londonMidnight = "2026-06-01T23:00:00Z";

        // Mock current time to be on June 1, 2026
        vi.setSystemTime(new Date("2026-06-01T12:00:00Z"));

        // Midnight belongs to the new day, so it's "tomorrow"
        expect(formatRelative(londonMidnight)).toBe("tomorrow");
      });
    });

    describe("During GMT (UTC+0)", () => {
      it("treats instants either side of London midnight as different days", () => {
        // 2026-01-15T23:50:00Z is 23:50 on January 15 in London
        const beforeMidnight = "2026-01-15T23:50:00Z";
        // 2026-01-16T00:10:00Z is 00:10 on January 16 in London
        const afterMidnight = "2026-01-16T00:10:00Z";

        // Mock the current time to be on January 15, 2026
        // Using 2026-01-15T12:00:00Z which is 12:00 on January 15 in London
        vi.setSystemTime(new Date("2026-01-15T12:00:00Z"));

        // beforeMidnight is still "today" (same London day)
        expect(formatRelative(beforeMidnight)).toBe("today");
        // afterMidnight is "tomorrow" (next London day)
        expect(formatRelative(afterMidnight)).toBe("tomorrow");
      });

      it("treats an instant exactly on London midnight as the beginning day", () => {
        // 2026-01-16T00:00:00Z is exactly midnight on January 16 in London
        const londonMidnight = "2026-01-16T00:00:00Z";

        // Mock current time to be on January 15, 2026
        vi.setSystemTime(new Date("2026-01-15T12:00:00Z"));

        // Midnight belongs to the new day, so it's "tomorrow"
        expect(formatRelative(londonMidnight)).toBe("tomorrow");
      });
    });
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
