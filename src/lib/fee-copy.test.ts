import { describe, expect, it } from "vitest";
import { markPaidFeeLine } from "@/lib/fee-copy";

describe("markPaidFeeLine", () => {
  // The App Store 3.1.2 guard: no pricing / free-jobs language may reach an
  // in-app surface while fee billing is off. The mark-as-paid sheet only
  // renders this line when it is non-null, so null === renders nothing.
  describe("flag OFF renders nothing", () => {
    it("returns null with free jobs remaining", () => {
      expect(
        markPaidFeeLine({
          feeBillingEnabled: false,
          freeJobsRemaining: 3,
          quoteTotalPounds: 500,
        }),
      ).toBeNull();
    });

    it("returns null with zero free jobs, small job", () => {
      expect(
        markPaidFeeLine({
          feeBillingEnabled: false,
          freeJobsRemaining: 0,
          quoteTotalPounds: 500,
        }),
      ).toBeNull();
    });

    it("returns null with zero free jobs, large job", () => {
      expect(
        markPaidFeeLine({
          feeBillingEnabled: false,
          freeJobsRemaining: 0,
          quoteTotalPounds: 5000,
        }),
      ).toBeNull();
    });
  });

  describe("flag ON surfaces the correct copy", () => {
    it("shows the free-job line while allowance remains", () => {
      expect(
        markPaidFeeLine({
          feeBillingEnabled: true,
          freeJobsRemaining: 1,
          quoteTotalPounds: 500,
        }),
      ).toBe("This is one of your free jobs — no fee.");
    });

    it("shows the £2 band at or below the £1,000 threshold", () => {
      expect(
        markPaidFeeLine({
          feeBillingEnabled: true,
          freeJobsRemaining: 0,
          quoteTotalPounds: 1000,
        }),
      ).toBe("A £2 Motko fee applies, taken out of the payment.");
    });

    it("shows the £4 band above the £1,000 threshold", () => {
      expect(
        markPaidFeeLine({
          feeBillingEnabled: true,
          freeJobsRemaining: 0,
          quoteTotalPounds: 1001,
        }),
      ).toBe("A £4 Motko fee applies, taken out of the payment.");
    });
  });
});
