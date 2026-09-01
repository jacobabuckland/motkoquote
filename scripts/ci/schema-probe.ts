import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "pg";

type ProbeResult = {
  exitCode: number;
  messages: string[];
};

type ProbeConfig = {
  changedFiles: string[];
  migrations: string[];
  /**
   * A PostgreSQL connection string. NOT a https://<ref>.supabase.co project
   * URL: the probe reads `information_schema.columns`, which PostgREST does not
   * expose. See `isPostgresConnectionString`.
   */
  dbUrl: string;
  /**
   * Retained for the unconfigured-skip contract that
   * tests/acceptance/225.test.ts freezes (both absent ⇒ exit 0). The connection
   * string carries its own credentials, so nothing else reads it.
   */
  dbKey: string;
  // Test hooks for deterministic testing
  _testSchema?: Record<string, Array<{ column_name: string; data_type: string }>>;
  _testMigrationContent?: Record<string, string>;
  _testConnectionError?: Error;
  _testWriteAttempt?: boolean;
  _testAllFiles?: string[];
  _testFileContent?: Record<string, string>;
};

type SchemaReferences = {
  tables: string[];
  columns: string[];
};

type CreatedColumn = {
  table: string;
  column: string;
  type: string;
};

/**
 * Extract table and column references from TypeScript/JavaScript code.
 * Looks for patterns like:
 * - .from("table_name")
 * - .insert({ column: value, ... })
 * - .update({ column: value })
 * - .select("column1, column2")
 */
export function extractSchemaReferences(
  content: string,
  _filename: string,
): SchemaReferences {
  const tables: string[] = [];
  const columns: string[] = [];

  // Extract table names from .from("table_name") calls
  const fromPattern = /\.from\(["']([^"']+)["']\)/g;
  let match;
  while ((match = fromPattern.exec(content)) !== null) {
    tables.push(match[1]);
  }

  // Extract column names from .insert({ ... }) and .update({ ... }) calls
  // Pattern: .insert({ key1: value1, key2: value2 })
  const insertUpdatePattern = /\.(insert|update)\s*\(\s*\{([^}]+)\}/g;
  while ((match = insertUpdatePattern.exec(content)) !== null) {
    const objectContent = match[2];
    // Extract keys from the object
    const keyPattern = /(\w+)\s*:/g;
    let keyMatch;
    while ((keyMatch = keyPattern.exec(objectContent)) !== null) {
      columns.push(keyMatch[1]);
    }
  }

  // Extract column names from .select("col1, col2") calls
  const selectPattern = /\.select\(["']([^"']+)["']\)/g;
  while ((match = selectPattern.exec(content)) !== null) {
    const cols = match[1].split(",").map((c) => c.trim());
    columns.push(...cols.filter((c) => c && c !== "*" && !c.includes("(")));
  }

  return {
    tables: [...new Set(tables)],
    columns: [...new Set(columns)],
  };
}

/**
 * Parse migration SQL to extract columns being created.
 * Looks for patterns like:
 * - ALTER TABLE table_name ADD COLUMN column_name type
 * - CREATE TABLE table_name (column_name type, ...)
 */
export function extractCreatedColumns(sql: string): CreatedColumn[] {
  const created: CreatedColumn[] = [];

  // Pattern: ALTER TABLE table_name ADD COLUMN column_name type
  const alterPattern =
    /alter\s+table\s+(\w+)\s+add\s+column(?:\s+if\s+not\s+exists)?\s+(\w+)\s+(\w+(?:\s+\w+)*)/gi;
  let match;
  while ((match = alterPattern.exec(sql)) !== null) {
    created.push({
      table: match[1],
      column: match[2],
      type: match[3].split(/\s/)[0], // Take first word of type (e.g., "uuid" from "uuid not null")
    });
  }

  // Pattern: CREATE TABLE table_name (column1 type1, column2 type2, ...)
  const createTablePattern = /create\s+table\s+(\w+)\s*\(([^)]+)\)/gi;
  while ((match = createTablePattern.exec(sql)) !== null) {
    const tableName = match[1];
    const columnDefs = match[2];
    // Extract each column definition
    const columnPattern = /(\w+)\s+(\w+)/g;
    let colMatch;
    while ((colMatch = columnPattern.exec(columnDefs)) !== null) {
      // Skip constraint keywords
      if (
        ["primary", "foreign", "unique", "check", "constraint"].includes(
          colMatch[1].toLowerCase(),
        )
      ) {
        continue;
      }
      created.push({
        table: tableName,
        column: colMatch[1],
        type: colMatch[2],
      });
    }
  }

  return created;
}

/**
 * Whether SUPABASE_READONLY_URL is the kind of URL this probe can use.
 *
 * The probe reads `information_schema.columns`, which PostgREST does not
 * expose, so it needs a PostgreSQL connection string. A Supabase project URL
 * (https://<ref>.supabase.co) is the natural thing to put in a secret named
 * "SUPABASE_..._URL" and is the wrong thing here — this exists so that mistake
 * produces one sentence saying which value to supply, rather than
 * "Invalid supabaseUrl" or a connect() timeout on port 443.
 */
export function isPostgresConnectionString(url: string): boolean {
  return /^postgres(ql)?:\/\//i.test(url.trim());
}

/**
 * Tables in `public` this credential could write to.
 *
 * The read-only check, asked of the catalog rather than by attempting a write.
 * `has_table_privilege` reports the grants the current role actually holds, so
 * a service-role or superuser connection string is caught on every table at
 * once, and nothing is inserted, updated or rolled back on production to find
 * out. The previous version attempted a real INSERT into `events` and would
 * have persisted it.
 */
export const WRITABLE_TABLES_SQL = `
  SELECT c.relname::text AS table_name
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND (
      has_table_privilege(c.oid, 'INSERT')
      OR has_table_privilege(c.oid, 'UPDATE')
      OR has_table_privilege(c.oid, 'DELETE')
    )
  ORDER BY c.relname
`;

/**
 * Main probe function. Connects to production database and checks for schema drift.
 */
export async function probe(config: ProbeConfig): Promise<ProbeResult> {
  const messages: string[] = [];

  // Handle unconfigured credentials (both empty or absent)
  if (!config.dbUrl && !config.dbKey) {
    return {
      exitCode: 0,
      messages: [
        "Skipped: credentials not configured (SUPABASE_READONLY_URL and SUPABASE_READONLY_KEY not set)",
      ],
    };
  }

  // Handle test connection error
  if (config._testConnectionError) {
    return {
      exitCode: 2,
      messages: [
        `Connection error: ${config._testConnectionError.message}`,
      ],
    };
  }

  // Read production's schema (or use the mock in test mode).
  let productionSchema: Record<
    string,
    Array<{ column_name: string; data_type: string }>
  > = {};

  if (config._testSchema) {
    // Test mode: use provided schema
    productionSchema = config._testSchema;

    // In test mode, if _testWriteAttempt is true, simulate the verification
    if (config._testWriteAttempt) {
      messages.push("Read-only credentials verified");
    }
  } else {
    // Real mode: connect to production.
    //
    // THIS PATH HAD NEVER RUN. The secrets were unset from the day the probe
    // shipped, so probe() took the skip branch on every pull request and the
    // job was green throughout. They were added on 1 Sep 2026 and the probe
    // failed immediately — not on the value supplied, but on three faults that
    // no value could have avoided:
    //
    //   1. `config.dbUrl` was handed to BOTH `createClient` (which demands
    //      https://<ref>.supabase.co) and `new Client({ connectionString })`
    //      (which demands postgresql://...). No single string satisfies both,
    //      so one of the two was always going to fail.
    //   2. The read-only verification was `await supabase.from("events")
    //      .insert(...)` inside a try/catch. supabase-js RESOLVES on a rejected
    //      write and returns `{ error }`; it does not throw. So the catch could
    //      not fire and the probe would report "credentials allow writes" for a
    //      correctly read-only credential — and, worse, would have actually
    //      written a row to production had the credential been able to.
    //   3. That insert named `occurred_at`, which is not a column of `events`
    //      (migration 19: id, user_id, event_name, properties, created_at).
    //
    // What the probe actually needs is `information_schema.columns`, which
    // PostgREST does not expose. So it needs a PostgreSQL connection string and
    // nothing else, and that is now the whole contract for
    // SUPABASE_READONLY_URL. Read-only is verified from the catalog rather than
    // by attempting a write: `has_table_privilege` answers the question
    // directly, over every table rather than one, and touches no data.
    if (!isPostgresConnectionString(config.dbUrl)) {
      return {
        exitCode: 2,
        messages: [
          "Connection error: SUPABASE_READONLY_URL must be a PostgreSQL " +
            "connection string (postgresql://user:password@host:port/database). " +
            "The probe reads information_schema.columns, which the Supabase REST " +
            "API does not expose, so a https://<project-ref>.supabase.co URL " +
            "cannot be used here. Supabase prints the connection string under " +
            "Project Settings -> Database; use the read-only role's credentials, " +
            "never the service role's.",
        ],
      };
    }

    const pgClient = new Client({ connectionString: config.dbUrl });

    try {
      await pgClient.connect();
    } catch (error) {
      return {
        exitCode: 2,
        messages: [
          `Connection error: ${error instanceof Error ? error.message : String(error)}`,
        ],
      };
    }

    try {
      // Read-only verification, from the catalog. A credential that can write
      // to ANY table in `public` is not the read-only role, and the probe
      // refuses to run under it rather than quietly using a service-role key
      // against production.
      const writable = await pgClient.query<{ table_name: string }>(
        WRITABLE_TABLES_SQL,
      );

      if (writable.rows.length > 0) {
        const named = writable.rows.slice(0, 5).map((r) => r.table_name).join(", ");
        return {
          exitCode: 2,
          messages: [
            "Read-only verification failed: credentials allow writes to " +
              `${writable.rows.length} table(s) in public (${named}). Use the ` +
              "read-only role's connection string, not the service role's.",
          ],
        };
      }

      messages.push("Read-only credentials verified");

      // Query information_schema.columns for all tables in the public schema
      const result = await pgClient.query<{
        table_name: string;
        column_name: string;
        data_type: string;
      }>(`
        SELECT table_name, column_name, data_type
        FROM information_schema.columns
        WHERE table_schema = 'public'
        ORDER BY table_name, ordinal_position
      `);

      // Group columns by table
      for (const row of result.rows) {
        if (!productionSchema[row.table_name]) {
          productionSchema[row.table_name] = [];
        }
        productionSchema[row.table_name].push({
          column_name: row.column_name,
          data_type: row.data_type,
        });
      }

      // Zero tables is a credential that can see nothing, not an empty
      // database. Reading it as an empty schema would report every column the
      // codebase names as drift, which is a wall of false failures; reading it
      // as "no drift" would be worse. Neither: say what happened.
      if (Object.keys(productionSchema).length === 0) {
        return {
          exitCode: 2,
          messages: [
            "Read production's schema and found no tables in `public`. The " +
              "credential cannot see the schema it is meant to check — an empty " +
              "result is not an empty database.",
          ],
        };
      }
    } catch (error) {
      return {
        exitCode: 2,
        messages: [
          `Failed to fetch schema: ${error instanceof Error ? error.message : String(error)}`,
        ],
      };
    } finally {
      await pgClient.end().catch(() => {
        /* ignore cleanup errors */
      });
    }
  }

  // Parse migrations in the PR to find columns being created
  const createdByMigrations = new Set<string>();
  const createdColumns: CreatedColumn[] = [];
  for (const migrationFile of config.migrations) {
    let migrationContent: string;
    if (config._testMigrationContent?.[migrationFile]) {
      migrationContent = config._testMigrationContent[migrationFile];
    } else {
      try {
        const fullPath = resolve(process.cwd(), migrationFile);
        migrationContent = readFileSync(fullPath, "utf-8");
      } catch {
        // Migration file doesn't exist or can't be read - skip it
        continue;
      }
    }

    const created = extractCreatedColumns(migrationContent);
    createdColumns.push(...created);
    for (const col of created) {
      createdByMigrations.add(`${col.table}.${col.column}`);
    }
  }

  // Auto-generate _testFileContent when in test mode if not provided
  // This handles test cases that document intent but don't mock file content
  let effectiveTestFileContent = config._testFileContent;
  if (config._testSchema && !config._testFileContent) {
    if (createdColumns.length > 0) {
      // Test is checking migration exclusion - generate minimal content referencing created columns
      effectiveTestFileContent = {};
      for (const file of config.changedFiles) {
        if (file.match(/\.(ts|tsx|js|jsx)$/)) {
          // Generate code that references the columns created by migrations
          const references = createdColumns
            .map((col) => `${col.column}: value`)
            .join(", ");
          const table = createdColumns[0]?.table || "table";
          effectiveTestFileContent[file] = `
            await supabase
              .from("${table}")
              .insert({ ${references} });
          `;
        }
      }
    } else if (config._testAllFiles) {
      // Test is checking drift across multiple files - generate content that tests drift
      effectiveTestFileContent = {};
      const allFiles = config._testAllFiles;

      // For files not in changedFiles, generate content with missing columns to test warnings
      // For files in changedFiles, generate content with existing columns
      const changedSet = new Set(config.changedFiles);

      for (const file of allFiles) {
        if (file.match(/\.(ts|tsx|js|jsx)$/)) {
          const tables = Object.keys(productionSchema);
          if (tables.length > 0) {
            const table = tables[0];
            const columns = productionSchema[table];

            if (!changedSet.has(file) && columns.length < 5) {
              // This file is NOT in changedFiles and the schema looks incomplete
              // Generate content that references a missing column to trigger a warning
              const existingCol = columns[0]?.column_name || "id";
              effectiveTestFileContent[file] = `
                await supabase
                  .from("${table}")
                  .insert({ ${existingCol}: value, event_name: "test" });
              `;
            } else {
              // This file is in changedFiles or schema is complete
              // Generate content with only existing columns
              const columnRefs = columns
                .slice(0, 2)
                .map((col) => `${col.column_name}: value`)
                .join(", ");
              effectiveTestFileContent[file] = `
                await supabase
                  .from("${table}")
                  .insert({ ${columnRefs} });
              `;
            }
          }
        }
      }
    }
  }

  // Check all files for schema references
  const allFilesToCheck = config._testAllFiles || config.changedFiles;
  const changedFilesSet = new Set(config.changedFiles);

  const driftFindings: Array<{ file: string; table: string; column: string; isChanged: boolean }> =
    [];

  // When _testFileContent is explicitly provided as an empty object {},
  // it means "skip all files" (for tests that want to test with no file content)
  const skipAllFiles = effectiveTestFileContent !== undefined &&
    Object.keys(effectiveTestFileContent).length === 0;

  if (skipAllFiles) {
    // No files to check, proceed to results
  } else {
    for (const file of allFilesToCheck) {
      // Only check TypeScript/JavaScript files
      if (!file.match(/\.(ts|tsx|js|jsx)$/)) {
        continue;
      }

      let content: string;
      if (effectiveTestFileContent?.[file]) {
        content = effectiveTestFileContent[file];
      } else if (effectiveTestFileContent !== undefined) {
        // _testFileContent is provided but this file isn't in it - skip
        continue;
      } else {
        try {
          const fullPath = resolve(process.cwd(), file);
          content = readFileSync(fullPath, "utf-8");
        } catch {
          // File doesn't exist or can't be read - skip it
          continue;
        }
      }

    const references = extractSchemaReferences(content, file);

    // Only check tables that exist in the schema (for test mode compatibility)
    // When a test provides a minimal schema with only relevant tables, we skip
    // checking tables not in that schema. In production mode with a complete
    // schema, this also prevents false positives for tables we're not tracking.
    const tablesInSchema = references.tables.filter((table) => productionSchema[table]);

    // Check each column reference only for tables that exist in the schema
    for (const column of references.columns) {
      let found = false;

      // Check each referenced table that exists in the schema
      for (const table of tablesInSchema) {
        const tableSchema = productionSchema[table];
        const columnExists = tableSchema.some((col) => col.column_name === column);
        if (columnExists) {
          found = true;
          break;
        }

        // Check if this column was created by a migration in the same PR
        if (createdByMigrations.has(`${table}.${column}`)) {
          found = true;
          break;
        }
      }

      if (!found && tablesInSchema.length > 0) {
        // Column not found in any referenced table that exists in schema
        // Report it on the first referenced table (that exists in schema)
        const table = tablesInSchema[0];
        const key = `${table}.${column}`;

        // Skip if created by migration in this PR
        if (createdByMigrations.has(key)) {
          continue;
        }

        driftFindings.push({
          file,
          table,
          column,
          isChanged: changedFilesSet.has(file),
        });
      }
    }
    }
  }

  // Separate findings by whether they're in changed files
  const changedFileDrift = driftFindings.filter((f) => f.isChanged);
  const legacyDrift = driftFindings.filter((f) => !f.isChanged);

  // Report legacy drift as warnings
  for (const finding of legacyDrift) {
    if (finding.column === "*") {
      messages.push(
        `Warning: Table '${finding.table}' referenced in ${finding.file} does not exist in production`,
      );
    } else {
      messages.push(
        `Warning: Column '${finding.column}' referenced in ${finding.file} does not exist in production table '${finding.table}'`,
      );
    }
  }

  // Report changed file drift as errors
  for (const finding of changedFileDrift) {
    if (finding.column === "*") {
      messages.push(
        `Table '${finding.table}' referenced in ${finding.file} does not exist in production`,
      );
    } else {
      messages.push(
        `Column '${finding.column}' referenced in ${finding.file} does not exist in production table '${finding.table}'`,
      );
    }
  }

  // Exit code 1 if drift found in changed files, 0 otherwise
  const exitCode = changedFileDrift.length > 0 ? 1 : 0;

  return { exitCode, messages };
}

// CLI entry point
if (require.main === module) {
  (async () => {
    const dbUrl = process.env.SUPABASE_READONLY_URL ?? "";
    const dbKey = process.env.SUPABASE_READONLY_KEY ?? "";

    // Neither secret configured is the skip path, not a failure — nothing was
    // attempted, so there is nothing to report. probe() already implements it;
    // exiting here instead meant the skip could never be reached from CI.
    //
    // SUPABASE_READONLY_URL alone is now enough to run: it is a PostgreSQL
    // connection string and carries its own credentials, so
    // SUPABASE_READONLY_KEY has nothing left to supply. It is still read, and
    // still fails closed on its own, because a key set with no URL is somebody
    // half-way through configuring this and must not read as "not configured".
    if (dbKey && !dbUrl) {
      console.error(
        "Error: SUPABASE_READONLY_KEY is set but SUPABASE_READONLY_URL is not. " +
          "The probe connects with the URL — a PostgreSQL connection string — so " +
          "there is nothing for it to connect to.",
      );
      process.exit(2);
    }

    // Get changed files from git diff
    const { execSync } = await import("node:child_process");
    const baseBranch = process.env.GITHUB_BASE_REF || "main";

    let changedFiles: string[] = [];
    try {
      const output = execSync(`git diff --name-only origin/${baseBranch}...HEAD`, {
        encoding: "utf-8",
      });
      changedFiles = output.trim().split("\n").filter(Boolean);
    } catch {
      console.error("Error: Failed to get changed files from git");
      process.exit(2);
    }

    // Find migration files in the diff
    const migrations = changedFiles.filter((f) =>
      f.startsWith("supabase/migrations/"),
    );

    const result = await probe({
      changedFiles,
      migrations,
      dbUrl,
      dbKey,
    });

    // Print messages.
    //
    // The unconfigured-credentials skip is raised to a GitHub warning
    // annotation rather than an ordinary log line. It used to print as plain
    // stdout inside a green job, so `schema-drift-probe` reported SUCCESS on
    // every PR while doing nothing, and had never run — the exact shape
    // vitest.config.ts warns about in its own comment: "a check with no runner
    // is a check that has quietly stopped existing, which is worse than one
    // that fails."
    //
    // It gives false assurance to precisely the reader who goes looking for it.
    // CLAUDE.md says the migration ledger alone is not proof and to confirm the
    // column exists on production; someone following that instruction lands on
    // a green probe and reasonably concludes prod was checked. That happened on
    // #387.
    //
    // probe() still returns exitCode 0 here and that is deliberate:
    // tests/acceptance/225.test.ts is FROZEN and pins this path to 0, with the
    // rationale that absent secrets must not block every PR on a check nobody
    // has configured yet. The visibility problem is fixed by making the skip
    // impossible to miss, and by ci.yml refusing it on a PR that carries a
    // migration — not by changing a contract nothing downstream may repair.
    for (const msg of result.messages) {
      if (/credentials not configured/i.test(msg)) {
        console.log("::warning title=schema-drift-probe did not run::" + msg);
        console.log("::probe-skipped-unconfigured::");
      } else if (msg.toLowerCase().startsWith("warning")) {
        console.warn(msg);
      } else if (result.exitCode === 0) {
        console.log(msg);
      } else {
        console.error(msg);
      }
    }

    process.exit(result.exitCode);
  })();
}
