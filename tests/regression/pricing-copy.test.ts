/**
 * FEE-9's governing constraint, as a test — now over the app alone.
 *
 *   The copy must never state a price the app does not charge.
 *
 * That was recorded for the FEE-3 reprice, restated on FEE-9, and broken in
 * between anyway: /pricing published "£2 a job. Never more than £10. Never a
 * percentage." for a week after FEE-6 replaced the bands with an uncapped
 * marginal ladder. Two of those three claims were the exact opposite of the
 * shipped model, and `markPaidFeeLine` was quoting the retired bands to
 * contractors inside the app at the same time.
 *
 * Nothing caught it, because nothing connected the copy to the calculation.
 * This file is that connection for the half of it that lives in this repo.
 *
 * WHAT THIS FILE NO LONGER COVERS, and it is worth being blunt about it.
 * Until SUB-3 it also read `site/pricing.html` and `site/index.html` and
 * checked every published figure against `motkoFeePennies`. That half is gone.
 * The marketing copy is published from the live website rather than from this
 * directory (Jacob, 7 Sep), so those assertions were pinning a static file
 * nobody deploys — which is worse than not checking at all, because a green
 * suite read as "the site agrees with the charge" when the site it agreed with
 * was not the one customers see. `site/` is now unverified; see its README.
 *
 * So the guarantee here is narrower and honest: whatever a contractor is told
 * inside the app about the fee is what `motkoFeePennies` will charge them.
 */

import { describe, expect, it } from "vitest";

import { markPaidFeeLine } from "@/lib/fee-copy";
import {
  FEE_CAP_BINDS_AT_PENNIES,
  FEE_CAP_PENNIES,
  motkoFeePennies,
} from "@/lib/motko-fee";
import {
  FEE_CAP,
  FEE_CAP_FROM,
  FEE_FIXED,
  FEE_RATE,
  feeTableRows,
  poundsFromPennies,
} from "@/lib/pricing-facts";

describe("the published facts are derived from the charge, not typed beside it", () => {
  // `pricing-facts.ts` is what a human reads the correct wording and figures
  // off when updating the marketing site by hand, now that no test holds the
  // site itself in step. That makes it the last derived surface in the chain,
  // so it needs pinning to `motkoFeePennies` on its own account — a stale
  // helper would hand out wrong numbers with more authority than a guess.
  it("computes every table fee by calling the fee function", () => {
    const rows = feeTableRows();

    expect(rows.length).toBeGreaterThan(0);
    for (const { jobValuePennies, serviceFeePennies } of rows) {
      expect(serviceFeePennies).toBe(motkoFeePennies(jobValuePennies, 0));
    }
  });

  it("spans the cap, so the table shows the fee flattening rather than implying it", () => {
    const rows = feeTableRows();
    const values = rows.map((row) => row.jobValuePennies);

    expect(Math.min(...values)).toBeLessThan(FEE_CAP_BINDS_AT_PENNIES);
    expect(Math.max(...values)).toBeGreaterThan(FEE_CAP_BINDS_AT_PENNIES);
    expect(rows[rows.length - 1]!.serviceFeePennies).toBe(FEE_CAP_PENNIES);
  });

  it("states the headline figures the schedule actually uses", () => {
    expect(FEE_RATE).toBe("0.99%");
    expect(FEE_CAP).toBe(poundsFromPennies(FEE_CAP_PENNIES));
    expect(FEE_CAP_FROM).toBe("£960");

    // Published as 40p while 39.6p is charged — rounded from the constant, so
    // it cannot drift, and rounded UP so every real fee sits fractionally below
    // what the headline implies rather than above it.
    expect(FEE_FIXED).toBe("£0.40");
    expect(motkoFeePennies(FEE_CAP_BINDS_AT_PENNIES, 0)).toBe(FEE_CAP_PENNIES);
  });
});

describe("in-app copy states the numbers the app actually charges", () => {
  // The half that was silently wrong. `markPaidFeeLine` named £2/£4 bands that
  // had not existed in the code since FEE-6.
  //
  // The values straddle SUB-3's cap deliberately. Under the schedule that
  // replaces the ladder — 0.99% + 39.6p, capped at £9.90 — every job over £960
  // pays exactly the cap, so a row set drawn only from four-figure jobs would
  // assert £9.90 four times and pass against a function that ignored its
  // argument entirely. Two rows sit below the knee, one sits on it.
  it.each([
    [100, 139], // £1.39 — 0.99% is 99p, and the fixed 39.6p rounds it up
    [500, 535], // £5.35 — still on the rate, well clear of the cap
    [960, 990], // £9.90 — the exact job value where the cap starts binding
    [2_000, 990], // £9.90 — flat above it
  ])("quotes the scheduled fee for a £%s job", (pounds, expectedPennies) => {
    const line = markPaidFeeLine({ freeJobsRemaining: 0, netSubtotalPounds: pounds });

    expect(motkoFeePennies(pounds * 100, 0)).toBe(expectedPennies);
    expect(line).toContain(poundsFromPennies(expectedPennies));
  });

  it("never quotes a retired band or ladder figure", () => {
    for (const pounds of [500, 1_500, 9_000, 22_000]) {
      const line = markPaidFeeLine({ freeJobsRemaining: 0, netSubtotalPounds: pounds });
      expect(line).not.toMatch(/£4\.00|£6\.00|£10\.00 Motko|£23\.00|£47\.50/);
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
    expect(markPaidFeeLine({ freeJobsRemaining: 3, netSubtotalPounds: 500 })).toMatch(
      /no service fee/i,
    );

    // The "only" half, which the assertion above cannot carry on its own. A
    // line that said this unconditionally would satisfy the free case and be a
    // false promise everywhere else.
    expect(markPaidFeeLine({ freeJobsRemaining: 0, netSubtotalPounds: 500 })).not.toMatch(
      /no service fee/i,
    );
  });
});
