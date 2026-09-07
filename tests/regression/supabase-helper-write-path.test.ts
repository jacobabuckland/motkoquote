// The shared Supabase stub, its cast, and its write path.
//
// Two defects in `tests/helpers/supabase.ts` each cost a factory derivation on
// 7 Sep, and both were in the helper rather than in the tests that tripped over
// it:
//
//   1. `client` was returned typed as `{ from }` and never cast, so passing it
//      to a function taking `SupabaseClient` was TS2345 — contradicting the
//      worked example in AGENTS.md, which says to cast it where it is returned.
//      #659's frozen acceptance test hit this twice and could not be repaired.
//
//   2. `from()` returned `{ select }` only, so a write path could not be
//      exercised at all. #660's Engineer edited the helper on its own branch to
//      add one; #659's Engineer needed the same edit; and the two collided on a
//      file every suite in the repo loads.
//
// Both are fixed here on main so no item branch has to touch the helper.

import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { mockSupabaseClient } from "../helpers/supabase";

type CreditRow = { id: string; contractor_id: string; consumed: boolean };

/**
 * Stands in for the kind of function the stub exists to test: it takes a real
 * `SupabaseClient`, so the stub must be assignable to one without the caller
 * adding a cast of its own.
 */
const claimOne = async (client: SupabaseClient, contractorId: string) => {
  const { data } = await client
    .from("referral_credits")
    .update({ consumed: true })
    .eq("contractor_id", contractorId)
    .eq("consumed", false)
    .select()
    .maybeSingle();

  return data as CreditRow | null;
};

describe("the stub is assignable to SupabaseClient", () => {
  it("passes straight to a function that takes one, with no cast at the call site", async () => {
    const row: CreditRow = {
      id: "credit_1",
      contractor_id: "contractor_1",
      consumed: false,
    };

    const { client } = mockSupabaseClient([row]);

    // The point of the test is that this line needs no `as never` and no
    // `as unknown as SupabaseClient`. If the helper stops casting, this is
    // TS2345 and the whole file fails typecheck.
    const claimed = await claimOne(client, "contractor_1");

    expect(claimed).toEqual(row);
  });
});

describe("the write path", () => {
  it("records the payload an update was issued with", async () => {
    const { client, getWrites } = mockSupabaseClient<CreditRow>([]);

    await claimOne(client, "contractor_1");

    expect(getWrites()).toEqual([
      {
        method: "update",
        table: "referral_credits",
        payload: { consumed: true },
      },
    ]);
  });

  it("records the filters a write chain built, which is where the condition lives", async () => {
    const row: CreditRow = {
      id: "credit_1",
      contractor_id: "contractor_1",
      consumed: false,
    };

    const { client, getFilters } = mockSupabaseClient([row]);

    await claimOne(client, "contractor_1");

    // This is the assertion an atomicity criterion actually needs. The stub
    // returns whatever it was handed, so asserting on the returned row proves
    // nothing about the claim being conditional — only the query does.
    expect(getFilters()).toContainEqual({
      method: "eq",
      args: ["consumed", false],
    });
  });

  it("carries insert, upsert and delete as well as update", async () => {
    const { client, getWrites } = mockSupabaseClient<CreditRow>([]);

    await client.from("referral_credits").insert({ contractor_id: "c1" });
    await client.from("referral_credits").upsert({ id: "credit_1" });
    await client.from("referral_credits").delete().eq("id", "credit_1");

    expect(getWrites().map((w) => w.method)).toEqual([
      "insert",
      "upsert",
      "delete",
    ]);
  });

  it("attributes each write to the table from() was called with", async () => {
    const { client, getWrites } = mockSupabaseClient<CreditRow>([]);

    await client.from("contractors").update({ company_name: "x" });
    await client.from("referral_credits").insert({ contractor_id: "c1" });

    expect(getWrites().map((w) => w.table)).toEqual([
      "contractors",
      "referral_credits",
    ]);
  });
});

describe("the read path is unchanged", () => {
  it("still chains filters and stays awaitable", async () => {
    const rows = [
      { id: "job_1", status: "active" },
      { id: "job_2", status: "active" },
    ];

    const { client, select, from, getFilters } = mockSupabaseClient(rows);

    const result = await client
      .from("jobs")
      .select("id, status")
      .eq("status", "active")
      .not("archived_at", "is", null);

    expect(result.data).toEqual(rows);
    expect(result.error).toBeNull();
    expect(from).toHaveBeenCalledWith("jobs");
    expect(select).toHaveBeenCalledWith("id, status");

    // A read records no write, and the filter list is exactly the chain — the
    // `select` on the from() result is a spy, not a link in the builder.
    expect(getFilters()).toEqual([
      { method: "eq", args: ["status", "active"] },
      { method: "not", args: ["archived_at", "is", null] },
    ]);
  });

  it("records no writes for a read", async () => {
    const { client, getWrites } = mockSupabaseClient([{ id: "job_1" }]);

    await client.from("jobs").select("*").eq("id", "job_1").maybeSingle();

    expect(getWrites()).toEqual([]);
  });
});

describe("the spies are reachable rather than hidden behind the cast", () => {
  it("exposes every write method as a vitest mock", () => {
    const { insert, update, upsert, delete: remove } = mockSupabaseClient([]);

    for (const spy of [insert, update, upsert, remove]) {
      expect(vi.isMockFunction(spy)).toBe(true);
    }
  });
});
