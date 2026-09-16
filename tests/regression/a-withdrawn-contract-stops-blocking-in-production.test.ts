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

// Migration 83 replaces the UNIQUE constraint on contracts.quote_id with a
// partial unique index, so a withdrawn contract stops holding the slot.
// PostgREST decides to-one versus to-many from that constraint, so the moment
// the migration is APPLIED — before a line of new code ships — every
// `contract:contracts(...)` embed starts arriving as an ARRAY.
//
// The guard used to short-circuit on `!Array.isArray(contract)` and fall
// through to "treat as live", so applying the migration would have re-frozen
// every quote in production and silently undone the fix in the same commit.
describe("the embed shape migration 83 will produce", () => {
  const asEmbed = (rows: { id: string; status?: string }[]) =>
    rows as unknown as { id: string }[];

  it("unfreezes on a withdrawn contract arriving as an array", async () => {
    const { quoteEditability } = await import("@/lib/quote-editability");

    expect(quoteEditability("accepted", asEmbed([{ id: "c1", status: "withdrawn" }]))).toEqual({
      editable: true,
      reissues: true,
    });
  });

  it("still refuses on a live contract arriving as an array", async () => {
    const { quoteEditability } = await import("@/lib/quote-editability");

    expect(quoteEditability("accepted", asEmbed([{ id: "c1", status: "sent" }])).editable).toBe(
      false,
    );
  });

  it("refuses when ANY contract in the array is live", async () => {
    const { quoteEditability } = await import("@/lib/quote-editability");

    // The shape the migration makes possible: a withdrawn contract kept as
    // history alongside the live one that replaced it. The live one decides.
    const history = asEmbed([
      { id: "c1", status: "withdrawn" },
      { id: "c2", status: "sent" },
    ]);
    expect(quoteEditability("accepted", history).editable).toBe(false);
  });

  it("unfreezes when every contract in the array is withdrawn or declined", async () => {
    const { quoteEditability } = await import("@/lib/quote-editability");

    const allDead = asEmbed([
      { id: "c1", status: "withdrawn" },
      { id: "c2", status: "declined" },
    ]);
    expect(quoteEditability("accepted", allDead)).toEqual({ editable: true, reissues: true });
  });

  it("treats a contract whose status was not selected as live, in either shape", async () => {
    const { quoteEditability } = await import("@/lib/quote-editability");

    // The safe default, asserted in both shapes so neither can drift.
    expect(quoteEditability("accepted", { id: "c1" }).editable).toBe(false);
    expect(quoteEditability("accepted", asEmbed([{ id: "c1" }])).editable).toBe(false);
  });
});
