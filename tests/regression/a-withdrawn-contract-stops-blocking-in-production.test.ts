// PASS-13 SERIOUS 2 and CRITICAL 1: CONTRACT-3 shipped as a complete no-op.
//
// #792 taught `quoteEditability` to read `contract.status`, so a withdrawn or
// declined contract would stop freezing the quote it came from. The logic was
// right. It never ran, because all three callers select
//
//     contract:contracts(id)
//
// with no `status` field. The guard's fallback is:
//
//     "status" in contract ? !NO_LONGER_BLOCKS.has(contract.status) : true
//
// so an object without the key takes the `: true` branch and blocks — exactly
// the behaviour the item removed. Pass 13 found a declined £960 job still
// reading "Nothing needs you here" with no way to edit or re-issue.
//
// The reason it passed review is the reason this file exists. #792's regression
// test called `quoteEditability` DIRECTLY with `{ id, status: "withdrawn" }`,
// so it proved the branch worked while saying nothing about whether any caller
// supplied the field. AGENTS.md: *assert the query, not the rows* — the stub
// returns whatever it was handed, so the only thing worth checking is what the
// code ASKED FOR.
//
// This is also the `has_pricing_history === false` trap again: a guard whose
// missing input silently selects the unsafe branch. The default stays
// "blocking" on purpose — unfreezing a quote with a LIVE contract is the worse
// failure — so the omission has to be caught here instead.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { mockSupabaseClient } from "../helpers/supabase";

beforeEach(() => {
  vi.resetModules();
});

describe("the query behind the withdrawn-contract guard", () => {
  // The three server actions whose selects feed `quoteEditability`. Each is
  // driven with a stubbed client and the SELECT it issued is inspected: a
  // contract embed that does not carry `status` cannot answer the question the
  // guard asks, so the guard refuses and the fix is inert.
  const UUID = "00000000-0000-4000-8000-000000000001";

  const callers: {
    name: string;
    run: (m: typeof import("@/app/jobs/actions")) => Promise<unknown>;
  }[] = [
    { name: "redraftJob", run: (m) => m.redraftJob({ jobId: UUID }) },
    {
      name: "setQuotePricingMode",
      run: (m) =>
        m.setQuotePricingMode({ jobId: UUID, quoteId: UUID, mode: "fixed", fixedAmount: 1000 }),
    },
    {
      name: "updateQuoteLineItems",
      run: (m) => m.updateQuoteLineItems({ jobId: UUID, quoteId: UUID, lineItems: [] }),
    },
  ];

  for (const caller of callers) {
    it(`${caller.name} asks the contract embed for its status`, async () => {
      vi.resetModules();
      // One row satisfies every lookup on the way in — the stub returns it for
      // contractors, jobs and quotes alike. `auth` is added because these
      // actions gate on a signed-in user before they reach the query under
      // test, and a client without it bails first.
      const { client, select } = mockSupabaseClient([
        { id: UUID, owner_user_id: "user_1", sow_json: {}, status: "accepted", total: 1000 },
      ]);
      const authed = Object.assign(client, {
        auth: { getUser: async () => ({ data: { user: { id: "user_1" } }, error: null }) },
      });
      vi.doMock("@/lib/supabase/server", () => ({ createClient: async () => authed }));
      vi.doMock("next/cache", () => ({ revalidatePath: () => {} }));

      const mod = await import("@/app/jobs/actions");
      // The action will bail once the stub returns no rows; the SELECT it
      // issued on the way is the whole point, so the outcome does not matter.
      await caller.run(mod).catch(() => null);

      const contractEmbeds = select.mock.calls
        .map(([arg]) => String(arg))
        .filter((sql) => sql.includes("contract:contracts("));

      expect(contractEmbeds.length, `${caller.name} issued no contract embed`).toBeGreaterThan(0);
      for (const sql of contractEmbeds) {
        expect(
          sql,
          `${caller.name} selects a contract without its status, so a withdrawn ` +
            `contract is indistinguishable from a live one and the quote stays frozen`,
        ).toMatch(/contract:contracts\([^)]*\bstatus\b/);
      }
    });
  }
});

describe("quoteEditability against the embed shape the queries actually return", () => {
  it("unfreezes the quote when the contract row says withdrawn", async () => {
    const { quoteEditability } = await import("@/lib/quote-editability");

    // The shape `contract:contracts(id, status)` returns.
    expect(quoteEditability("accepted", { id: "c1", status: "withdrawn" })).toEqual({
      editable: true,
      reissues: true,
    });
    expect(quoteEditability("accepted", { id: "c1", status: "declined" })).toEqual({
      editable: true,
      reissues: true,
    });
  });

  it("still refuses on a live contract", async () => {
    const { quoteEditability } = await import("@/lib/quote-editability");

    expect(quoteEditability("accepted", { id: "c1", status: "sent" }).editable).toBe(false);
    expect(quoteEditability("accepted", { id: "c1", status: "signed" }).editable).toBe(false);
  });

  it("refuses when status was not selected — the defect, pinned as behaviour", async () => {
    const { quoteEditability } = await import("@/lib/quote-editability");

    // This is what every caller was passing, and why the fix did nothing. The
    // guard is RIGHT to block on an unknown status: unfreezing a quote with a
    // live contract is the worse mistake. So this assertion is not a complaint
    // about the guard — it documents that the guard is only as good as the
    // query, which the next test is what actually protects.
    expect(quoteEditability("accepted", { id: "c1" }).editable).toBe(false);
  });
});
