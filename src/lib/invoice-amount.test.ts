import { describe, it, expect } from "vitest";
import { deriveInvoiceAmount } from "@/lib/invoice-amount";

const signedContract = (pct: number | null) => ({ deposit_pct: pct, status: "signed" });

describe("deriveInvoiceAmount — deposit", () => {
  it("derives the deposit from the signed contract's percentage, ignoring any client intent", () => {
    const amount = deriveInvoiceAmount("deposit", 1000, [], [signedContract(25)]);
    expect(amount).toBe(250);
  });

  it("rounds to pennies", () => {
    const amount = deriveInvoiceAmount("deposit", 999.99, [], [signedContract(33)]);
    expect(amount).toBe(330); // round(329.9967)
  });

  it("refuses a second deposit", () => {
    expect(() =>
      deriveInvoiceAmount(
        "deposit",
        1000,
        [{ amount: 250, invoice_type: "deposit" }],
        [signedContract(25)],
      ),
    ).toThrow(/already been raised/i);
  });

  it("refuses a deposit when no contract sets a percentage", () => {
    expect(() => deriveInvoiceAmount("deposit", 1000, [], [signedContract(null)])).toThrow(
      /deposit percentage/i,
    );
    expect(() => deriveInvoiceAmount("deposit", 1000, [], [])).toThrow(/deposit percentage/i);
  });

  it("prefers a signed contract's percentage over an unsigned one", () => {
    const amount = deriveInvoiceAmount("deposit", 1000, [], [
      { deposit_pct: 10, status: "sent" },
      { deposit_pct: 40, status: "signed" },
    ]);
    expect(amount).toBe(400);
  });
});

describe("deriveInvoiceAmount — final", () => {
  it("is the quote total when nothing has been invoiced yet", () => {
    expect(deriveInvoiceAmount("final", 1000, [], [])).toBe(1000);
  });

  it("is the balance after an existing deposit — never the full total again", () => {
    const amount = deriveInvoiceAmount(
      "final",
      1000,
      [{ amount: 250, invoice_type: "deposit" }],
      [signedContract(25)],
    );
    expect(amount).toBe(750);
  });

  it("refuses a final invoice once the quote is fully invoiced", () => {
    expect(() =>
      deriveInvoiceAmount(
        "final",
        1000,
        [
          { amount: 250, invoice_type: "deposit" },
          { amount: 750, invoice_type: "final" },
        ],
        [signedContract(25)],
      ),
    ).toThrow(/fully invoiced/i);
  });
});

describe("deriveInvoiceAmount — invoiced sum never exceeds the quote total", () => {
  it("caps the sum of all raised invoices at the quote total across deposit then final", () => {
    const total = 1000;
    const deposit = deriveInvoiceAmount("deposit", total, [], [signedContract(30)]);
    const raised = [{ amount: deposit, invoice_type: "deposit" }];
    const final = deriveInvoiceAmount("final", total, raised, [signedContract(30)]);
    expect(deposit + final).toBe(total);
  });
});
