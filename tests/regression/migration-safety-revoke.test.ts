// The destructive-DDL scan and the REVOKE statement.
//
// `revoke insert, update, delete, truncate on <table> from anon;` names the
// TRUNCATE *privilege* in order to take it away. `/\bTRUNCATE\b/i` matched it,
// so the guard rejected a migration for removing the ability to truncate.
//
// It blocked #660 on 7 Sep, and it is the repository's own house style: the RLS
// fix for `subscription_projection` (migration 74) locks the table down with
// these exact two lines and is already on main.
//
// The dangerous part is the workaround rather than the delay. Dropping
// `truncate` from the revoke makes the check pass and leaves `anon` holding
// TRUNCATE — the guard would have induced the hole it exists to prevent, the
// same shape as excluding tests/ from typecheck to silence a type error.

import { describe, expect, it } from "vitest";

import {
  findDestructive,
  stripRevokeStatements,
} from "../../scripts/ci/migration-safety";

/** Migration 75's lock-down, and the shape migration 74 already uses on main. */
const REVOKE_MIGRATION = `
create table referral_credits (
  id uuid primary key default gen_random_uuid(),
  contractor_id uuid not null references contractors(id) on delete cascade,
  consumed boolean not null default false
);

alter table referral_credits enable row level security;

revoke insert, update, delete, truncate on referral_credits from anon;
revoke insert, update, delete, truncate on referral_credits from authenticated;
`;

describe("a REVOKE is not destructive DDL", () => {
  it("passes a migration that revokes the TRUNCATE privilege", () => {
    expect(findDestructive(REVOKE_MIGRATION)).toEqual([]);
  });

  it("passes a revoke spanning several lines", () => {
    const sql = `
revoke insert,
       update,
       delete,
       truncate
    on referral_credits
  from anon;
`;

    expect(findDestructive(sql)).toEqual([]);
  });

  it("passes REVOKE ALL, which names no privilege at all", () => {
    expect(findDestructive("revoke all on referral_credits from anon;")).toEqual([]);
  });
});

describe("what the scan must still catch", () => {
  it("a real TRUNCATE", () => {
    const hits = findDestructive("truncate table referral_credits;");

    expect(hits.map((h) => h.label)).toEqual(["TRUNCATE"]);
  });

  it("a DROP TABLE that follows a revoke on the same line", () => {
    // The blanking stops at the statement's semicolon, so nothing can hide
    // behind a revoke. This is the property that keeps the exemption honest.
    const hits = findDestructive(
      "revoke truncate on x from anon; drop table referral_credits;",
    );

    expect(hits.map((h) => h.label)).toEqual(["DROP TABLE"]);
  });

  it("a DROP COLUMN in a migration that also revokes", () => {
    const hits = findDestructive(`
revoke insert, update, delete, truncate on referral_credits from anon;
alter table referral_credits drop column consumed;
`);

    expect(hits.map((h) => h.label)).toEqual(["DROP COLUMN"]);
  });

  it("a TRUNCATE before any revoke appears", () => {
    const hits = findDestructive(`
truncate table referral_credits;
revoke truncate on referral_credits from anon;
`);

    expect(hits.map((h) => h.label)).toEqual(["TRUNCATE"]);
  });
});

describe("line numbers survive the blanking", () => {
  it("reports the drop on its own line, not the revoke's", () => {
    const sql = [
      "-- header",
      "revoke truncate on x from anon;",
      "alter table y drop column z;",
    ].join("\n");

    const hits = findDestructive(sql);

    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(3);
  });

  it("blanks the revoke without consuming the newlines around it", () => {
    const stripped = stripRevokeStatements("a\nrevoke truncate on x from y;\nb");

    expect(stripped.split("\n")).toHaveLength(3);
    expect(stripped.split("\n")[0]).toBe("a");
    expect(stripped.split("\n")[2]).toBe("b");
    expect(stripped.split("\n")[1].trim()).toBe("");
  });
});
