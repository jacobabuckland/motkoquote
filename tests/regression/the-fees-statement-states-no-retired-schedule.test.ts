import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FEE_SCHEDULE_SENTENCE } from "@/lib/pricing-facts";

/**
 * The fees statement states no fee schedule of its own.
 *
 * It used to state the RETIRED one, typed into the JSX by hand: "0.3% of the
 * first £5,000, 0.2% of the next £5,000 and 0.15% above £10,000, with a £2.00
 * minimum and no maximum". Every clause of that contradicts what the code
 * charges — FEE_SCHEDULE_SENTENCE, derived from motkoFeePennies, says one rate
 * on the whole job, NO minimum, and never more than the cap.
 *
 * This is FEE-9's defect (a published price the code does not charge) living
 * past its fix. /terms was moved onto the derived constant so it could not
 * drift, and tests/regression/terms-fee-schedule.test.ts holds it there. This
 * surface was missed and went on telling the contractor the old ladder.
 *
 * Nothing replaces it. The Card reports what was ACTUALLY taken, from the
 * ledger, which cannot drift from the charge because it IS the charge. The rule
 * lives at /terms, derived rather than typed.
 *
 * So this asserts the ABSENCE of a hand-typed schedule rather than the presence
 * of a better one — the failure mode being guarded is somebody restating the
 * rate here in good faith and it going stale again on the next reprice.
 */

const source = readFileSync(
  resolve(__dirname, "../../src/app/settings/fees-statement-section.tsx"),
  "utf8",
);

// Comments stripped: this file explains the deleted copy by quoting it, so a
// regex over the raw text finds the retired ladder in the prose saying it is
// gone and fails against the correct implementation.
const rendered = source.replace(/\{?\/\*[\s\S]*?\*\/\}?/g, "");

describe("the retired ladder is gone", () => {
  it("does not state the banded percentages", () => {
    expect(rendered).not.toMatch(/0\.3%/);
    expect(rendered).not.toMatch(/0\.2%/);
    expect(rendered).not.toMatch(/0\.15%/);
  });

  it("does not claim a minimum fee, which the code does not charge", () => {
    expect(rendered).not.toMatch(/minimum/i);
  });

  it("does not claim there is no maximum, when the fee is capped", () => {
    expect(rendered).not.toMatch(/no maximum/i);
  });

  it("drops the duplicated heading the Disclosure already provides", () => {
    expect(rendered).not.toMatch(/<h2[^>]*>\s*Motko fees/);
  });
});

describe("what the section still does", () => {
  it("reports what was actually taken", () => {
    // The Card is the point of the section and survives untouched.
    expect(rendered).toContain("Taken from payments");
  });

  it("still shows fees recorded but not charged", () => {
    expect(rendered).toContain("Recorded, not charged");
  });
});

describe("the real schedule stays where it is derived", () => {
  it("is one rate with no minimum and a cap, not a band ladder", () => {
    // Pinned so the deletion above cannot be read as "the ladder was right and
    // we hid it". It was wrong. This is what the code charges.
    expect(FEE_SCHEDULE_SENTENCE).toMatch(/no minimum and no banding/i);
    expect(FEE_SCHEDULE_SENTENCE).toMatch(/never more than/i);
  });

  it("is nothing like the copy that was removed", () => {
    expect(FEE_SCHEDULE_SENTENCE).not.toMatch(/0\.3%/);
  });
});
