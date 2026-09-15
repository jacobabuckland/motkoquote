// PASS-7 CRITICAL 1 and SERIOUS 4: the deposit the customer accepted vanished
// from the contract they signed, and was then invoiced anyway.
//
// The journey, reported 15 Sep against a live £3,600 job. Set a deposit on the
// QUOTE (25% = £900), send it, accept it, then send a contract leaving the
// contract form's separate deposit box untouched. The signed contract read:
//
//     Total quote value £3,600.00
//     Balance on completion £3,600.00
//
// no deposit line, no deposit bullet in clause 3, and the words "Where
// documents conflict, this signed contract takes precedence." The customer
// signed that, and Motko raised a £900 deposit invoice within seconds, with
// the 08:00 chaser attached to it.
//
// The cause was two sources. `depositAtSignature` read the quote's recorded
// deposit and fell back to `contracts.deposit_pct`; the contract DOCUMENT —
// the body variables, the /c/ page and the PDF — each recomputed from
// `deposit_pct` alone, in three separate copies of one expression. So the
// trigger and the paper disagreed by construction.
//
// These assert the RESOLVER every surface now shares, and the rule Jacob
// approved on 15 Sep: the quote's deposit wins; `contracts.deposit_pct`
// applies only where the quote records none; a recorded zero means no deposit
// and is never overridden.
import { describe, expect, it } from "vitest";
import {
  resolveDeposit,
  depositAtSignature,
  depositRowLabel,
  type ResolvedDeposit,
} from "@/lib/quote-deposit";

// The reported job, to the penny.
const JOB_TOTAL = 3600;
const QUOTE_DEPOSIT_PENNIES = 90_000;

describe("the deposit the customer agreed is the deposit the contract states", () => {
  it("resolves the QUOTE's deposit even when the contract form was left blank", () => {
    // The exact reported shape: quote says 25%, contract box untouched.
    const resolved = resolveDeposit(
      { total: JOB_TOTAL, deposit_pennies: QUOTE_DEPOSIT_PENNIES },
      { deposit_pct: null },
    );

    expect(resolved).not.toBeNull();
    expect(resolved?.amount).toBe(900);
    expect(resolved?.source).toBe("quote");
  });

  it("gives the document and the invoice ONE figure, never two", () => {
    // This is the whole defect stated as an equality. Before the fix the
    // document side computed from deposit_pct (null → no deposit) while the
    // trigger computed from deposit_pennies (£900) — so this failed at
    // £0 vs £900 on the one journey a customer actually takes.
    const quote = { total: JOB_TOTAL, deposit_pennies: QUOTE_DEPOSIT_PENNIES };
    const contract = { deposit_pct: null };

    const onTheDocument = resolveDeposit(quote, contract);
    const atSignature = depositAtSignature(quote, contract);

    expect(onTheDocument?.amount).toBe(atSignature?.amount);
    expect(atSignature?.amount).toBe(900);
  });

  it("leaves the balance on completion short by the deposit, not equal to the total", () => {
    // What the customer reads. £3,600 against £3,600 with a £900 bill arriving
    // is the sentence that made the contract untrue.
    const resolved = resolveDeposit(
      { total: JOB_TOTAL, deposit_pennies: QUOTE_DEPOSIT_PENNIES },
      { deposit_pct: null },
    );

    expect(JOB_TOTAL - (resolved?.amount ?? 0)).toBe(2700);
  });

  it("still honours the seven legacy rows that only have a contract percentage", () => {
    // The fallback is not being removed. A £7,200 job at 1% keeps working.
    const resolved = resolveDeposit({ total: 7200, deposit_pennies: null }, { deposit_pct: 1 });

    expect(resolved?.amount).toBe(72);
    expect(resolved?.source).toBe("contract");
  });

  it("lets a recorded ZERO override a percentage typed on the contract", () => {
    // The trade was asked and said no deposit. A stray 25% typed to clear a
    // required field must not resurrect one — on the document or the invoice.
    const quote = { total: JOB_TOTAL, deposit_pennies: 0 };
    const contract = { deposit_pct: 25 };

    expect(resolveDeposit(quote, contract)).toBeNull();
    expect(depositAtSignature(quote, contract)).toBeNull();
  });

  it("prefers the quote even when the contract states a DIFFERENT percentage", () => {
    // Two sources disagreeing is the case the rule exists to settle. The
    // customer accepted £900; a later 10% on the contract does not rewrite it.
    const resolved = resolveDeposit(
      { total: JOB_TOTAL, deposit_pennies: QUOTE_DEPOSIT_PENNIES },
      { deposit_pct: 10 },
    );

    expect(resolved?.amount).toBe(900);
    expect(resolved?.source).toBe("quote");
  });

  it("resolves nothing where neither source says anything", () => {
    expect(resolveDeposit({ total: JOB_TOTAL, deposit_pennies: null }, { deposit_pct: null })).toBeNull();
    expect(resolveDeposit({ total: JOB_TOTAL }, null)).toBeNull();
    expect(resolveDeposit({ total: JOB_TOTAL }, undefined)).toBeNull();
  });
});

describe("how a resolved deposit is labelled", () => {
  it("names the percentage only where the CONTRACT stated one", () => {
    const fromContract = resolveDeposit(
      { total: 7200, deposit_pennies: null },
      { deposit_pct: 1 },
    ) as ResolvedDeposit;

    expect(depositRowLabel(fromContract)).toBe("Deposit (1%)");
  });

  it("names no percentage for a quote deposit, which may be a flat amount", () => {
    // £500 on a £740 job is 67.57% — a figure nobody typed and nobody should
    // read on a contract. So the label states the money and stays quiet about
    // a proportion that was never agreed as one.
    const flat = resolveDeposit({ total: 740, deposit_pennies: 50_000 }, {}) as ResolvedDeposit;

    expect(flat.statedPct).toBeNull();
    expect(depositRowLabel(flat)).toBe("Deposit");
    expect(depositRowLabel(flat)).not.toMatch(/%/);
  });
});

describe("pennies and pounds do not get crossed", () => {
  it("returns POUNDS for the document and the invoice, pennies only for the column", () => {
    // Handing 90000 to createInvoiceRecord raises a £90,000 invoice on a
    // £3,600 job. The boundary is this function and nowhere else.
    const resolved = resolveDeposit(
      { total: JOB_TOTAL, deposit_pennies: QUOTE_DEPOSIT_PENNIES },
      {},
    ) as ResolvedDeposit;

    expect(resolved.pennies).toBe(90_000);
    expect(resolved.amount).toBe(900);
    expect(resolved.amount).toBeLessThan(JOB_TOTAL);
  });

  it("carries a contract-sourced deposit's pennies too, rounded once", () => {
    // 33% of £740 is £244.20. Rounded at the pound boundary and again at the
    // penny one, so the two units cannot drift apart.
    const resolved = resolveDeposit(
      { total: 740, deposit_pennies: null },
      { deposit_pct: 33 },
    ) as ResolvedDeposit;

    expect(resolved.amount).toBe(244.2);
    expect(resolved.pennies).toBe(24_420);
  });
});
