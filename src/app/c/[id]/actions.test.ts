import { describe, it, expect, vi, beforeEach } from "vitest";

// Hoisted so the vi.mock factories below (which run before module-body code) can
// safely reference the mocks and the admin-client stub.
const h = vi.hoisted(() => {
  const createInvoiceRecord = vi.fn();
  const notify = vi.fn();

  // Mutable per-test state read at call time by the admin stub.
  const state: {
    contractRow: unknown;
    updateResult: { data: unknown; error: unknown };
    capturedFilters: [string, unknown][];
  } = { contractRow: undefined, updateResult: { data: [], error: null }, capturedFilters: [] };

  // Admin-client stub. `from()` returns a fresh builder each call; the read chain
  // ends in .single(), the write chain in .update().eq()…​.select("id"). Filters
  // applied after .update() are recorded so a test can prove the transition
  // asserts status = 'sent'.
  const admin = {
    from: () => {
      const b: Record<string, unknown> = { _upd: false };
      b.select = (_c?: string) => (b._upd ? Promise.resolve(state.updateResult) : b);
      b.update = () => {
        b._upd = true;
        return b;
      };
      b.eq = (k: string, v: unknown) => {
        if (b._upd) state.capturedFilters.push([k, v]);
        return b;
      };
      b.single = () => Promise.resolve({ data: state.contractRow, error: null });
      b.maybeSingle = () => Promise.resolve({ data: state.contractRow, error: null });
      return b;
    },
  };

  return { createInvoiceRecord, notify, state, admin };
});

vi.mock("@/lib/invoicing", () => ({ createInvoiceRecord: h.createInvoiceRecord }));
vi.mock("@/lib/notify-contractor", () => ({ notifyContractorOfCustomerAction: h.notify }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.admin }));

import { signContract, declineContract } from "./actions";

const sentContract = {
  status: "sent",
  deposit_pct: 25,
  quote: {
    id: "quote-1",
    total: 1000,
    job: {
      id: "job-1",
      customer: { name: "Dave", contact: { email: "d@example.com" } },
      contractor: { company_name: "Acme", payout_details_complete: true },
    },
  },
};

describe("signContract — legal-prior-state guard (H4)", () => {
  beforeEach(() => {
    h.createInvoiceRecord.mockReset();
    h.notify.mockReset();
    h.state.capturedFilters = [];
    h.state.updateResult = { data: [{ id: "c-1" }], error: null };
  });

  it("does NOT sign or raise a deposit invoice for a declined contract", async () => {
    h.state.contractRow = { ...sentContract, status: "declined" };
    await signContract("c-1", "Attacker");
    expect(h.createInvoiceRecord).not.toHaveBeenCalled();
    expect(h.notify).not.toHaveBeenCalled();
  });

  it("does NOT sign an already-signed contract (idempotent no-op)", async () => {
    h.state.contractRow = { ...sentContract, status: "signed" };
    await signContract("c-1", "Dave");
    expect(h.createInvoiceRecord).not.toHaveBeenCalled();
    expect(h.notify).not.toHaveBeenCalled();
  });

  it("signs a sent contract, asserting status='sent' in the UPDATE, and raises the deposit invoice", async () => {
    h.state.contractRow = { ...sentContract, status: "sent" };
    await signContract("c-1", "Dave");
    expect(h.state.capturedFilters).toContainEqual(["status", "sent"]);
    expect(h.createInvoiceRecord).toHaveBeenCalledTimes(1);
    expect(h.notify).toHaveBeenCalledTimes(1);
  });

  it("does not raise a deposit invoice if a concurrent request won the sign race", async () => {
    h.state.contractRow = { ...sentContract, status: "sent" };
    h.state.updateResult = { data: [], error: null };
    await signContract("c-1", "Dave");
    expect(h.createInvoiceRecord).not.toHaveBeenCalled();
  });
});

describe("declineContract — legal-prior-state guard (H4)", () => {
  beforeEach(() => {
    h.notify.mockReset();
    h.state.capturedFilters = [];
    h.state.updateResult = { data: [{ id: "c-1" }], error: null };
  });

  it("does NOT decline an already-signed contract", async () => {
    h.state.contractRow = { status: "signed", quote: { job: { id: "job-1", customer: { name: "Dave" } } } };
    await declineContract("c-1");
    expect(h.notify).not.toHaveBeenCalled();
  });

  it("declines a sent contract, asserting status='sent' in the UPDATE", async () => {
    h.state.contractRow = { status: "sent", quote: { job: { id: "job-1", customer: { name: "Dave" } } } };
    await declineContract("c-1");
    expect(h.state.capturedFilters).toContainEqual(["status", "sent"]);
    expect(h.notify).toHaveBeenCalledTimes(1);
  });
});
