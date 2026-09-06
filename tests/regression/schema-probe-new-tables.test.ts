// The drift probe and a table that does not exist yet.
//
// An item that CREATES a table and reads it in the same PR was blocked
// permanently, and by two independent faults that compound. STAGE-2 (#623) hit
// both, and the report it produced named columns on tables they have nothing to
// do with:
//
//   Column 'stage_number' referenced in src/app/jobs/[id]/page.tsx
//   does not exist in production table 'jobs'
//   Column 'settled_at' referenced in src/lib/settle-paid-job.ts
//   does not exist in production table 'credit_events'
//   Column 'invoice_id' referenced in src/lib/invoicing.ts
//   does not exist in production table 'invoices'
//
// FAULT ONE — the create-table body was matched with `[^)]+`, so it ended at
// the FIRST close paren in the statement. Nearly every real create-table here
// opens one on its first line: `default gen_random_uuid()`, `references
// jobs(id)`, `check (amount_pennies > 0)`. `payment_stages` therefore
// registered two "columns" out of eight — `id`, and `default`, which is not a
// column at all. Those entries are precisely what exempts a column the PR's own
// migration creates, so under-parsing them turns real new columns into drift.
//
// FAULT TWO — the exemption is keyed `${table}.${column}` off tables that
// already exist in production. A table this PR creates is absent from
// production by definition, so it is filtered out before any check runs and its
// key is never asked for. The column is then reported against whichever
// unrelated table the file happened to name first.
//
// Neither is survivable by the item. Schema precedes code here, so the
// migration cannot be applied before the PR that carries it, and the probe
// cannot pass before the migration is applied. There is no order that satisfies
// both, which is why this is a fix to the check rather than to the item.
//
// The second describe is the load-bearing half. Making a drift check quieter is
// only safe while it still catches what it exists for — #387 took every job
// page down over a column production did not have.

import { describe, expect, it } from "vitest";

import { extractCreatedColumns, probe } from "../../scripts/ci/schema-probe";

/** Production as it stands: no `payment_stages`, because nobody has applied it. */
const PRODUCTION = {
  jobs: [
    { column_name: "id", data_type: "uuid" },
    { column_name: "paid_at", data_type: "timestamptz" },
  ],
  invoices: [
    { column_name: "id", data_type: "uuid" },
    { column_name: "amount", data_type: "numeric" },
    { column_name: "status", data_type: "text" },
  ],
};

/** The real migration's shape: parens on the first line and throughout. */
const MIGRATION = `
  create table payment_stages (
    id uuid primary key default gen_random_uuid(),
    job_id uuid not null references jobs(id) on delete cascade,
    stage_number int not null check (stage_number > 0),
    amount_pennies int not null check (amount_pennies > 0),
    invoice_id uuid references invoices(id) on delete set null,
    settled_at timestamptz,

    unique (job_id, stage_number)
  );
`;

/**
 * The shape that actually reported. Insert and update keys are pooled across
 * the whole file and checked against every table the file names, so a write to
 * the new table lands on whichever old table comes first.
 */
const SETTLEMENT = `
  await admin.from("invoices").update({ status: "paid" }).eq("id", invoiceId);
  await admin
    .from("payment_stages")
    .update({ settled_at: paidAt })
    .eq("invoice_id", invoiceId);
`;

const MIGRATION_PATH = "supabase/migrations/00000000000070_payment_stages.sql";

const run = (files: Record<string, string>) =>
  probe({
    changedFiles: Object.keys(files),
    migrations: [MIGRATION_PATH],
    dbUrl: "postgres://unused",
    dbKey: "unused",
    _testSchema: PRODUCTION,
    _testFileContent: files,
    _testMigrationContent: { [MIGRATION_PATH]: MIGRATION },
  });

describe("parsing a create-table that contains parentheses", () => {
  it("reads every column, not just the ones before the first bracket", () => {
    const created = extractCreatedColumns(MIGRATION)
      .filter((c) => c.table === "payment_stages")
      .map((c) => c.column);

    expect(created).toEqual([
      "id",
      "job_id",
      "stage_number",
      "amount_pennies",
      "invoice_id",
      "settled_at",
    ]);
  });

  it("does not mistake a table-level constraint for a column", () => {
    const created = extractCreatedColumns(MIGRATION).map((c) => c.column);

    expect(created).not.toContain("unique");
    // `default` came from stopping inside `default gen_random_uuid()`.
    expect(created).not.toContain("default");
  });

  it("still reads an alter-table add-column", () => {
    // The other half of this function, and the one a frozen test pins.
    expect(
      extractCreatedColumns("alter table jobs add column total_refunded_pennies int;"),
    ).toContainEqual({ table: "jobs", column: "total_refunded_pennies", type: "int" });
  });
});

describe("a table created by this PR's own migration", () => {
  it("does not pin its columns on an unrelated table", async () => {
    const result = await run({ "src/lib/settle-paid-job.ts": SETTLEMENT });

    const text = result.messages.join("\n");
    expect(text).not.toMatch(/settled_at/);
    expect(text).not.toMatch(/invoice_id/);
  });

  it("passes on the shape that blocked STAGE-2", async () => {
    const result = await run({ "src/lib/settle-paid-job.ts": SETTLEMENT });

    expect(result.exitCode, result.messages.join("\n")).toBe(0);
  });
});

describe("what the probe must still catch", () => {
  it("a column on an existing table that no migration creates", async () => {
    // The #387 case, and the whole reason the probe exists: shipped code
    // naming a column production does not have, which PostgREST rejects at
    // runtime and which no unit test would notice.
    const result = await run({
      "src/lib/invoicing.ts": `
        await admin.from("invoices").update({ nonexistent_column: 1 }).eq("id", id);
      `,
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.messages.join("\n")).toMatch(/nonexistent_column/);
  });

  it("a column on the new table that the migration does NOT create", async () => {
    // The exemption is keyed on the column actually being created. A typo, or
    // a field somebody left out of the migration, still has to fail —
    // otherwise creating any table would blanket-excuse every unknown name in
    // the files that write to it.
    const result = await run({
      "src/lib/settle-paid-job.ts": `
        await admin.from("invoices").update({ status: "paid" }).eq("id", id);
        await admin.from("payment_stages").update({ setled_at: paidAt }).eq("id", id);
      `,
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.messages.join("\n")).toMatch(/setled_at/);
  });
});
