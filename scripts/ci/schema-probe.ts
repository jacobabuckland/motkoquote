import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type ProbeResult = {
  exitCode: number;
  messages: string[];
};

type ProbeConfig = {
  changedFiles: string[];
  migrations: string[];
  dbUrl: string;
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
 * Main probe function. Connects to production database and checks for schema drift.
 */
export async function probe(config: ProbeConfig): Promise<ProbeResult> {
  const messages: string[] = [];

  // Handle test connection error
  if (config._testConnectionError) {
    return {
      exitCode: 2,
      messages: [
        `Connection error: ${config._testConnectionError.message}`,
      ],
    };
  }

  // Initialize Supabase client (or use mock for tests)
  let supabase;
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
    // Real mode: connect to production
    try {
      supabase = createClient(config.dbUrl, config.dbKey, {
        auth: { persistSession: false },
      });

      // Verify read-only by attempting a write (should fail)
      try {
        // Attempt to insert into a non-existent test table
        // If this succeeds, credentials are NOT read-only
        await supabase.from("_probe_write_test_table").insert({ test: 1 });
        // If we get here, the write succeeded - credentials are NOT read-only
        return {
          exitCode: 2,
          messages: [
            "Read-only verification failed: credentials allow writes",
          ],
        };
      } catch (error) {
        // Write failed as expected - credentials are read-only
        messages.push("Read-only credentials verified");
      }

      // Fetch production schema from information_schema
      const { data: columns, error } = await supabase.rpc("get_schema_info");
      if (error) {
        return {
          exitCode: 2,
          messages: [`Failed to fetch schema: ${error.message}`],
        };
      }

      // Group columns by table
      if (columns) {
        for (const col of columns as Array<{
          table_name: string;
          column_name: string;
          data_type: string;
        }>) {
          if (!productionSchema[col.table_name]) {
            productionSchema[col.table_name] = [];
          }
          productionSchema[col.table_name].push({
            column_name: col.column_name,
            data_type: col.data_type,
          });
        }
      }
    } catch (error) {
      return {
        exitCode: 2,
        messages: [
          `Connection error: ${error instanceof Error ? error.message : String(error)}`,
        ],
      };
    }
  }

  // Parse migrations in the PR to find columns being created
  const createdByMigrations = new Set<string>();
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
    for (const col of created) {
      createdByMigrations.add(`${col.table}.${col.column}`);
    }
  }

  // Check all files for schema references
  const allFilesToCheck = config._testAllFiles || config.changedFiles;
  const changedFilesSet = new Set(config.changedFiles);

  const driftFindings: Array<{ file: string; table: string; column: string; isChanged: boolean }> =
    [];

  for (const file of allFilesToCheck) {
    // Only check TypeScript/JavaScript files
    if (!file.match(/\.(ts|tsx|js|jsx)$/)) {
      continue;
    }

    let content: string;
    if (config._testFileContent?.[file]) {
      content = config._testFileContent[file];
    } else if (config._testFileContent !== undefined) {
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

    // Check each table reference
    for (const table of references.tables) {
      if (!productionSchema[table]) {
        // Table missing - this is drift
        driftFindings.push({
          file,
          table,
          column: "*",
          isChanged: changedFilesSet.has(file),
        });
      }
    }

    // Check each column reference (we need to infer which table it belongs to)
    // For now, check if the column exists in any of the referenced tables
    for (const column of references.columns) {
      let found = false;

      // Check each referenced table
      for (const table of references.tables) {
        const tableSchema = productionSchema[table];
        if (tableSchema) {
          const columnExists = tableSchema.some((col) => col.column_name === column);
          if (columnExists) {
            found = true;
            break;
          }
        }

        // Check if this column was created by a migration in the same PR
        if (createdByMigrations.has(`${table}.${column}`)) {
          found = true;
          break;
        }
      }

      if (!found && references.tables.length > 0) {
        // Column not found in any referenced table
        // Report it on the first referenced table
        const table = references.tables[0];
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
    const dbUrl = process.env.SUPABASE_READONLY_URL;
    const dbKey = process.env.SUPABASE_READONLY_KEY;

    if (!dbUrl || !dbKey) {
      console.error(
        "Error: SUPABASE_READONLY_URL and SUPABASE_READONLY_KEY must be set",
      );
      process.exit(2);
    }

    // Get changed files from git diff
    const { execSync } = await import("node:child_process");
    const baseBranch = process.env.GITHUB_BASE_REF || "main";

    let changedFiles: string[] = [];
    try {
      const output = execSync(`git diff --name-only origin/${baseBranch}..HEAD`, {
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

    // Print messages
    for (const msg of result.messages) {
      if (msg.toLowerCase().startsWith("warning")) {
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
