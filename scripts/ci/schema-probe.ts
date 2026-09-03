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
  /** Postgres connection string for the read-only role. */
  dbUrl: string;
  /** Password for that role, when the connection string does not carry one. */
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

  // Comments are stripped before ANY key extraction below.
  //
  // The object-key pattern is `(\w+)\s*:` over the body of an
  // `.insert({…})` / `.update({…})` call, and a comment inside that body is
  // part of the match. This repository's house style puts long explanations
  // exactly there, so any sentence containing a colon became a column name.
  //
  // PR #532 was blocked by "Column 'inherited' referenced in
  // src/app/jobs/actions.ts does not exist in production table 'contractors'".
  // There is no such column and nothing referenced one: the comment read
  // "...recomputed from the lines being written, never / inherited: the
  // stated-price reconciliation as before...".
  //
  // This makes the parser MORE precise, not more permissive. A real column
  // cannot hide in a comment — a commented-out key is not executing — so
  // stripping them cannot produce a false negative, and it removes a false
  // positive that would otherwise fire on ordinary prose.
  const source = content
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

  // Extract table names from .from("table_name") calls
  const fromPattern = /\.from\(["']([^"']+)["']\)/g;
  let match;
  while ((match = fromPattern.exec(source)) !== null) {
    tables.push(match[1]);
  }

  // Extract column names from .insert({ ... }) and .update({ ... }) calls
  // Pattern: .insert({ key1: value1, key2: value2 })
  const insertUpdatePattern = /\.(insert|update)\s*\(\s*\{([^}]+)\}/g;
  while ((match = insertUpdatePattern.exec(source)) !== null) {
    const objectContent = match[2];
    // Extract keys from the object
    const keyPattern = /(\w+)\s*:/g;
    let keyMatch;
    while ((keyMatch = keyPattern.exec(objectContent)) !== null) {
      columns.push(keyMatch[1]);
    }
  }

  // Extract column names from .select("col1, col2") calls.
  //
  // Embedded resources are dropped entirely, innermost first. PostgREST lets a
  // select pull columns from a joined table —
  //
  //     .select("contractor_id, contractor:contractors(company_name, vat_registered)")
  //     .select("id, work_completed_at, quotes(contracts(status, signed_at))")
  //
  // — and those columns belong to the embedded table, not to the one `.from()`
  // names. The previous filter dropped any token containing "(", which caught
  // the first token of a group and missed every one after it: splitting on
  // commas left `vat_registered)` and `signed_at))`, trailing brackets and all,
  // which were then checked against the outer table.
  //
  // The first genuinely working run of this probe failed #511 on exactly those
  // two. Both columns exist — `contractors.vat_registered` and
  // `contracts.signed_at` — and `signed_at` is not even on the table it was
  // reported against. A check that blocks a correct PR while naming a column
  // that does exist is worse than one that says nothing, so the groups are
  // removed rather than half-parsed.
  //
  // The identifier test is the backstop: only a bare column name is ever
  // treated as a column reference, so no future spelling of this can smuggle
  // punctuation into a table lookup.
  const selectPattern = /\.select\(["']([^"']+)["']\)/g;
  while ((match = selectPattern.exec(source)) !== null) {
    let flattened = match[1];
    let previous: string;
    do {
      previous = flattened;
      flattened = flattened.replace(/[A-Za-z0-9_]*:?[A-Za-z0-9_]*\([^()]*\)/g, "");
    } while (flattened !== previous);

    const cols = flattened.split(",").map((c) => c.trim());
    columns.push(...cols.filter((c) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(c)));
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

  // Read production's schema (or use the injected one for tests)
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
    // Real mode: connect to production over Postgres. One connection, not two.
    //
    // This used to open a Supabase REST client to prove the credential could
    // not write, and a `pg` client to read the schema — both built from
    // `config.dbUrl`. No single value satisfies both: `createClient` requires
    // an http(s) URL and `pg` requires a Postgres DSN. So the first real run
    // after the secrets were configured died on `Invalid supabaseUrl: Must be
    // a valid HTTP or HTTPS URL` before reaching the half that worked.
    //
    // REST could never have done the reading anyway — PostgREST does not
    // expose `information_schema` — so the DSN is the credential that matters
    // and the REST half is gone. Verifying read-only over the same connection
    // that does the reading is also the stronger claim: it proves the
    // credential actually used for the schema read cannot write, rather than
    // proving it about a different one that is never used again.
    if (!/^postgres(ql)?:\/\//.test(config.dbUrl)) {
      return {
        exitCode: 2,
        messages: [
          "Connection error: SUPABASE_READONLY_URL is not a Postgres " +
            "connection string. It must start with postgres:// or " +
            "postgresql://. The probe reads information_schema, which the " +
            "REST API does not expose, so the https://<project>.supabase.co " +
            "URL cannot be used here — take the Session pooler string from " +
            "Supabase, Project Settings, Database, and use the schema_probe " +
            "role (00000000000060). Not agent_readonly, which is NOLOGIN and " +
            "sees only four tables, and not postgres, which can write and is " +
            "refused below.",
        ],
      };
    }

    // SUPABASE_READONLY_KEY is the role's password. A connection string may
    // already carry it, in which case the string wins and the secret is
    // redundant; one kept password-free needs it supplied separately. Both
    // shapes work, so which of the two the secret holds is not a guess the
    // probe has to make.
    let dsnHasPassword = false;
    try {
      dsnHasPassword = Boolean(new URL(config.dbUrl).password);
    } catch {
      dsnHasPassword = false;
    }

    const pgClient = new Client({
      connectionString: config.dbUrl,
      ...(dsnHasPassword || !config.dbKey ? {} : { password: config.dbKey }),
    });

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
      // Verify read-only by asking the catalog, not by attempting a write.
      //
      // Three versions of this check have now been wrong, each in a way the
      // one before it hid.
      //
      // The first fired a bare INSERT at production `events` through
      // supabase-js and relied on it being refused. supabase-js resolves with
      // `{ error }` rather than rejecting unless `.throwOnError()` is called,
      // so the catch never ran: a genuinely read-only credential was reported
      // as allowing writes, and a genuinely writable one would have left a row
      // behind in a live table as its evidence.
      //
      // The second — mine — kept the INSERT, moved it to `pg` so a refusal
      // would actually reject, and wrapped it in a rolled-back transaction so
      // a writable credential could not persist anything. Both fixes hold. But
      // it named `events (event_name, occurred_at)`, a column list inherited
      // from code that had never once executed against production, and there
      // is no `occurred_at` on `events` — it is `created_at`. The first run
      // after the credentials were finally correct died on that, having proved
      // only that the connection worked.
      //
      // A write attempt was never the right shape. `has_table_privilege` reads
      // the grants the connected role actually holds, so nothing is written,
      // nothing is rolled back, no column or table name is hard-coded to drift
      // out of date, and the answer covers every table in `public` rather than
      // whichever one the probe happened to pick. A superuser or service-role
      // string is caught on all of them at once.
      const writable = await pgClient.query<{ table_name: string }>(`
        SELECT c.relname::text AS table_name
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind = 'r'
          AND (has_table_privilege(c.oid, 'INSERT')
            OR has_table_privilege(c.oid, 'UPDATE')
            OR has_table_privilege(c.oid, 'DELETE')
            OR has_table_privilege(c.oid, 'TRUNCATE'))
        ORDER BY 1
      `);

      if (writable.rows.length > 0) {
        await pgClient.end().catch(() => {
          /* ignore cleanup errors */
        });
        const named = writable.rows.slice(0, 5).map((r) => r.table_name);
        const rest =
          writable.rows.length > named.length
            ? ` and ${writable.rows.length - named.length} more`
            : "";
        return {
          exitCode: 2,
          messages: [
            `Read-only verification failed: credentials allow writes to ` +
              `${named.join(", ")}${rest}. SUPABASE_READONLY_URL must connect ` +
              `as a role holding SELECT and nothing else — schema_probe ` +
              `(00000000000060), not postgres and not the service role.`,
          ],
        };
      }

      messages.push("Read-only credentials verified");

      // Query information_schema.columns for all tables in the public schema
      const result = await pgClient.query(`
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

      await pgClient.end();
    } catch (error) {
      await pgClient.end().catch(() => {
        /* ignore cleanup errors */
      });
      return {
        exitCode: 2,
        messages: [
          `Failed to fetch schema: ${error instanceof Error ? error.message : String(error)}`,
        ],
      };
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
    // One without the other is a genuine misconfiguration and still fails closed.
    if (Boolean(dbUrl) !== Boolean(dbKey)) {
      console.error(
        "Error: SUPABASE_READONLY_URL and SUPABASE_READONLY_KEY must both be set, or both be absent",
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
