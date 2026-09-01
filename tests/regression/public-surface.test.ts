import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { ALLOWED_EXPOSURES } from "@/checks/public-surface-allowlist";
import {
  describeExposure,
  findInventoryDrift,
  findUnsafeExposures,
  invalidAllowlistEntries,
  renderManifest,
  type FunctionPrivilege,
  type PublicObject,
} from "@/checks/public-surface-core";

/**
 * The production-surface checks' decision logic, tested in the ORDINARY gate.
 *
 * The checks themselves need a service-role key and run only from
 * rls-check.yml, on a schedule. If their logic were only exercised there, it
 * would be validated once a day, against whatever production happened to look
 * like — and a bug in it would show up as a silent pass, since "no exposures
 * found" is what both correct behaviour and a broken filter look like.
 *
 * So everything decidable without a database is decided in
 * `public-surface-core.ts`, and this file is where it is actually tested.
 */

function priv(over: Partial<FunctionPrivilege> = {}): FunctionPrivilege {
  return {
    function_name: "some_function",
    identity_arguments: "",
    security_definer: false,
    anon_execute: false,
    authenticated_execute: false,
    public_execute: false,
    ...over,
  };
}

describe("finding functions that bypass RLS and are publicly reachable", () => {
  it("flags SECURITY DEFINER executable by anon", () => {
    // The shape that was live on production for weeks.
    const rows = [
      priv({ function_name: "settle_fee_collection", security_definer: true, anon_execute: true }),
    ];
    expect(findUnsafeExposures(rows, []).map((r) => r.function_name)).toEqual([
      "settle_fee_collection",
    ]);
  });

  it("flags SECURITY DEFINER reachable via PUBLIC, which is the Postgres default", () => {
    // How this happens by accident: Postgres grants EXECUTE to PUBLIC on
    // creation, and no migration in this repository revokes it. A function
    // nobody granted anything to is world-callable.
    const rows = [priv({ security_definer: true, public_execute: true })];
    expect(findUnsafeExposures(rows, [])).toHaveLength(1);
  });

  it("flags SECURITY DEFINER reachable by authenticated", () => {
    const rows = [priv({ security_definer: true, authenticated_execute: true })];
    expect(findUnsafeExposures(rows, [])).toHaveLength(1);
  });

  it("does NOT flag a SECURITY INVOKER function callable by anon", () => {
    // Ordinary Supabase usage: it runs as the caller, so every RLS policy still
    // applies. Five of this project's functions are legitimately used this way
    // from the browser. Flagging them would make the check noise on day one and
    // switched off by day three.
    const rows = [
      priv({ function_name: "set_sms_opt_out", anon_execute: true }),
      priv({ function_name: "match_knowledge_chunks", anon_execute: true, authenticated_execute: true }),
    ];
    expect(findUnsafeExposures(rows, [])).toEqual([]);
  });

  it("does NOT flag a SECURITY DEFINER function reachable only by the service role", () => {
    // What the two catalog readers in migration 56 look like after their
    // REVOKE. If this flagged them, the check would fail on its own tooling.
    const rows = [priv({ function_name: "check_public_function_privileges", security_definer: true })];
    expect(findUnsafeExposures(rows, [])).toEqual([]);
  });

  it("respects the allowlist, matching every overload of a name", () => {
    const rows = [
      priv({ function_name: "known", identity_arguments: "a uuid", security_definer: true, anon_execute: true }),
      priv({ function_name: "known", identity_arguments: "a text", security_definer: true, anon_execute: true }),
    ];
    const allow = [{ function_name: "known", reason: "x".repeat(30), ticket: "T-1" }];
    expect(findUnsafeExposures(rows, allow)).toEqual([]);
  });

  it("still flags a function NOT on the allowlist when others are", () => {
    const rows = [
      priv({ function_name: "known", security_definer: true, anon_execute: true }),
      priv({ function_name: "surprise", security_definer: true, anon_execute: true }),
    ];
    const allow = [{ function_name: "known", reason: "x".repeat(30), ticket: "T-1" }];
    expect(findUnsafeExposures(rows, allow).map((r) => r.function_name)).toEqual(["surprise"]);
  });

  it("describes an exposure with the exact statement that fixes it", () => {
    const message = describeExposure(
      priv({
        function_name: "settle_fee_collection",
        identity_arguments: "p_id uuid, p_ref text",
        security_definer: true,
        anon_execute: true,
      }),
    );
    expect(message).toContain("/rest/v1/rpc/settle_fee_collection");
    expect(message).toContain(
      "REVOKE EXECUTE ON FUNCTION public.settle_fee_collection(p_id uuid, p_ref text) FROM anon, authenticated, PUBLIC;",
    );
  });
});

describe("the allowlist itself", () => {
  it("rejects an entry with no reason, no ticket, or no name", () => {
    expect(
      invalidAllowlistEntries([
        { function_name: "a", reason: "", ticket: "T-1" },
        { function_name: "b", reason: "too short", ticket: "T-1" },
        { function_name: "c", reason: "x".repeat(30), ticket: "" },
        { function_name: "", reason: "x".repeat(30), ticket: "T-1" },
      ]),
    ).toHaveLength(4);
  });

  it("every committed entry carries a real reason and a ticket", () => {
    // The check that stops the allowlist becoming a way to quiet a red build.
    // An entry here authorises unauthenticated, RLS-bypassing access to a live
    // database; it has to say why, and where that was decided.
    expect(invalidAllowlistEntries(ALLOWED_EXPOSURES)).toEqual([]);
  });

  it("is empty, because the two known exposures were revoked rather than accepted", () => {
    // Migration 55 revoked settle_fee_collection and check_public_tables_rls.
    // Zero is the intended steady state: an allowlist entry is a live hole that
    // someone decided to live with, and there is currently no such hole.
    //
    // This failing is not automatically wrong — a future entry may be genuinely
    // justified. It failing is the prompt to check that the entry was argued
    // for, rather than added to turn a red check green.
    expect(ALLOWED_EXPOSURES).toEqual([]);
  });

  it("has no duplicate entries", () => {
    const names = ALLOWED_EXPOSURES.map((a) => a.function_name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("keeps the list short — every entry is a live exposure", () => {
    // Not a style rule. This list is the set of RLS-bypassing functions the
    // internet can call; if it grows quietly, the check has stopped meaning
    // anything. Raising this number should feel like a decision.
    expect(ALLOWED_EXPOSURES.length).toBeLessThanOrEqual(3);
  });
});

describe("inventory drift between the tree and production", () => {
  const manifest: PublicObject[] = [
    { object_kind: "table", object_name: "jobs" },
    { object_kind: "function", object_name: "set_sms_opt_out" },
  ];

  it("reports nothing when they match", () => {
    expect(findInventoryDrift([...manifest], manifest)).toEqual({ unexpected: [], missing: [] });
  });

  it("reports an object on production that the tree does not know about", () => {
    // settle_fee_collection exactly: created by hand, in no migration, called by
    // no code, invisible for weeks.
    const live = [...manifest, { object_kind: "function" as const, object_name: "settle_fee_collection" }];
    const drift = findInventoryDrift(live, manifest);
    expect(drift.unexpected).toEqual([
      { object_kind: "function", object_name: "settle_fee_collection" },
    ]);
    expect(drift.missing).toEqual([]);
  });

  it("reports an object the tree expects and production does not have", () => {
    // The ghost apply: the ledger says the migration ran, the DDL never landed.
    const drift = findInventoryDrift([manifest[0]], manifest);
    expect(drift.missing).toEqual([{ object_kind: "function", object_name: "set_sms_opt_out" }]);
    expect(drift.unexpected).toEqual([]);
  });

  it("does not confuse a table and a function sharing a name", () => {
    const live: PublicObject[] = [{ object_kind: "function", object_name: "jobs" }];
    const against: PublicObject[] = [{ object_kind: "table", object_name: "jobs" }];
    const drift = findInventoryDrift(live, against);
    expect(drift.unexpected).toHaveLength(1);
    expect(drift.missing).toHaveLength(1);
  });

  it("renders a manifest that is sorted and round-trips", () => {
    const rendered = renderManifest([
      { object_kind: "table", object_name: "zebra" },
      { object_kind: "function", object_name: "alpha" },
      { object_kind: "table", object_name: "apple" },
    ]);
    expect(JSON.parse(rendered)).toEqual([
      { object_kind: "function", object_name: "alpha" },
      { object_kind: "table", object_name: "apple" },
      { object_kind: "table", object_name: "zebra" },
    ]);
  });
});

describe("the committed manifest", () => {
  const manifest = JSON.parse(
    readFileSync("src/checks/public-surface.json", "utf8"),
  ) as PublicObject[];

  it("is exactly what renderManifest would produce, so the fix is a copy-paste", () => {
    // If these drift apart, the failure message tells you to commit something
    // that then fails this test, and the next person edits it by hand.
    expect(renderManifest(manifest)).toBe(`${JSON.stringify(manifest, null, 2)}\n`);
  });

  it("only contains the two kinds the reader emits", () => {
    for (const o of manifest) expect(["table", "function"]).toContain(o.object_kind);
  });

  it("has no duplicates", () => {
    const keys = manifest.map((o) => `${o.object_kind}:${o.object_name}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("lists the catalog readers migration 56 creates", () => {
    const functions = manifest.filter((o) => o.object_kind === "function").map((o) => o.object_name);
    expect(functions).toContain("check_public_function_privileges");
    expect(functions).toContain("check_public_object_inventory");
  });
});
