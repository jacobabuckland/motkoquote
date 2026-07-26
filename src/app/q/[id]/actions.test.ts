import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  const notify = vi.fn();

  const state: {
    quoteRow: unknown;
    updateResult: { data: unknown; error: unknown };
    capturedFilters: [string, unknown][];
  } = { quoteRow: undefined, updateResult: { data: [], error: null }, capturedFilters: [] };

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
      b.maybeSingle = () => Promise.resolve({ data: state.quoteRow, error: null });
      return b;
    },
  };

  return { notify, state, admin };
});

vi.mock("@/lib/notify-contractor", () => ({ notifyContractorOfCustomerAction: h.notify }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.admin }));

import { acceptQuote, declineQuote } from "./actions";

const jobRow = { job_id: "job-1", job: { customer: { name: "Dave" } } };

describe("acceptQuote — legal-prior-state guard (H4 symmetric)", () => {
  beforeEach(() => {
    h.notify.mockReset();
    h.state.capturedFilters = [];
    h.state.quoteRow = jobRow;
  });

  it("no-ops (no notification) when the quote was already declined", async () => {
    h.state.updateResult = { data: [], error: null }; // .eq("status","sent") matches nothing
    await acceptQuote("q-1");
    expect(h.state.capturedFilters).toContainEqual(["status", "sent"]);
    expect(h.notify).not.toHaveBeenCalled();
  });

  it("accepts a sent quote and notifies once", async () => {
    h.state.updateResult = { data: [{ id: "q-1" }], error: null };
    await acceptQuote("q-1");
    expect(h.state.capturedFilters).toContainEqual(["status", "sent"]);
    expect(h.notify).toHaveBeenCalledTimes(1);
  });
});

describe("declineQuote — legal-prior-state guard (H4 symmetric)", () => {
  beforeEach(() => {
    h.notify.mockReset();
    h.state.capturedFilters = [];
    h.state.quoteRow = jobRow;
  });

  it("no-ops when the quote was already accepted", async () => {
    h.state.updateResult = { data: [], error: null };
    await declineQuote("q-1");
    expect(h.state.capturedFilters).toContainEqual(["status", "sent"]);
    expect(h.notify).not.toHaveBeenCalled();
  });

  it("declines a sent quote and notifies once", async () => {
    h.state.updateResult = { data: [{ id: "q-1" }], error: null };
    await declineQuote("q-1");
    expect(h.notify).toHaveBeenCalledTimes(1);
  });
});
