/**
 * The probe's connection contract — the half that had never executed.
 *
 * `schema-drift-probe` reported SUCCESS on every pull request from the day it
 * shipped, because SUPABASE_READONLY_URL and SUPABASE_READONLY_KEY were unset
 * and probe() took its skip branch. tests/acceptance/225.test.ts covers that
 * skip, and every other assertion it makes runs against the `_testSchema` mock.
 * Nothing exercised the real path at all.
 *
 * The secrets were added on 1 Sep 2026 and the probe failed on the first run,
 * for reasons no secret value could have fixed:
 *
 *   - `dbUrl` was passed to BOTH `createClient` (which requires
 *     https://<ref>.supabase.co) and `new Client({ connectionString })` (which
 *     requires postgresql://...). No one string satisfies both.
 *   - The read-only verification was a supabase-js `.insert()` in a try/catch.
 *     supabase-js resolves with `{ error }` on a rejected write rather than
 *     throwing, so the catch could not fire — a correct read-only credential
 *     would have been reported as "credentials allow writes", and a credential
 *     that COULD write would have left a row on production.
 *   - That insert named `occurred_at`, which `events` does not have.
 *
 * These tests are the ones that would have caught it before the secrets
 * existed: they assert behaviour reachable without a database.
 */

import { describe, expect, it } from "vitest";

import {
  WRITABLE_TABLES_SQL,
  isPostgresConnectionString,
  probe,
} from "@/../scripts/ci/schema-probe";

describe("what SUPABASE_READONLY_URL has to be", () => {
  it.each([
    "postgresql://user:pw@db.example.supabase.co:5432/postgres",
    "postgres://user:pw@aws-0-eu-west-2.pooler.supabase.com:6543/postgres",
    "POSTGRESQL://user:pw@host:5432/postgres",
    "  postgresql://user:pw@host:5432/postgres  ",
  ])("accepts the PostgreSQL connection string %s", (url) => {
    expect(isPostgresConnectionString(url)).toBe(true);
  });

  it.each([
    "https://abcdefgh.supabase.co",
    "http://localhost:54321",
    "db.abcdefgh.supabase.co:5432",
    "",
  ])("rejects %s, which cannot reach information_schema", (url) => {
    expect(isPostgresConnectionString(url)).toBe(false);
  });
});

describe("a project URL supplied where a connection string is needed", () => {
  it("fails with an exit code that stops the build, not a silent pass", async () => {
    const result = await probe({
      changedFiles: ["src/lib/analytics.ts"],
      migrations: [],
      dbUrl: "https://abcdefgh.supabase.co",
      dbKey: "a-key",
    });

    expect(result.exitCode).toBe(2);
  });

  it("says which value to supply, rather than 'Invalid supabaseUrl'", async () => {
    // The whole cost of this class of failure is the reader not knowing what to
    // change. The first live run printed "Invalid supabaseUrl: Must be a valid
    // HTTP or HTTPS URL" — which reads as "use an https URL", and an https URL
    // is exactly what cannot work here.
    const result = await probe({
      changedFiles: ["src/lib/analytics.ts"],
      migrations: [],
      dbUrl: "https://abcdefgh.supabase.co",
      dbKey: "a-key",
    });

    const message = result.messages.join(" ");
    expect(message).toMatch(/postgresql:\/\//);
    expect(message).toMatch(/information_schema/);
  });

  it("does not skip, which is what an unset secret does", async () => {
    // The distinction that matters: absent credentials are a skip and exit 0
    // (frozen by tests/acceptance/225.test.ts), a wrong credential is a
    // failure. Collapsing the two would restore the green-but-never-ran state
    // this probe already spent a month in.
    const skipped = await probe({
      changedFiles: ["src/lib/analytics.ts"],
      migrations: [],
      dbUrl: "",
      dbKey: "",
    });
    const misconfigured = await probe({
      changedFiles: ["src/lib/analytics.ts"],
      migrations: [],
      dbUrl: "https://abcdefgh.supabase.co",
      dbKey: "a-key",
    });

    expect(skipped.exitCode).toBe(0);
    expect(misconfigured.exitCode).toBe(2);
  });
});

describe("a connection string that cannot be reached", () => {
  it("reports a connection error rather than an empty schema", async () => {
    // An unreachable database must never look like a database with no columns:
    // every column the codebase names would then read as drift, or worse, as
    // verified.
    const result = await probe({
      changedFiles: ["src/lib/analytics.ts"],
      migrations: [],
      dbUrl: "postgresql://nobody:nothing@127.0.0.1:1/postgres",
      dbKey: "",
    });

    expect(result.exitCode).toBe(2);
    expect(result.messages.join(" ").toLowerCase()).toContain("connection error");
  }, 20_000);
});

describe("verifying the credential is read-only", () => {
  it("asks the catalog and writes nothing", () => {
    // The previous version attempted a real INSERT into `events` on production
    // to find out. `has_table_privilege` answers the same question from the
    // catalog, over every table rather than one, and cannot leave a row behind.
    expect(WRITABLE_TABLES_SQL).toContain("has_table_privilege");
    expect(WRITABLE_TABLES_SQL).not.toMatch(/\bINSERT INTO\b/i);
    expect(WRITABLE_TABLES_SQL).not.toMatch(/\bUPDATE\s+\w+\s+SET\b/i);
  });

  it("covers all three write privileges, not just INSERT", () => {
    // A credential holding UPDATE or DELETE but not INSERT is not read-only
    // either, and is the shape a hand-tuned grant produces.
    for (const privilege of ["'INSERT'", "'UPDATE'", "'DELETE'"]) {
      expect(WRITABLE_TABLES_SQL).toContain(privilege);
    }
  });

  it("looks at ordinary tables in the public schema", () => {
    expect(WRITABLE_TABLES_SQL).toContain("'public'");
    expect(WRITABLE_TABLES_SQL).toContain("relkind = 'r'");
  });
});
