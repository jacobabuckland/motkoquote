import { describe, expect, it } from "vitest";
import { probe } from "../../scripts/ci/schema-probe";

/**
 * The probe used one secret as two incompatible things.
 *
 * `SUPABASE_READONLY_URL` was passed to `createClient()`, which requires an
 * http(s) URL, AND to `new Client({ connectionString })`, which requires a
 * Postgres DSN. Nothing could satisfy both, so the very first run after the
 * secrets were configured (rls-check.yml, 2026-09-01) died on
 *
 *   Connection error: Invalid supabaseUrl: Must be a valid HTTP or HTTPS URL.
 *
 * before reaching the half that worked. It had reported SUCCESS on every pull
 * request for as long as the secrets were absent, so the collision had never
 * been executed.
 *
 * The REST half is gone: PostgREST does not expose `information_schema`, so it
 * could never have done the reading. What is pinned here is that a REST URL is
 * now diagnosed by name rather than failing somewhere inside a client library.
 */
describe("schema-probe takes a Postgres connection string, not a REST URL", () => {
  it("names the problem when given the https://<project>.supabase.co URL", async () => {
    const result = await probe({
      changedFiles: ["src/lib/analytics.ts"],
      migrations: [],
      dbUrl: "https://abcdefgh.supabase.co",
      dbKey: "a-readonly-key",
    });

    expect(result.exitCode).toBe(2);
    expect(result.messages[0]).toContain("SUPABASE_READONLY_URL");
    expect(result.messages[0]).toContain("postgresql://");
    // The reason, not just the rule: someone reading this in a CI log has to
    // understand why the URL they already have is the wrong one.
    expect(result.messages[0]).toContain("information_schema");
  });

  it("accepts both spellings of a Postgres DSN", async () => {
    // Port 1 is not listening, so these get as far as the connection attempt
    // and no further — which is the point: they were not rejected on shape.
    for (const scheme of ["postgres", "postgresql"]) {
      const result = await probe({
        changedFiles: [],
        migrations: [],
        dbUrl: `${scheme}://agent_readonly:pw@127.0.0.1:1/postgres`,
        dbKey: "",
      });

      expect(result.exitCode).toBe(2);
      expect(result.messages[0]).toContain("Connection error");
      expect(result.messages[0]).not.toContain("SUPABASE_READONLY_URL");
    }
  }, 20_000);
});
