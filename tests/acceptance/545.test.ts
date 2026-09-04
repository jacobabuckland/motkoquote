/**
 * CHK-1: Derive object-inventory manifest from migrations
 *
 * The baseline was seeded from a production snapshot, so it was blind to
 * whatever was already wrong when it was taken. Re-derive from migrations
 * instead: the only source of truth for what production is allowed to contain.
 */

import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import baseline from "@/checks/public-surface.json";

describe("derive-object-manifest.ts", () => {
  it("can be invoked end-to-end", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "chk1-"));
    const outPath = join(tmpDir, "manifest.json");

    try {
      execSync(`npx tsx scripts/checks/derive-object-manifest.ts --out "${outPath}"`, {
        encoding: "utf-8",
        stdio: "pipe",
      });

      expect(readFileSync(outPath, "utf-8").length).toBeGreaterThan(0);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("produces valid JSON in the expected shape", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "chk1-"));
    const outPath = join(tmpDir, "manifest.json");

    try {
      execSync(`npx tsx scripts/checks/derive-object-manifest.ts --out "${outPath}"`, {
        encoding: "utf-8",
        stdio: "pipe",
      });

      const manifest = JSON.parse(readFileSync(outPath, "utf-8"));

      expect(Array.isArray(manifest)).toBe(true);
      expect(manifest.length).toBeGreaterThan(0);

      for (const obj of manifest) {
        expect(obj).toHaveProperty("object_kind");
        expect(obj).toHaveProperty("object_name");
        expect(["table", "function"]).toContain(obj.object_kind);
        expect(typeof obj.object_name).toBe("string");
        expect(obj.object_name.length).toBeGreaterThan(0);
      }
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("re-running on unchanged tree produces identical output", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "chk1-"));
    const out1 = join(tmpDir, "manifest1.json");
    const out2 = join(tmpDir, "manifest2.json");

    try {
      execSync(`npx tsx scripts/checks/derive-object-manifest.ts --out "${out1}"`, {
        encoding: "utf-8",
        stdio: "pipe",
      });

      execSync(`npx tsx scripts/checks/derive-object-manifest.ts --out "${out2}"`, {
        encoding: "utf-8",
        stdio: "pipe",
      });

      const content1 = readFileSync(out1, "utf-8");
      const content2 = readFileSync(out2, "utf-8");

      expect(content1).toBe(content2);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("includes tables and functions created by migrations", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "chk1-"));
    const outPath = join(tmpDir, "manifest.json");

    try {
      execSync(`npx tsx scripts/checks/derive-object-manifest.ts --out "${outPath}"`, {
        encoding: "utf-8",
        stdio: "pipe",
      });

      const manifest = JSON.parse(readFileSync(outPath, "utf-8"));

      // Tables created in 00000000000001_init_schema.sql
      expect(manifest).toContainEqual({ object_kind: "table", object_name: "contractors" });
      expect(manifest).toContainEqual({ object_kind: "table", object_name: "jobs" });
      expect(manifest).toContainEqual({ object_kind: "table", object_name: "quotes" });

      // Function created in 00000000000007_knowledge_layer.sql
      expect(manifest).toContainEqual({
        object_kind: "function",
        object_name: "match_knowledge_chunks",
      });
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("excludes objects dropped by later migrations", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "chk1-"));
    const outPath = join(tmpDir, "manifest.json");

    try {
      execSync(`npx tsx scripts/checks/derive-object-manifest.ts --out "${outPath}"`, {
        encoding: "utf-8",
        stdio: "pipe",
      });

      const manifest = JSON.parse(readFileSync(outPath, "utf-8"));

      // These three were dropped by 00000000000064_retire_audio_path_and_orphan_tables.sql
      // They never had migrations creating them, but even if they did, a DROP removes them
      expect(manifest).not.toContainEqual({ object_kind: "table", object_name: "client_errors" });
      expect(manifest).not.toContainEqual({ object_kind: "table", object_name: "feedback" });
      expect(manifest).not.toContainEqual({ object_kind: "table", object_name: "rate_limits" });
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("is stricter than a baseline seeded from production", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "chk1-"));
    const outPath = join(tmpDir, "manifest.json");

    try {
      execSync(`npx tsx scripts/checks/derive-object-manifest.ts --out "${outPath}"`, {
        encoding: "utf-8",
        stdio: "pipe",
      });

      const generated = JSON.parse(readFileSync(outPath, "utf-8")) as Array<{
        object_kind: string;
        object_name: string;
      }>;

      // The baseline was seeded from production, so any object that exists on
      // production without a migration is in the baseline. The generator only
      // sees migrations, so it is strictly subset.
      //
      // Demonstrate this with a fixture: an object we know has no migration.
      // We cannot use the three orphans PFIX-6 dropped — they are gone from
      // both now. Instead, assert the structural property: every object in the
      // generated manifest must have come from a migration, so the generated
      // set is never wider than the baseline (though it may be equal).

      const generatedKeys = new Set(
        generated.map((o: { object_kind: string; object_name: string }) =>
          `${o.object_kind}:${o.object_name}`
        ),
      );

      const baselineKeys = new Set(
        baseline.map((o) => `${o.object_kind}:${o.object_name}`),
      );

      // Everything the generator found must be in the baseline, because the
      // baseline was seeded from production and these objects were created by
      // migrations that have been applied.
      for (const key of generatedKeys) {
        expect(
          baselineKeys.has(key),
          `${key} should be in baseline (migrations have been applied to production)`,
        ).toBe(true);
      }

      // The generator may find FEWER objects than the baseline if something
      // exists on production without a migration. That is the property this
      // item fixes: the generator is blind to undeclared objects, which is
      // correct — they should fail the check.
      //
      // We cannot assert a specific orphan here (PFIX-6 removed them), but we
      // can assert that the generator is at least as strict: it never produces
      // MORE objects than the baseline.
      expect(generatedKeys.size).toBeLessThanOrEqual(baselineKeys.size);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("output is sorted deterministically by kind then name", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "chk1-"));
    const outPath = join(tmpDir, "manifest.json");

    try {
      execSync(`npx tsx scripts/checks/derive-object-manifest.ts --out "${outPath}"`, {
        encoding: "utf-8",
        stdio: "pipe",
      });

      const manifest = JSON.parse(readFileSync(outPath, "utf-8"));

      // Check that the array is sorted: first by object_kind, then by object_name
      for (let i = 1; i < manifest.length; i++) {
        const prev = manifest[i - 1];
        const curr = manifest[i];

        if (prev.object_kind === curr.object_kind) {
          expect(prev.object_name.localeCompare(curr.object_name)).toBeLessThanOrEqual(0);
        } else {
          expect(prev.object_kind.localeCompare(curr.object_kind)).toBeLessThan(0);
        }
      }
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("handles create or replace function", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "chk1-"));
    const outPath = join(tmpDir, "manifest.json");

    try {
      execSync(`npx tsx scripts/checks/derive-object-manifest.ts --out "${outPath}"`, {
        encoding: "utf-8",
        stdio: "pipe",
      });

      const manifest = JSON.parse(readFileSync(outPath, "utf-8"));

      // match_knowledge_chunks is created with `create or replace function`
      expect(manifest).toContainEqual({
        object_kind: "function",
        object_name: "match_knowledge_chunks",
      });

      // check_public_object_inventory is updated with `create or replace` in
      // migration 58, but should appear exactly once
      const inventoryFns = manifest.filter(
        (o: { object_kind: string; object_name: string }) =>
          o.object_kind === "function" && o.object_name === "check_public_object_inventory",
      );
      expect(inventoryFns.length).toBe(1);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("handles drop table if exists", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "chk1-"));
    const migrationsDir = join(tmpDir, "migrations");
    const outPath = join(tmpDir, "manifest.json");

    // Create a minimal migrations directory with create and drop
    try {
      execSync(`mkdir -p "${migrationsDir}"`);

      writeFileSync(
        join(migrationsDir, "00000000000001_create_test_table.sql"),
        "create table test_fixture_table (id uuid primary key);\n",
      );

      writeFileSync(
        join(migrationsDir, "00000000000002_drop_test_table.sql"),
        "drop table if exists test_fixture_table;\n",
      );

      execSync(
        `npx tsx scripts/checks/derive-object-manifest.ts --migrations "${migrationsDir}" --out "${outPath}"`,
        { encoding: "utf-8", stdio: "pipe" },
      );

      const manifest = JSON.parse(readFileSync(outPath, "utf-8"));

      // The table was created then dropped, so it should not appear
      expect(manifest).not.toContainEqual({
        object_kind: "table",
        object_name: "test_fixture_table",
      });
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("handles drop function", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "chk1-"));
    const migrationsDir = join(tmpDir, "migrations");
    const outPath = join(tmpDir, "manifest.json");

    try {
      execSync(`mkdir -p "${migrationsDir}"`);

      writeFileSync(
        join(migrationsDir, "00000000000001_create_test_function.sql"),
        "create function test_fixture_fn() returns void language sql as $$ $$;\n",
      );

      writeFileSync(
        join(migrationsDir, "00000000000002_drop_test_function.sql"),
        "drop function if exists test_fixture_fn;\n",
      );

      execSync(
        `npx tsx scripts/checks/derive-object-manifest.ts --migrations "${migrationsDir}" --out "${outPath}"`,
        { encoding: "utf-8", stdio: "pipe" },
      );

      const manifest = JSON.parse(readFileSync(outPath, "utf-8"));

      // The function was created then dropped, so it should not appear
      expect(manifest).not.toContainEqual({
        object_kind: "function",
        object_name: "test_fixture_fn",
      });
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
