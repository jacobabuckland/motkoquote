import { describe, expect, it } from "vitest";
import { dashboardSection } from "@/lib/dashboard-sections";
import type { ContractState, InvoiceState, QuoteState } from "@/lib/job-stages";

// The defect: an accepted quote whose contract was SENT but not signed appeared
// under "Accepted quotes awaiting invoice" — offering a Final invoice one tap
// from sending, before signature and before any work — AND under "Contracts
// awaiting signature", simultaneously. The dashboard derived the two sections
// from independent row counts (`invoices.length === 0`, `contracts.length === 0`)
// and never looked at contract status, so both were satisfied at once.

const accepted: QuoteState = {
  status: "accepted",
  sent_at: "2026-08-20T09:00:00Z",
  viewed_at: "2026-08-21T09:00:00Z",
  accepted_at: "2026-08-28T09:00:00Z",
  declined_at: null,
};

const contract = (status: string): ContractState => ({
  id: "contract-1",
  status,
  sent_at: "2026-08-28T10:00:00Z",
  signed_at: status === "signed" ? "2026-08-28T11:00:00Z" : null,
  deposit_pct: null,
});

const invoice = (): InvoiceState => ({
  id: "invoice-1",
  status: "sent",
  invoice_type: "final",
  due_date: "2026-09-11",
  created_at: "2026-08-29T09:00:00Z",
  paid_at: null,
});

describe("dashboardSection", () => {
  it("offers the contract for an accepted quote that has none", () => {
    expect(dashboardSection(accepted, null, [])).toBe("awaiting_contract");
  });

  it("offers NEITHER action while a contract is out for signature", () => {
    // The regression. Previously this job was in both sections at once; the
    // job belongs to the "Contracts awaiting signature" query alone.
    expect(dashboardSection(accepted, contract("sent"), [])).toBeNull();
  });

  it("offers the invoice only once the contract is signed", () => {
    expect(dashboardSection(accepted, contract("signed"), [])).toBe("awaiting_invoice");
  });

  it("stops offering the invoice once one exists", () => {
    expect(dashboardSection(accepted, contract("signed"), [invoice()])).toBeNull();
  });

  it("offers nothing on a declined contract", () => {
    expect(dashboardSection(accepted, contract("declined"), [])).toBeNull();
  });

  it("never puts one job in both sections, across every contract state", () => {
    const states: ContractState[] = [
      null,
      contract("sent"),
      contract("signed"),
      contract("declined"),
    ];
    for (const state of states) {
      for (const invoices of [[], [invoice()]]) {
        const section = dashboardSection(accepted, state, invoices);
        // A single return value cannot be two sections — the assertion that
        // matters is that it is always one of the three legal answers, so a
        // future situation added to job-stages cannot silently fall into both
        // filters the way the row-count version did.
        expect(["awaiting_contract", "awaiting_invoice", null]).toContain(section);
      }
    }
  });
});
