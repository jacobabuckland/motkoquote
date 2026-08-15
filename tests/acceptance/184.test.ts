import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

// Retired by PAY-5 (#211). This asserted src/lib/correct-stranded-fee-jobs.ts
// exists and exports correctStrandedFeeJobs. That module corrected jobs stranded
// by the VRP fee-collection batch, and PAY-4 moved fee collection to source via
// Stripe application fees — so the batch, and the correction it needed, are both
// gone. The criterion is inverted rather than deleted so the removal stays
// asserted: nothing should reintroduce the module without revisiting this.
describe("Issue #184: stranded fee-job correction (retired by PAY-5)", () => {
  it("correct-stranded-fee-jobs.ts is gone with the VRP collection path", () => {
    const modulePath = resolve(
      __dirname,
      "../../src/lib/correct-stranded-fee-jobs.ts",
    );
    expect(existsSync(modulePath)).toBe(false);
  });
});
