import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Checker rule (M5/#16): issued financial records must survive the deletion of
// their parent quote. The invoices→quotes and contracts→quotes foreign keys
// must therefore resolve to ON DELETE RESTRICT — never CASCADE — so no code
// path or manual query can cascade-destroy the invoices/contracts we are
// legally required to retain. We assert the net state across all migrations:
// the latest DDL touching each constraint sets it to RESTRICT.
const MIGRATIONS_DIR = join(process.cwd(), "supabase/migrations");

const allMigrationSql = (): string =>
  readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(join(MIGRATIONS_DIR, f), "utf8"))
    .join("\n");

describe("retention: financial FKs are ON DELETE RESTRICT", () => {
  const sql = allMigrationSql().toLowerCase();

  it("re-declares invoices_quote_id_fkey as ON DELETE RESTRICT", () => {
    expect(sql).toMatch(
      /add constraint invoices_quote_id_fkey[\s\S]*?references quotes \(id\) on delete restrict/,
    );
  });

  it("re-declares contracts_quote_id_fkey as ON DELETE RESTRICT", () => {
    expect(sql).toMatch(
      /add constraint contracts_quote_id_fkey[\s\S]*?references quotes \(id\) on delete restrict/,
    );
  });
});
