/**
 * A cost added by voice keeps what was said about VAT and about payment.
 *
 * Voice cost capture carried one number and nothing else: `completeCostCapture`
 * parsed a single `amount_words` into `amountNet`, hardcoded
 * `vatTreatment: "standard"`, and had no paid parameter at all. The database
 * schema has had `vatAmount`, `vatTreatment` and `paid` throughout — only this
 * path never filled them.
 *
 * Measured across five voice costs on 16 Sep:
 *
 *   * "a hundred plus twenty VAT, a hundred and twenty on the card" saved
 *     amountNet 120.00 and vatAmount null. The gross became the net, which
 *     overstates the cost and loses £20 of reclaimable VAT.
 *   * a helper explicitly described as not VAT registered was filed standard.
 *   * both costs said out loud to be paid saved paid=false, so the money page
 *     reported £457.50 outstanding against a true £177.50.
 *
 * The arithmetic lives here rather than in the model, the same division of
 * labour `amount_words` already has. Splitting a gross figure at a known rate
 * is arithmetic; ASSUMING the basis, which is what the old path did, is the
 * invention.
 */

import { describe, expect, it } from "vitest";
import { resolveCostBasis } from "@/lib/cost-vat-basis";

describe("the card purchase that was filed as net", () => {
  // Run 2: "a hundred quid plus twenty VAT — a hundred and twenty on the card".
  it("keeps the net at £100 when the VAT was stated beside a gross figure", () => {
    const resolved = resolveCostBasis({
      amountPence: 12000,
      basis: "gross",
      treatment: "standard",
      statedVatPence: 2000,
    });

    expect(resolved).toEqual({
      ok: true,
      amountNet: 10000,
      vatAmount: 2000,
      vatTreatment: "standard",
    });
  });

  it("splits a gross figure the contractor gave without a VAT amount", () => {
    // £120 inc VAT at the standard rate is £100 + £20. That is what VAT MEANS
    // at a known rate, not a guess about it.
    const resolved = resolveCostBasis({ amountPence: 12000, basis: "gross", treatment: "standard" });

    expect(resolved).toEqual({
      ok: true,
      amountNet: 10000,
      vatAmount: 2000,
      vatTreatment: "standard",
    });
  });

  it("adds the VAT to a net figure rather than moving the number", () => {
    const resolved = resolveCostBasis({ amountPence: 10000, basis: "net", treatment: "standard" });

    expect(resolved).toEqual({
      ok: true,
      amountNet: 10000,
      vatAmount: 2000,
      vatTreatment: "standard",
    });
  });
});

describe("the helper who is not VAT registered", () => {
  // Run 5: £160 cash, no VAT anywhere in it.
  it("records no VAT and says why, rather than filing it standard", () => {
    const resolved = resolveCostBasis({ amountPence: 16000, basis: "unknown", treatment: "zero" });

    expect(resolved).toEqual({ ok: true, amountNet: 16000, vatAmount: 0, vatTreatment: "zero" });
  });

  it("does not need the basis at all, because net and gross are the same", () => {
    // Worth pinning: the assistant must not ask a pointless question here.
    for (const treatment of ["zero", "exempt", "reverse_charge"] as const) {
      expect(
        resolveCostBasis({ amountPence: 16000, basis: "unknown", treatment }).ok,
        `${treatment} has no VAT to separate, so the basis cannot matter`,
      ).toBe(true);
    }
  });
});

describe("an amount whose basis nobody gave", () => {
  it("refuses, so the assistant asks", () => {
    // The two answers are 20% apart. Jacob's call, 16 Sep: ask.
    const resolved = resolveCostBasis({ amountPence: 9000, basis: "unknown", treatment: "standard" });

    expect(resolved).toEqual({ ok: false, reason: "ambiguous_basis" });
  });

  it("does not refuse once a VAT amount settles it", () => {
    const resolved = resolveCostBasis({
      amountPence: 9000,
      basis: "unknown",
      treatment: "standard",
      statedVatPence: 1500,
    });

    expect(resolved.ok).toBe(true);
  });

  it("asks when the treatment is unknown too, because that is the same question", () => {
    // RETIRED, 16 Sep: this used to record the figure as given, on the
    // reasoning that with no treatment there is "nothing to separate and
    // nothing to assume". The reasoning was wrong about which case it served.
    // A contractor who just names a figure — the commonest way anyone says an
    // amount — produces unknown/unknown, not unknown/standard, so the refusal
    // built for exactly that person never ran. Measured live: "a hundred and
    // twenty" at a merchant saved as £120.00 net with no VAT, and the only
    // question asked was whether the amount was right.
    const resolved = resolveCostBasis({ amountPence: 9000, basis: "unknown", treatment: "unknown" });

    expect(resolved).toEqual({ ok: false, reason: "ambiguous_basis" });
  });

  it("does not ask when the contractor gave the basis but not the rate", () => {
    // Only the basis is worth a question. "Ninety quid plus whatever the VAT
    // is" tells us what the figure MEANS, which is the ambiguity that moves
    // the number; the rate being unstated does not.
    const resolved = resolveCostBasis({ amountPence: 9000, basis: "net", treatment: "unknown" });

    expect(resolved).toEqual({
      ok: true,
      amountNet: 9000,
      vatAmount: null,
      vatTreatment: "unknown",
    });
  });
});

describe("the ordinary costs that were already right", () => {
  // Runs 1, 3 and 4 saved the correct net. They must keep doing so.
  const UNCHANGED: Array<[string, number]> = [
    ["run 1, £84 of materials", 8400],
    ["run 3, £48 after correcting £60", 4800],
    ["run 4, £45.50 of plant hire", 4550],
  ];

  for (const [label, amountPence] of UNCHANGED) {
    it(`leaves ${label} at its stated net`, () => {
      const resolved = resolveCostBasis({ amountPence, basis: "net", treatment: "standard" });

      expect(resolved.ok && resolved.amountNet).toBe(amountPence);
    });
  }

  it("keeps the pence on £45.50 through a gross split", () => {
    // £54.60 inc VAT is exactly £45.50 + £9.10. A split that dropped a penny
    // here would be the kind of error nobody notices until a return is filed.
    const resolved = resolveCostBasis({ amountPence: 5460, basis: "gross", treatment: "standard" });

    expect(resolved).toEqual({
      ok: true,
      amountNet: 4550,
      vatAmount: 910,
      vatTreatment: "standard",
    });
  });
});
