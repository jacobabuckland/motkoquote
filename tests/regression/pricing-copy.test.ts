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

  it("states the minimum", () => {
    expect(pricing).toContain(FEE_MINIMUM);
  });

  it("advertises NO processing pass-through, because FEE-7 was dropped", () => {
    // An earlier draft of this page published "payment processing, at cost,
    // capped at £5.00". FEE-7 (#475) was dropped on 31 Aug, so motko absorbs
    // that cost and the charge does not exist. Publishing it would be the same
    // defect as publishing the retired bands — a price the app does not make —
    // one ticket after this file was written to prevent exactly that.
    expect(pricing).not.toMatch(/capped at £5|processing.{0,40}pass-through|passed through at cost/i);
    expect(pricing).toMatch(/motko absorbs the cost/i);
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

  it("says what changes on registration", () => {
    // The pass-through half of this sentence went with FEE-7 (#475). What is
    // left is the part that is still true and still needs saying before it
    // happens: VAT gets added to the fee.
    expect(pricing).toMatch(/when motko registers for VAT/i);
    expect(pricing).toMatch(/VAT will be added to the fee/i);
    expect(pricing).toMatch(/before it takes effect/i);
  });
});

describe("the free-job copy matches what settlement actually does", () => {
  // This is the assertion that would have caught FEE-9 publishing FEE-11's
  // model before FEE-11 shipped. The card says the base-band caveat "is gone",
  // but `planPaidJobSettlement` still caps the waiver at the base band — so
  // removing the caveat would have republished the same class of false promise
  // this ticket exists to withdraw, one ticket later.
  it("states the waiver that settlement applies — now the WHOLE fee", () => {
    // This assertion has changed twice and both times the test forced it,
    // which is the whole reason it exists. FEE-9 shipped with the £2.00 cap
    // because that is what planPaidJobSettlement did, against the card's
    // instruction to remove it. FEE-11 raised the ceiling, and this failed
    // until the copy followed — the copy cannot drift from the charge without
    // a red build in between.
    expect(pricing).toMatch(/free job covers the whole motko fee/i);
    expect(pricing).not.toMatch(/difference above £2/i);
  });

  it("states the banked-credit cap, which FEE-9 had to omit", () => {
    // Omitted from FEE-9 deliberately: FEE-11 sets the number and recorded it
    // as unconfirmed, so publishing one then risked the site being wrong the
    // day FEE-11 landed. Confirmed at 10 on 1 Sep.
    expect(pricing).toMatch(/hold up to 10 at a time/i);
  });

  it("says a credit covers one payment, not a whole job", () => {
    expect(pricing).toMatch(/applied to one payment/i);
    expect(pricing).toMatch(/credit covers one stage/i);
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
    const line = markPaidFeeLine({ freeJobsRemaining: 0, netSubtotalPounds: pounds });

    expect(motkoFeePennies(pounds * 100, 0)).toBe(expectedPennies);
    expect(line).toContain(poundsFromPennies(expectedPennies));
  });

  it("never quotes a retired band", () => {
    for (const pounds of [500, 1_500, 9_000, 22_000]) {
      const line = markPaidFeeLine({ freeJobsRemaining: 0, netSubtotalPounds: pounds });
      expect(line).not.toMatch(/£4\.00|£6\.00|£10\.00 Motko/);
    }
  });

  it("does not call the fee VAT-inclusive anywhere in the app copy", () => {
    const lines = [
      markPaidFeeLine({ freeJobsRemaining: 0, netSubtotalPounds: 1_000 }),
      markPaidFeeLine({ freeJobsRemaining: 2, netSubtotalPounds: 1_000 }),
    ];
    for (const line of lines) expect(line).not.toMatch(/VAT/i);
  });

  it("tells a free-job contractor there is nothing to pay, at any job size", () => {
    // Under FEE-2's ceiling this line owed £21.00 on a £9,000 job while the
    // site said the job was free. FEE-11 closed that gap in the charge; this
    // asserts the copy followed rather than being left behind, which is the
    // direction the drift has gone every previous time.
    for (const pounds of [500, 9_000, 22_000]) {
      const line = markPaidFeeLine({ freeJobsRemaining: 3, netSubtotalPounds: pounds });
      expect(line).toMatch(/no service fee/i);
    }
  });

  it("says 'no service fee' only when nothing is in fact payable", () => {
    const line = markPaidFeeLine({ freeJobsRemaining: 3, netSubtotalPounds: 500 });
    expect(line).toMatch(/no service fee/i);
  });
});
