import { describe, expect, it } from "vitest";
import { summariseAccruedFees, type AccruedFeeJob } from "@/lib/fee-statement";
import { splitFeeVat } from "@/lib/motko-fee";

/**
 * The fee statement lost its screen, not its function.
 *
 * On 13 Sep the "Motko fees" Disclosure was removed from Settings. What it
 * showed was a running LIFETIME total of every fee ever taken — a number that
 * only grows, greeting the trade each time they open Settings, and reading as
 * an accumulating cost rather than as the per-job charge it is.
 *
 * Nothing about the fee itself changed. This file pins the half that must
 * survive the removal, because the failure mode is somebody tidying up an
 * unmounted component six months from now and taking the machinery with it.
 *
 * WHY THERE IS NO ASSERTION HERE THAT THE SECTION IS GONE.
 * Every existing test of that section read `settings/page.tsx` as text and
 * matched it with a regex — and eleven of those assertions, frozen, are what
 * blocked this removal for a full cycle and had to be retired to land it. A
 * new source-text guard would put the same permanent constraint back on
 * page.tsx, in the opposite direction, and the next person to move a section
 * would pay for it again. The rule in AGENTS.md is not a style preference and
 * this ticket is the bill for breaking it. The removal is a deletion; it is
 * verified by the retired contracts no longer demanding the mount, and by
 * 359's surviving order chain, which still pins every section that remains.
 *
 * THE VAT RECORD IS WHY THE COMPONENT STAYS IN THE TREE, unmounted. The
 * per-payment net/VAT breakdown is the only record a VAT-registered trade had
 * of the input VAT on our fee, and remounting it — as its own page, or behind
 * a download — should be a one-line change rather than a rebuild.
 */

describe("the ledger the statement read is untouched", () => {
  it("still splits a fee into net and VAT", () => {
    // The numbers a trade's accountant needs. If the removal had reached the
    // fee machinery, this is what would have gone with it.
    const split = splitFeeVat(400);
    expect(split.grossPennies).toBe(400);
    expect(split.netPennies + split.vatPennies).toBe(split.grossPennies);
    expect(split.vatPennies).toBeGreaterThan(0);
  });

  it("still totals fees across jobs, net and VAT kept apart", () => {
    const jobs: AccruedFeeJob[] = [
      { feeAmountPennies: 400, netPennies: 333, vatPennies: 67, settlementState: null },
      { feeAmountPennies: 600, netPennies: 500, vatPennies: 100, settlementState: null },
    ];

    const total = summariseAccruedFees(jobs);
    expect(total.jobCount).toBe(2);
    expect(total.grossPennies).toBe(1000);
    expect(total.netPennies).toBe(833);
    expect(total.vatPennies).toBe(167);
  });
});

describe("the component is kept so the record can be given back", () => {
  it("is still exported and still a component", async () => {
    const mod = await import("@/app/settings/fees-statement-section");
    expect(
      typeof mod.FeesStatementSection,
      "kept unmounted ON PURPOSE — it is the only surface that ever showed a " +
        "trade the input VAT on our fees. Deleting it as dead code turns " +
        "giving that record back into a rebuild.",
    ).toBe("function");
  });
});
