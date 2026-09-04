#!/usr/bin/env tsx

/**
 * CHK-1: Derive object-inventory manifest from migrations
 *
 * Walks supabase/migrations/*.sql in order and produces the expected object set:
 * tables and functions created by migrations, minus those dropped by later migrations.
 *
 * Re-running on an unchanged migration tree produces bitwise-identical output.
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface DbObject {
  object_kind: "table" | "function";
  object_name: string;
}

function parseArgs(): { migrationsDir: string; outPath: string } {
  const args = process.argv.slice(2);
  let migrationsDir = join(process.cwd(), "supabase/migrations");
  let outPath: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--migrations" && i + 1 < args.length) {
      migrationsDir = args[i + 1];
      i++;
    } else if (args[i] === "--out" && i + 1 < args.length) {
      outPath = args[i + 1];
      i++;
    }
  }

  if (!outPath) {
    console.error("Error: --out <path> is required");
    process.exit(1);
  }

  return { migrationsDir, outPath };
}

function parseMigrations(migrationsDir: string): DbObject[] {
  // Track objects as a map: "kind:name" -> true (present) or false (dropped)
  const objects = new Map<string, boolean>();

  // Read all .sql files, sorted lexicographically (migration files are numbered)
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const content = readFileSync(join(migrationsDir, file), "utf-8");
    parseMigrationFile(content, objects);
  }

  // Convert map to array of objects that are present (value = true)
  const result: DbObject[] = [];
  for (const [key, isPresent] of objects.entries()) {
    if (isPresent) {
      const [kind, name] = key.split(":", 2);
      result.push({
        object_kind: kind as "table" | "function",
        object_name: name,
      });
    }
  }

  // Sort deterministically: first by kind, then by name
  result.sort((a, b) => {
    if (a.object_kind !== b.object_kind) {
      return a.object_kind.localeCompare(b.object_kind);
    }
    return a.object_name.localeCompare(b.object_name);
  });

  return result;
}

function parseMigrationFile(content: string, objects: Map<string, boolean>): void {
  // Remove SQL comments to simplify parsing
  // Remove single-line comments (-- ...)
  let cleaned = content.replace(/--[^\n]*/g, "");
  // Remove multi-line comments (/* ... */)
  cleaned = cleaned.replace(/\/\*[\s\S]*?\*\//g, "");

  // Parse DDL statements
  // We need to handle:
  // - CREATE TABLE <name>
  // - CREATE FUNCTION <name>
  // - CREATE OR REPLACE FUNCTION <name>
  // - DROP TABLE [IF EXISTS] <name>
  // - DROP FUNCTION [IF EXISTS] <name>

  // Case-insensitive regex patterns
  const createTableRegex = /\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)/gi;
  const createFunctionRegex = /\bcreate\s+(?:or\s+replace\s+)?function\s+([a-z_][a-z0-9_]*)/gi;
  const dropTableRegex = /\bdrop\s+table\s+(?:if\s+exists\s+)?([a-z_][a-z0-9_]*)/gi;
  const dropFunctionRegex = /\bdrop\s+function\s+(?:if\s+exists\s+)?([a-z_][a-z0-9_]*)/gi;

  // Parse CREATE TABLE statements
  let match;
  while ((match = createTableRegex.exec(cleaned)) !== null) {
    const name = match[1];
    objects.set(`table:${name}`, true);
  }

  // Parse CREATE [OR REPLACE] FUNCTION statements
  while ((match = createFunctionRegex.exec(cleaned)) !== null) {
    const name = match[1];
    objects.set(`function:${name}`, true);
  }

  // Parse DROP TABLE statements
  while ((match = dropTableRegex.exec(cleaned)) !== null) {
    const name = match[1];
    // Set to false to mark as dropped (or remove if never created)
    if (objects.has(`table:${name}`)) {
      objects.set(`table:${name}`, false);
    }
  }

  // Parse DROP FUNCTION statements
  while ((match = dropFunctionRegex.exec(cleaned)) !== null) {
    const name = match[1];
    if (objects.has(`function:${name}`)) {
      objects.set(`function:${name}`, false);
    }
  }
}

function main(): void {
  const { migrationsDir, outPath } = parseArgs();

  const manifest = parseMigrations(migrationsDir);

  // Write as formatted JSON with 2-space indent and trailing newline
  const json = JSON.stringify(manifest, null, 2) + "\n";
  writeFileSync(outPath, json, "utf-8");
}

main();
