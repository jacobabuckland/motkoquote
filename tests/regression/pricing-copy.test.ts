/**
 * FEE-9's governing constraint, as a test.
 *
 *   The site must never state a price the app does not display, and vice versa.
 *
 * That was recorded for the FEE-3 reprice, restated on FEE-9, and broken in
 * between anyway: /pricing published "£2 a job. Never more than £10. Never a
 * percentage." for a week after FEE-6 replaced the bands with an uncapped
 * marginal ladder. Two of those three claims were the exact opposite of the
 * shipped model, and `markPaidFeeLine` was quoting the retired bands to
 * contractors inside the app at the same time.
 *
 * Nothing caught it, because nothing connected the copy to the calculation.
 * This file is that connection, and the acceptance criterion it enforces is the
 * ticket's own: "Every number on /pricing matches what motkoFeePennies actually
 * returns for that job value. Verify against the function, not against this
 * ticket."
 *
 * ON READING THE HTML. AGENTS.md forbids asserting on source text, and the
 * reason — a regex over source tests how code is WRITTEN, not what it does —
 * holds for a React component that can be rendered instead. A static marketing
 * page has no component to render: the published text IS the deliverable. So
 * this reads the page's RENDERED TEXT, with tags, comments and attributes
 * stripped first, and asserts on that. A claim hidden in an attribute or
 * commented out does not count as published, and a correct reflow of the markup
 * does not break the test — which are the two properties the rule is protecting.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { markPaidFeeLine } from "@/lib/fee-copy";
import { motkoFeePennies } from "@/lib/motko-fee";
import {
  FEE_MINIMUM,
  PROCESSING_CAP,
  feeTableRows,
  poundsFromPennies,
  wholePoundsFromPennies,
} from "@/lib/pricing-facts";

const REPO_ROOT = join(__dirname, "..", "..");

/** The page as a reader sees it: no markup, no comments, whitespace collapsed. */
function publishedText(page: string): string {
  return readFileSync(join(REPO_ROOT, "site", page), "utf8")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const pricing = publishedText("pricing.html");
const home = publishedText("index.html");

describe("the retired claims are gone from everything published", () => {
  // FEE-9's first acceptance criterion, verbatim. Each of these was live on
  // motko.co.uk and each is now false.
  const withdrawn = [
    "never more than",
    "never a percentage",
    "£2 a job",
    "VAT-inclusive",
    "VAT inclusive",
    "£6 per job",
    "£10 per job",
  ];

  it.each(withdrawn)("no page still says %s", (claim) => {
    expect(pricing.toLowerCase()).not.toContain(claim.toLowerCase());
    expect(home.toLowerCase()).not.toContain(claim.toLowerCase());
  });

  it("does not claim the fee is capped, because it is not", () => {
    expect(pricing).not.toMatch(/never more than|capped at £10|maximum fee/i);
    expect(pricing).toMatch(/no maximum/i);
  });

  it("states the ladder is marginal, not a flat rate on the whole job", () => {
    // The property contractors get wrong. Someone reading 0.15% as applying to
    // all of a £15,000 job expects £22.50 and is charged £32.50.
    expect(pricing).toMatch(/applies only to the part of the job/i);
  });
});

describe("every published figure matches what motkoFeePennies returns", () => {
  it.each(feeTableRows())(
    "publishes the real fee for a $jobValuePennies-penny job",
    ({ jobValuePennies, serviceFeePennies }) => {
      // The row is on the page...
      expect(pricing).toContain(wholePoundsFromPennies(jobValuePennies));
      expect(pricing).toContain(poundsFromPennies(serviceFeePennies));

      // ...and the figure it publishes is the function's, not a typed one.
      expect(serviceFeePennies).toBe(motkoFeePennies(jobValuePennies, 0));
    },
  );

  it("publishes a fee large enough that 'no maximum' is visible rather than implied", () => {
    // The card asks for the table to "extend high enough that a large job's fee
    // is visible". A table stopping at £5,000 satisfies every other assertion
    // here and still leaves the reader to guess at the number that matters.
    const rows = feeTableRows();
    const largest = rows[rows.length - 1];
    expect(largest.jobValuePennies).toBeGreaterThanOrEqual(2_000_000);
    expect(pricing).toContain(poundsFromPennies(largest.serviceFeePennies));
  });

  it("states the minimum and the processing cap", () => {
    expect(pricing).toContain(FEE_MINIMUM);
    expect(pricing).toContain(PROCESSING_CAP);
  });

  it("states all three rates and both breakpoints", () => {
    for (const rate of ["0.3%", "0.2%", "0.15%"]) expect(pricing).toContain(rate);
    for (const breakpoint of ["£5,000", "£10,000"]) expect(pricing).toContain(breakpoint);
  });
});

describe("the four charging rules the card requires stated", () => {
  it("says the fee is on the ex-VAT job value", () => {
    expect(pricing).toMatch(/excluding VAT/i);
  });

  it("says the fee is per payment, and what that means for a staged job", () => {
    expect(pricing).toMatch(/charged per payment/i);
    expect(pricing).toMatch(/paid in stages is charged on each stage/i);
  });

  it("keeps the promise that is still true", () => {
    expect(pricing).toMatch(/nothing is charged until you have been paid/i);
  });

  it("publishes the reprice rule rather than leaving it implicit", () => {
    // The card: "Decide one rule and publish it ... Do not leave it implicit."
    // Decided 31 Aug: the payment date governs.
    expect(pricing).toMatch(/worked out when your customer pays, not when you send the quote/i);
  });
});

describe("VAT is described as it actually is", () => {
  it("says motko is not registered", () => {
    expect(pricing).toMatch(/not currently registered for VAT/i);
  });

  it("says what changes on registration, including the pass-through", () => {
    expect(pricing).toMatch(/when motko registers for VAT/i);
    expect(pricing).toMatch(/cost plus VAT/i);
  });
});

describe("the free-job copy matches what settlement actually does", () => {
  // This is the assertion that would have caught FEE-9 publishing FEE-11's
  // model before FEE-11 shipped. The card says the base-band caveat "is gone",
  // but `planPaidJobSettlement` still caps the waiver at the base band — so
  // removing the caveat would have republished the same class of false promise
  // this ticket exists to withdraw, one ticket later.
  it("states the waiver cap that settlement applies", () => {
    expect(pricing).toContain(FEE_MINIMUM);
    expect(pricing).toMatch(/free job covers the standard £2\.00 service fee/i);
    expect(pricing).toMatch(/you pay the difference above £2\.00/i);
  });

  it("says a credit covers one payment, not a whole job", () => {
    expect(pricing).toMatch(/applied to one payment/i);
    expect(pricing).toMatch(/credit covers one stage/i);
  });

  it("says processing is still charged on a free job", () => {
    expect(pricing).toMatch(/processing is charged on a free job/i);
  });

  it("still promises three free jobs on both pages", () => {
    expect(pricing).toMatch(/first three jobs are free/i);
    expect(home).toMatch(/first three jobs are free/i);
  });
});

describe("in-app copy states the same numbers as the site", () => {
  // The half that was silently wrong. `markPaidFeeLine` named £2/£4 bands that
  // had not existed in the code since FEE-6.
  it.each([
    [500, 200], // 0.3% is £1.50; the £2.00 floor bites
    [1_000, 300],
    [2_500, 750],
    [9_000, 2_300],
  ])("quotes the ladder fee for a £%s job", (pounds, expectedPennies) => {
    const line = markPaidFeeLine({ freeJobsRemaining: 0, quoteTotalPounds: pounds });

    expect(motkoFeePennies(pounds * 100, 0)).toBe(expectedPennies);
    expect(line).toContain(poundsFromPennies(expectedPennies));
  });

  it("never quotes a retired band", () => {
    for (const pounds of [500, 1_500, 9_000, 22_000]) {
      const line = markPaidFeeLine({ freeJobsRemaining: 0, quoteTotalPounds: pounds });
      expect(line).not.toMatch(/£4\.00|£6\.00|£10\.00 Motko/);
    }
  });

  it("does not call the fee VAT-inclusive anywhere in the app copy", () => {
    const lines = [
      markPaidFeeLine({ freeJobsRemaining: 0, quoteTotalPounds: 1_000 }),
      markPaidFeeLine({ freeJobsRemaining: 2, quoteTotalPounds: 1_000 }),
    ];
    for (const line of lines) expect(line).not.toMatch(/VAT/i);
  });

  it("tells a free-job contractor what is left to pay, rather than 'no fee'", () => {
    // A £9,000 job's fee is £23.00 and a credit waives £2.00 of it. "This is
    // one of your free jobs — no fee" is what this line used to say, and it
    // would be wrong by £21.
    const line = markPaidFeeLine({ freeJobsRemaining: 3, quoteTotalPounds: 9_000 });
    expect(line).toContain("£21.00");
    expect(line).not.toMatch(/no service fee/i);
  });

  it("says 'no service fee' only when nothing is in fact payable", () => {
    const line = markPaidFeeLine({ freeJobsRemaining: 3, quoteTotalPounds: 500 });
    expect(line).toMatch(/no service fee/i);
  });
});
