import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// The probe script that will be created by the Engineer
// Expected location: scripts/ci/schema-probe.ts or scripts/ci/schema-probe.js
// The script connects to production Supabase, queries information_schema,
// and compares against schema references in changed files.

// Mock database schema responses. At module scope because two sibling
// describe blocks use it — declared inside the first one, the second could not
// see it and failed to compile.
const mockSchema = {
  events: [
    { column_name: "id", data_type: "uuid" },
    { column_name: "user_id", data_type: "uuid" },
    { column_name: "event_name", data_type: "text" },
    { column_name: "properties", data_type: "jsonb" },
    { column_name: "created_at", data_type: "timestamp with time zone" },
  ],
  jobs: [
    { column_name: "id", data_type: "uuid" },
    { column_name: "contractor_id", data_type: "uuid" },
    { column_name: "fee_status", data_type: "text" },
    { column_name: "paid_at", data_type: "timestamp with time zone" },
  ],
};

describe("Issue #225: Schema drift probe in CI", () => {
  describe("Probe script existence and structure", () => {
    it("has a schema probe script at scripts/ci/schema-probe.ts or .js", async () => {
      let imported = null;
      let importError = null;

      // Try .ts first, then .js
      try {
        imported = await import("@/../scripts/ci/schema-probe");
      } catch (error: unknown) {
        importError = error;
      }

      if (!imported) {
        try {
          imported = await import("@/../scripts/ci/schema-probe.js");
        } catch {
          // If both fail, throw the original error
          throw importError;
        }
      }

      expect(imported).toBeDefined();
    });

    it("exports a probe function that accepts config and returns exit code", async () => {
      const mod = await import("@/../scripts/ci/schema-probe").catch(() =>
        import("@/../scripts/ci/schema-probe.js"),
      );

      expect(mod.probe).toBeDefined();
      expect(typeof mod.probe).toBe("function");

      // The probe function should accept:
      // - changedFiles: string[] (list of files changed in the PR)
      // - migrations: string[] (list of new migration files in the PR)
      // - dbUrl: string (Supabase connection URL)
      // - dbKey: string (read-only service role key)
      // And return a ProbeResult with exitCode and messages
      type ProbeResult = {
        exitCode: number;
        messages: string[];
      };

      const result = mod.probe as (config: {
        changedFiles: string[];
        migrations: string[];
        dbUrl: string;
        dbKey: string;
      }) => Promise<ProbeResult>;

      expect(result).toBeDefined();
    });
  });

  describe("Probe behavior with mocked database", () => {
    it("returns exit code 0 when all referenced columns exist in production", async () => {
      const mod = await import("@/../scripts/ci/schema-probe").catch(() =>
        import("@/../scripts/ci/schema-probe.js"),
      );

      // Mock a file that references existing columns
      const changedFiles = ["src/lib/analytics.ts"];
      const migrations: string[] = [];

      // The test assumes the probe can be configured with a mock client
      // or that we can inject the schema response
      const result = await mod.probe({
        changedFiles,
        migrations,
        dbUrl: "mock://localhost",
        dbKey: "mock-key",
        // Test hook: allow injecting schema for deterministic testing
        _testSchema: mockSchema,
      });

      expect(result.exitCode).toBe(0);
      expect(result.messages).toHaveLength(0); // No drift, no messages
    });

    it("returns exit code 1 when a referenced column is missing from production", async () => {
      const mod = await import("@/../scripts/ci/schema-probe").catch(() =>
        import("@/../scripts/ci/schema-probe.js"),
      );

      // Schema missing the event_name column (simulating the ghost-apply from migration 034)
      const driftedSchema = {
        events: [
          { column_name: "id", data_type: "uuid" },
          { column_name: "user_id", data_type: "uuid" },
          // event_name is MISSING (the ghost-apply scenario)
          { column_name: "properties", data_type: "jsonb" },
          { column_name: "created_at", data_type: "timestamp with time zone" },
        ],
      };

      const changedFiles = ["src/lib/analytics.ts"]; // This file references event_name
      const migrations: string[] = [];

      const result = await mod.probe({
        changedFiles,
        migrations,
        dbUrl: "mock://localhost",
        dbKey: "mock-key",
        _testSchema: driftedSchema,
      });

      expect(result.exitCode).toBe(1);
      expect(result.messages.length).toBeGreaterThan(0);
      // The error message should name the table, column, and file
      const errorMsg = result.messages[0];
      expect(errorMsg).toContain("event_name");
      expect(errorMsg).toContain("events");
      expect(errorMsg).toContain("src/lib/analytics.ts");
    });

    it("excludes columns created by migrations in the same PR from drift check", async () => {
      const mod = await import("@/../scripts/ci/schema-probe").catch(() =>
        import("@/../scripts/ci/schema-probe.js"),
      );

      // Production schema does NOT have new_column yet
      const schemaBeforeMigration = {
        events: [
          { column_name: "id", data_type: "uuid" },
          { column_name: "event_name", data_type: "text" },
        ],
      };

      // The PR adds a migration creating new_column
      const migrations = ["supabase/migrations/00000000000099_add_new_column.sql"];
      // Mock migration file content: ALTER TABLE events ADD COLUMN new_column text;
      const migrationContent = `
        -- Add new tracking column
        alter table events add column new_column text;
      `;

      // And the PR also references new_column in code
      const changedFiles = ["src/lib/analytics.ts"];
      // Mock that analytics.ts now inserts new_column

      const result = await mod.probe({
        changedFiles,
        migrations,
        dbUrl: "mock://localhost",
        dbKey: "mock-key",
        _testSchema: schemaBeforeMigration,
        _testMigrationContent: {
          "supabase/migrations/00000000000099_add_new_column.sql": migrationContent,
        },
      });

      // Should pass because new_column is created by a migration in the same PR
      expect(result.exitCode).toBe(0);
    });

    it("warns about legacy drift in unchanged files but does not fail", async () => {
      const mod = await import("@/../scripts/ci/schema-probe").catch(() =>
        import("@/../scripts/ci/schema-probe.js"),
      );

      // Schema with missing column in a table referenced by UNCHANGED code
      const schemaWithLegacyDrift = {
        events: [
          { column_name: "id", data_type: "uuid" },
          // event_name is missing, but the file referencing it is NOT in changedFiles
        ],
        jobs: mockSchema.jobs, // jobs table is fine
      };

      // Only changed jobs-related code, not analytics
      const changedFiles = ["src/lib/settle-paid-job.ts"];
      const migrations: string[] = [];

      const result = await mod.probe({
        changedFiles,
        migrations,
        dbUrl: "mock://localhost",
        dbKey: "mock-key",
        _testSchema: schemaWithLegacyDrift,
        // Optionally: scan ALL files for legacy drift warnings
        _testAllFiles: ["src/lib/analytics.ts", "src/lib/settle-paid-job.ts"],
      });

      // Should pass (exitCode 0) because the drift is not in changed files
      expect(result.exitCode).toBe(0);
      // But should include a warning message about the legacy drift
      expect(result.messages.length).toBeGreaterThan(0);
      const warningMsg = result.messages.find((msg: string) =>
        msg.toLowerCase().includes("warning"),
      );
      expect(warningMsg).toBeDefined();
      expect(warningMsg).toContain("event_name");
    });

    it("fails with exit code 2 on connection error with clear message", async () => {
      const mod = await import("@/../scripts/ci/schema-probe").catch(() =>
        import("@/../scripts/ci/schema-probe.js"),
      );

      const changedFiles = ["src/lib/analytics.ts"];
      const migrations: string[] = [];

      // Simulate connection failure
      const result = await mod.probe({
        changedFiles,
        migrations,
        dbUrl: "invalid://url",
        dbKey: "invalid-key",
        _testConnectionError: new Error("Connection refused"),
      });

      expect(result.exitCode).toBe(2); // Infrastructure error, not drift
      expect(result.messages.length).toBeGreaterThan(0);
      const errorMsg = result.messages[0];
      expect(errorMsg.toLowerCase()).toContain("connection");
    });

    it("skips with exit code 0 when neither credential is configured", async () => {
      const mod = await import("@/../scripts/ci/schema-probe").catch(() =>
        import("@/../scripts/ci/schema-probe.js"),
      );

      // Absent secrets are not a connection failure: nothing was attempted.
      // Until an admin creates them the probe has nothing to say, and must not
      // block every PR on a check it cannot run.
      const result = await mod.probe({
        changedFiles: ["src/lib/analytics.ts"],
        migrations: [],
        dbUrl: "",
        dbKey: "",
      });

      expect(result.exitCode).toBe(0);
      const skipMsg = result.messages.find((msg: string) =>
        /skip/i.test(msg),
      );
      expect(skipMsg).toBeTruthy();
      expect(skipMsg!.toLowerCase()).toContain("credential");
    });

    it("verifies read-only credentials by expecting write failure", async () => {
      const mod = await import("@/../scripts/ci/schema-probe").catch(() =>
        import("@/../scripts/ci/schema-probe.js"),
      );

      // The probe should attempt a test write and expect it to fail
      // This verifies the credentials are actually read-only
      const result = await mod.probe({
        changedFiles: [],
        migrations: [],
        dbUrl: "mock://localhost",
        dbKey: "mock-readonly-key",
        _testSchema: mockSchema,
        _testWriteAttempt: true, // Enable the write verification test
      });

      // Should pass if the write attempt fails as expected
      expect(result.exitCode).toBe(0);
      // Should log that read-only verification succeeded
      const verificationMsg = result.messages.find((msg: string) =>
        msg.toLowerCase().includes("read-only"),
      );
      expect(verificationMsg).toBeDefined();
    });
  });

  describe("CI workflow integration", () => {
    it("has a schema-drift-probe job in .github/workflows/ci.yml", () => {
      const ciWorkflowPath = resolve(__dirname, "../../.github/workflows/ci.yml");
      const ciWorkflow = readFileSync(ciWorkflowPath, "utf-8");

      // Check for the job definition
      expect(ciWorkflow).toContain("schema-drift-probe:");

      // Check it runs on pull requests
      expect(ciWorkflow).toMatch(/if:.*pull_request/);

      // Check it uses the secrets
      expect(ciWorkflow).toContain("SUPABASE_READONLY_URL");
      expect(ciWorkflow).toContain("SUPABASE_READONLY_KEY");
    });

    it("schema-drift-probe job runs the probe script", () => {
      const ciWorkflowPath = resolve(__dirname, "../../.github/workflows/ci.yml");
      const ciWorkflow = readFileSync(ciWorkflowPath, "utf-8");

      // Should run the probe script
      expect(ciWorkflow).toMatch(/scripts\/ci\/schema-probe/);
    });

    it("schema-drift-probe job has reasonable timeout", () => {
      const ciWorkflowPath = resolve(__dirname, "../../.github/workflows/ci.yml");
      const ciWorkflow = readFileSync(ciWorkflowPath, "utf-8");

      // Should have a timeout-minutes setting, max 5 minutes
      // The spec says the probe should complete in under 60 seconds,
      // so a 5-minute timeout is reasonable headroom
      // Scoped to the probe's own job block. An unanchored search matches the
      // first timeout-minutes in the file, which belongs to `gate` — so this
      // asserted the wrong job's timeout and could only be satisfied by
      // lowering an unrelated one.
      const probeJob = ciWorkflow.slice(ciWorkflow.indexOf("schema-drift-probe:"));
      const timeoutMatch = probeJob.match(/timeout-minutes:\s*(\d+)/);
      expect(timeoutMatch).toBeTruthy();
      const timeoutMinutes = parseInt(timeoutMatch![1], 10);
      expect(timeoutMinutes).toBeLessThanOrEqual(5);
    });
  });

  describe("Probe passes on current main", () => {
    it("exits 0 when run against current main with production schema", async () => {
      // This test will be skipped in CI initially because we don't have
      // production credentials in the test environment. It documents the
      // expectation: when the probe runs in CI with real prod credentials,
      // it should pass on unmodified main.

      // In a real CI run:
      // 1. Check out main
      // 2. Run: git diff --name-only origin/main
      // 3. Result: empty (no changed files)
      // 4. Probe should skip or pass with no messages

      const mod = await import("@/../scripts/ci/schema-probe").catch(() =>
        import("@/../scripts/ci/schema-probe.js"),
      );

      const result = await mod.probe({
        changedFiles: [], // No changes on main
        migrations: [],
        dbUrl: "mock://localhost",
        dbKey: "mock-key",
        _testSchema: mockSchema,
      });

      expect(result.exitCode).toBe(0);
    });
  });

  describe("Schema reference extraction", () => {
    it("detects table references in .from() calls", async () => {
      const mod = await import("@/../scripts/ci/schema-probe").catch(() =>
        import("@/../scripts/ci/schema-probe.js"),
      );

      // Mock a code file with .from("events")
      const codeContent = `
        await supabase
          .from("events")
          .insert({ event_name: "test" });
      `;

      // The probe should extract "events" as a referenced table
      const references = mod.extractSchemaReferences
        ? mod.extractSchemaReferences(codeContent, "test.ts")
        : null;

      // not.toBeNull, not toBeDefined: the ternary above yields null when the
      // export is missing, and null is "defined" — so the original assertion
      // passed on the very case it was written to catch, then failed to
      // compile on the property access that followed.
      expect(references).not.toBeNull();
      expect(references!.tables).toContain("events");
    });

    it("detects column references in .insert() calls", async () => {
      const mod = await import("@/../scripts/ci/schema-probe").catch(() =>
        import("@/../scripts/ci/schema-probe.js"),
      );

      const codeContent = `
        await supabase
          .from("events")
          .insert({ user_id: userId, event_name: eventName, properties: {} });
      `;

      const references = mod.extractSchemaReferences
        ? mod.extractSchemaReferences(codeContent, "test.ts")
        : null;

      expect(references).not.toBeNull();
      expect(references!.columns).toContain("user_id");
      expect(references!.columns).toContain("event_name");
      expect(references!.columns).toContain("properties");
    });

    it("parses migration files to extract created columns", async () => {
      const mod = await import("@/../scripts/ci/schema-probe").catch(() =>
        import("@/../scripts/ci/schema-probe.js"),
      );

      const migrationSql = `
        -- Add analytics column
        alter table events add column if not exists session_id uuid;
        create index if not exists events_session_idx on events(session_id);
      `;

      const created = mod.extractCreatedColumns
        ? mod.extractCreatedColumns(migrationSql)
        : null;

      expect(created).toBeDefined();
      expect(created).toContainEqual({
        table: "events",
        column: "session_id",
        type: "uuid",
      });
    });
  });
});
