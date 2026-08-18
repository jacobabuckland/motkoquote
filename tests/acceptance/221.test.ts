import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";

describe("Issue #221: Enable row level security on cron_locks", () => {
  const MIGRATIONS_DIR = resolve(process.cwd(), "supabase/migrations");

  describe("Migration file", () => {
    it("creates a migration that enables RLS on cron_locks", () => {
      const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
      const rlsMigration = files.find((f) =>
        f.toLowerCase().includes("cron_locks") && f.toLowerCase().includes("rls")
      );

      expect(rlsMigration).toBeDefined();
      // 14 digits, which is what every migration in supabase/migrations uses
      // (00000000000001_init_schema.sql onward). The original 20 could not be
      // satisfied by any file following the repo's own naming convention.
      expect(rlsMigration).toMatch(/^\d{14}_.*\.sql$/);
    });

    it("migration contains alter table cron_locks enable row level security", () => {
      const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
      const rlsMigration = files.find((f) =>
        f.toLowerCase().includes("cron_locks") && f.toLowerCase().includes("rls")
      );

      if (!rlsMigration) {
        throw new Error("cron_locks RLS migration not found");
      }

      const content = readFileSync(resolve(MIGRATIONS_DIR, rlsMigration), "utf8");
      expect(content.toLowerCase()).toMatch(
        /alter\s+table\s+cron_locks\s+enable\s+row\s+level\s+security/
      );
    });

    it("migration contains down migration that disables RLS", () => {
      const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
      const rlsMigration = files.find((f) =>
        f.toLowerCase().includes("cron_locks") && f.toLowerCase().includes("rls")
      );

      if (!rlsMigration) {
        throw new Error("cron_locks RLS migration not found");
      }

      const content = readFileSync(resolve(MIGRATIONS_DIR, rlsMigration), "utf8");
      // Down migration should disable RLS (for rollback)
      expect(content.toLowerCase()).toMatch(
        /alter\s+table\s+cron_locks\s+disable\s+row\s+level\s+security/
      );
    });

    it("migration does NOT add policies to cron_locks", () => {
      const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
      const rlsMigration = files.find((f) =>
        f.toLowerCase().includes("cron_locks") && f.toLowerCase().includes("rls")
      );

      if (!rlsMigration) {
        throw new Error("cron_locks RLS migration not found");
      }

      const content = readFileSync(resolve(MIGRATIONS_DIR, rlsMigration), "utf8");
      // Should NOT contain "create policy" for cron_locks
      expect(content.toLowerCase()).not.toMatch(/create\s+policy.*on\s+cron_locks/);
    });
  });

  describe("RLS check", () => {
    it("creates src/checks/rls.check.test.ts", () => {
      const checkPath = resolve(process.cwd(), "src/checks/rls.check.test.ts");
      expect(existsSync(checkPath)).toBe(true);
    });

    it("check imports createAdminClient for database access", async () => {
      const checkPath = resolve(process.cwd(), "src/checks/rls.check.test.ts");
      if (!existsSync(checkPath)) {
        throw new Error("src/checks/rls.check.test.ts does not exist yet");
      }

      const content = readFileSync(checkPath, "utf8");
      expect(content).toContain("createAdminClient");
    });

    it("check queries pg_class for relrowsecurity column", async () => {
      const checkPath = resolve(process.cwd(), "src/checks/rls.check.test.ts");
      if (!existsSync(checkPath)) {
        throw new Error("src/checks/rls.check.test.ts does not exist yet");
      }

      const content = readFileSync(checkPath, "utf8");
      // Check should query pg_catalog.pg_class for relrowsecurity
      expect(content.toLowerCase()).toMatch(/pg_class|relrowsecurity/);
    });

    it("check asserts all tables in public schema have RLS enabled", async () => {
      const checkPath = resolve(process.cwd(), "src/checks/rls.check.test.ts");
      if (!existsSync(checkPath)) {
        throw new Error("src/checks/rls.check.test.ts does not exist yet");
      }

      const content = readFileSync(checkPath, "utf8");
      // Should filter for public schema
      expect(content).toMatch(/public/);
      // Should assert relrowsecurity is true or similar
      expect(content.toLowerCase()).toMatch(/relrowsecurity.*true|rls.*enabled/);
    });

    it("check reports table names that fail the RLS assertion", async () => {
      const checkPath = resolve(process.cwd(), "src/checks/rls.check.test.ts");
      if (!existsSync(checkPath)) {
        throw new Error("src/checks/rls.check.test.ts does not exist yet");
      }

      const content = readFileSync(checkPath, "utf8");
      // Check should have table name in assertion or error message
      // Look for .each() pattern or table name variable usage
      expect(content).toMatch(/table|relname/i);
    });
  });

  describe("Lock logic unchanged", () => {
    it("acquireCronLock still exported from cron-lock.ts", async () => {
      const mod = await import("@/lib/cron-lock");
      expect(typeof mod.acquireCronLock).toBe("function");
    });

    it("releaseCronLock still exported from cron-lock.ts", async () => {
      const mod = await import("@/lib/cron-lock");
      expect(typeof mod.releaseCronLock).toBe("function");
    });

    it("cron-lock.ts signature unchanged (takes admin client and name)", async () => {
      const cronLockPath = resolve(process.cwd(), "src/lib/cron-lock.ts");
      const content = readFileSync(cronLockPath, "utf8");

      // acquireCronLock should still take (admin: SupabaseClient, name: string, ...)
      // [\s\S] rather than `.` with the /s flag: dotall is ES2018, and the repo
      // targets ES2017, so the flag is a TS1501 compile error here. This spans
      // newlines the same way without moving the compile target for four regexes.
      expect(content).toMatch(/acquireCronLock[\s\S]*admin[\s\S]*SupabaseClient/);
      expect(content).toMatch(/acquireCronLock[\s\S]*name[\s\S]*string/);

      // releaseCronLock should still take (admin: SupabaseClient, name: string)
      expect(content).toMatch(/releaseCronLock[\s\S]*admin[\s\S]*SupabaseClient/);
      expect(content).toMatch(/releaseCronLock[\s\S]*name[\s\S]*string/);
    });
  });

  describe("Cron routes still use acquireCronLock and releaseCronLock", () => {
    // collect-fees and retry-fee-collections were removed with the VRP
    // collection path by PAY-4/PAY-5; fee collection now happens at source via
    // Stripe application fees. Their lock assertions are inverted rather than
    // deleted, the same way PAY-5 handled #184's module test, so that nothing
    // reintroduces either route without revisiting whether it needs the lock.
    it("collect-fees and retry-fee-collections crons are gone with the VRP path", () => {
      expect(
        existsSync(resolve(process.cwd(), "src/app/api/cron/collect-fees/route.ts"))
      ).toBe(false);
      expect(
        existsSync(
          resolve(process.cwd(), "src/app/api/cron/retry-fee-collections/route.ts")
        )
      ).toBe(false);
    });

    it("chase cron still acquires and releases lock", () => {
      const routePath = resolve(process.cwd(), "src/app/api/cron/chase/route.ts");
      const content = readFileSync(routePath, "utf8");

      expect(content).toContain("acquireCronLock");
      expect(content).toContain("releaseCronLock");
    });

    it("purge-accounts cron still acquires and releases lock", () => {
      const routePath = resolve(
        process.cwd(),
        "src/app/api/cron/purge-accounts/route.ts"
      );
      const content = readFileSync(routePath, "utf8");

      expect(content).toContain("acquireCronLock");
      expect(content).toContain("releaseCronLock");
    });

  });
});
