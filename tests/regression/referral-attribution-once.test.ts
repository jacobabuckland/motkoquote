// REF-1 — referral attribution is written once and never rewritten.
//
// The behaviour this pins was already built (migration 23 plus
// src/lib/referral-signup.ts), which is why REF-1's acceptance tests passed
// against a clean tree and the item was closed rather than implemented. None of
// its four criteria was covered by a test, though, and "already true" is not the
// same as "cannot regress" — a trade reattributed to a second referrer is
// double-rewarded money, and nothing here would have said so.
//
// So this is a regression test rather than an acceptance one: it is allowed to
// pass on a clean tree, because holding a shipped guarantee still is the whole
// point of it.
//
// The stub models the two guards that actually do the work, since the rules live
// as much in the schema as in the TypeScript:
//   * `referrals` has `unique (referee_contractor_id)` — a trade can be referred
//     at most once, enforced by the database.
//   * `contractors.referral_code` is written under `.is("referral_code", null)`,
//     so an existing code can never be overwritten and never expires.

import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { provisionNewContractor, redeemReferral } from "@/lib/referral-signup";

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

const UNIQUE_VIOLATION = { code: "23505", message: "duplicate key value" };

/**
 * A Supabase admin client over in-memory tables.
 *
 * Enough of the query builder for this module and no more: select with an
 * optional head-count, insert, update, and the eq/is filters they are chained
 * with. `referrals` enforces its unique constraint on `referee_contractor_id`,
 * because that constraint is one of the two things under test.
 */
function buildAdminStub(tables: Tables, referrerEmail: string | null = "referrer@example.com") {
  const inserted: Array<{ table: string; row: Row }> = [];

  const from = (table: string) => {
    const filters: Array<[string, unknown]> = [];
    let mode: "select" | "insert" | "update" = "select";
    let payload: Row | null = null;

    const rows = (): Row[] => tables[table] ?? (tables[table] = []);
    const matching = (): Row[] =>
      rows().filter((row) =>
        filters.every(([field, value]) =>
          value === null ? row[field] == null : row[field] === value,
        ),
      );

    const settle = (): { data: Row[] | null; count: number; error: Row | null } => {
      if (mode === "insert" && payload) {
        if (
          table === "referrals" &&
          rows().some((r) => r.referee_contractor_id === payload?.referee_contractor_id)
        ) {
          return { data: null, count: 0, error: UNIQUE_VIOLATION };
        }
        rows().push({ ...payload });
        inserted.push({ table, row: { ...payload } });
        return { data: [{ ...payload }], count: 1, error: null };
      }
      if (mode === "update" && payload) {
        const hits = matching();
        for (const row of hits) Object.assign(row, payload);
        return { data: hits, count: hits.length, error: null };
      }
      const hits = matching();
      return { data: hits, count: hits.length, error: null };
    };

    const chain = {
      select: (_columns?: string, _options?: { count?: string; head?: boolean }) => {
        mode = "select";
        return chain;
      },
      insert: (row?: Row) => {
        mode = "insert";
        payload = row ?? null;
        return chain;
      },
      update: (patch?: Row) => {
        mode = "update";
        payload = patch ?? null;
        return chain;
      },
      eq: (field?: string, value?: unknown) => {
        if (field) filters.push([field, value]);
        return chain;
      },
      is: (field?: string, value?: unknown) => {
        if (field) filters.push([field, value]);
        return chain;
      },
      single: async () => {
        const { data, error } = settle();
        return { data: data?.[0] ?? null, error: data?.length ? error : { message: "no rows" } };
      },
      maybeSingle: async () => {
        const { data, error } = settle();
        return { data: data?.[0] ?? null, error };
      },
      // Awaiting the chain itself is how insert and update are called.
      then: (
        resolve: (value: { data: Row[] | null; count: number; error: Row | null }) => unknown,
      ) => resolve(settle()),
    };

    return chain;
  };

  const client = {
    from,
    auth: {
      admin: {
        getUserById: async (_id?: string) => ({ data: { user: { email: referrerEmail } } }),
      },
    },
  } as unknown as SupabaseClient;

  return { client, inserted, tables };
}

const contractor = (id: string, referralCode: string | null): Row => ({
  id,
  owner_user_id: `user-${id}`,
  referral_code: referralCode,
});

describe("REF-1: a trade is attributed to one referrer, once", () => {
  it("writes the attribution on a signup carrying a known code", async () => {
    const { client, tables } = buildAdminStub({
      contractors: [contractor("referrer-1", "ABCD23"), contractor("new-1", null)],
      referrals: [],
      credit_events: [],
    });

    await provisionNewContractor(client, {
      contractorId: "new-1",
      refereeEmail: "new@example.com",
      signupReferralCode: "ABCD23",
    });

    expect(tables.referrals).toHaveLength(1);
    expect(tables.referrals[0].referrer_contractor_id).toBe("referrer-1");
    expect(tables.referrals[0].referee_contractor_id).toBe("new-1");
    expect(tables.referrals[0].status).toBe("pending");
  });

  it("a second code cannot reattribute a trade that is already referred", async () => {
    // The money case. Two referrers, one referee: the first attribution stands
    // and the second is refused by the database's own unique constraint, not by
    // a check anybody has to remember to write.
    const { client, tables } = buildAdminStub({
      contractors: [
        contractor("referrer-1", "FRST23"),
        contractor("referrer-2", "SCND45"),
        contractor("new-1", null),
      ],
      referrals: [],
      credit_events: [],
    });

    const first = await redeemReferral(client, {
      code: "FRST23",
      refereeContractorId: "new-1",
      refereeEmail: "new@example.com",
    });
    expect(first.redeemed).toBe(true);

    const second = await redeemReferral(client, {
      code: "SCND45",
      refereeContractorId: "new-1",
      refereeEmail: "new@example.com",
    });

    expect(second.redeemed).toBe(false);
    expect(second.reason).toBe("already_referred");
    expect(tables.referrals).toHaveLength(1);
    expect(tables.referrals[0].referrer_contractor_id).toBe("referrer-1");
  });

  it("re-running provisioning under a different code changes nothing", async () => {
    const { client, tables } = buildAdminStub({
      contractors: [
        contractor("referrer-1", "FRST23"),
        contractor("referrer-2", "SCND45"),
        contractor("new-1", null),
      ],
      referrals: [],
      credit_events: [],
    });

    await provisionNewContractor(client, {
      contractorId: "new-1",
      refereeEmail: "new@example.com",
      signupReferralCode: "FRST23",
    });
    const codeAfterFirstRun = tables.contractors.find((c) => c.id === "new-1")?.referral_code;

    await provisionNewContractor(client, {
      contractorId: "new-1",
      refereeEmail: "new@example.com",
      signupReferralCode: "SCND45",
    });

    expect(tables.referrals).toHaveLength(1);
    expect(tables.referrals[0].referrer_contractor_id).toBe("referrer-1");
    expect(tables.credit_events.filter((e) => e.reason === "signup_grant")).toHaveLength(1);
    // And the trade's own code is the same one it was first issued.
    expect(tables.contractors.find((c) => c.id === "new-1")?.referral_code).toBe(
      codeAfterFirstRun,
    );
  });

  it("a signup with no code writes no attribution, and still provisions the trade", async () => {
    const { client, tables } = buildAdminStub({
      contractors: [contractor("new-1", null)],
      referrals: [],
      credit_events: [],
    });

    await provisionNewContractor(client, {
      contractorId: "new-1",
      refereeEmail: "new@example.com",
      signupReferralCode: null,
    });

    expect(tables.referrals).toHaveLength(0);
    expect(tables.contractors[0].referral_code).toBeTruthy();
  });

  it("an unrecognised code does not block the signup", async () => {
    // The trade gets in; the attribution is simply absent.
    const { client, tables } = buildAdminStub({
      contractors: [contractor("new-1", null)],
      referrals: [],
      credit_events: [],
    });

    await provisionNewContractor(client, {
      contractorId: "new-1",
      refereeEmail: "new@example.com",
      signupReferralCode: "NSUCH2",
    });

    expect(tables.referrals).toHaveLength(0);
    expect(tables.contractors[0].referral_code).toBeTruthy();
    expect(tables.credit_events.filter((e) => e.reason === "signup_grant")).toHaveLength(1);
  });

  it("a trade cannot refer itself", async () => {
    const { client, tables } = buildAdminStub({
      contractors: [contractor("solo-1", "SELF23")],
      referrals: [],
      credit_events: [],
    });

    const result = await redeemReferral(client, {
      code: "SELF23",
      refereeContractorId: "solo-1",
      refereeEmail: "solo@example.com",
    });

    expect(result.redeemed).toBe(false);
    expect(result.reason).toBe("self_referral");
    expect(tables.referrals).toHaveLength(0);
  });

  it("a second account on the same email cannot refer the first", async () => {
    const { client, tables } = buildAdminStub(
      {
        contractors: [contractor("referrer-1", "SHARD2"), contractor("new-1", null)],
        referrals: [],
        credit_events: [],
      },
      "same@example.com",
    );

    const result = await redeemReferral(client, {
      code: "SHARD2",
      refereeContractorId: "new-1",
      refereeEmail: "same@example.com",
    });

    expect(result.redeemed).toBe(false);
    expect(result.reason).toBe("self_referral");
    expect(tables.referrals).toHaveLength(0);
  });
});

describe("REF-1: a code resolves indefinitely", () => {
  it("an existing code is never regenerated", async () => {
    // issueUniqueReferralCode writes under `.is("referral_code", null)`, and
    // provisioning returns early once a code is present. Both have to fail for
    // a code on a van to stop working.
    const { client, tables } = buildAdminStub({
      contractors: [contractor("established-1", "NVAN23")],
      referrals: [],
      credit_events: [],
    });

    await provisionNewContractor(client, {
      contractorId: "established-1",
      refereeEmail: "established@example.com",
      signupReferralCode: null,
    });

    expect(tables.contractors[0].referral_code).toBe("NVAN23");
    expect(tables.credit_events).toHaveLength(0);
  });

  it("an old code still resolves to its owner", async () => {
    const { client, tables } = buildAdminStub({
      contractors: [contractor("referrer-old", "LDCDE2"), contractor("new-1", null)],
      referrals: [],
      credit_events: [],
    });

    const result = await redeemReferral(client, {
      code: "LDCDE2",
      refereeContractorId: "new-1",
      refereeEmail: "new@example.com",
    });

    expect(result.redeemed).toBe(true);
    expect(tables.referrals[0].code_used).toBe("LDCDE2");
  });
});
