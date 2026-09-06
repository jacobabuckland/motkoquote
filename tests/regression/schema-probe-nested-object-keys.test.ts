// The drift probe and a nested object literal.
//
// `.update({ … })` bodies were matched with `[^}]+`, which stops at the FIRST
// closing brace. When a value is itself an object, that brace is the NESTED
// one, so the payload was truncated mid-entry and every key inside the nested
// literal was collected as a column of the table.
//
// The live instance is in the Stripe webhook, storing a jsonb value:
//
//   .update({
//     payment_status: "failed",
//     last_payment_error: error ? { message: …, code: … } : null,
//   })
//
// which reported:
//
//   Column 'message' referenced in src/app/api/stripe/webhook/route.ts
//   does not exist in production table 'contractors'
//   Column 'code' referenced in ... does not exist in production table 'contractors'
//
// Both are keys of a VALUE, not columns, and `contractors` is not even the table
// being updated — it is whichever table the file named first. It blocked SUB-1
// on 5 Sep and again on 6 Sep, and because the probe only reads CHANGED files it
// lies dormant on main and fires for any PR that touches that route.
//
// Same shape as the create-table `[^)]+` fault: an unbalanced delimiter class
// standing in for a balanced one.

import { describe, expect, it } from "vitest";

import {
  extractBalancedBraces,
  probe,
  splitTopLevelObject,
} from "../../scripts/ci/schema-probe";

const PRODUCTION = {
  invoices: [
    { column_name: "id", data_type: "uuid" },
    { column_name: "payment_status", data_type: "text" },
    { column_name: "last_payment_error", data_type: "jsonb" },
  ],
  contractors: [
    { column_name: "id", data_type: "uuid" },
    { column_name: "company_name", data_type: "text" },
  ],
};

/** The webhook's real shape: a contractors read, then a jsonb write to invoices. */
const WEBHOOK = `
  await admin.from("contractors").select("id, company_name").eq("id", contractorId);

  await admin
    .from("invoices")
    .update({
      payment_status: "failed",
      last_payment_error: error
        ? { message: error.message ?? null, code: error.code ?? null }
        : null,
    })
    .eq("id", invoiceId);
`;

const run = (files: Record<string, string>) =>
  probe({
    changedFiles: Object.keys(files),
    migrations: [],
    dbUrl: "postgres://unused",
    dbKey: "unused",
    _testSchema: PRODUCTION,
    _testFileContent: files,
    _testMigrationContent: {},
  });

describe("balanced-brace extraction", () => {
  it("returns the whole body when a value is itself an object", () => {
    const source = `x({ a: 1, b: { c: 2 }, d: 3 })`;
    const body = extractBalancedBraces(source, source.indexOf("{"));

    expect(body).toContain("d: 3");
  });

  it("returns null for an unterminated object rather than guessing", () => {
    expect(extractBalancedBraces("x({ a: 1", 2)).toBeNull();
  });
});

describe("top-level splitting of an object body", () => {
  it("keeps a nested object with its key", () => {
    const parts = splitTopLevelObject(` a: 1, b: { c: 2, d: 3 }, e: 4 `);

    expect(parts).toHaveLength(3);
    expect(parts[1]).toContain("b:");
    expect(parts[1]).toContain("c: 2");
  });

  it("keeps an array value with its key", () => {
    const parts = splitTopLevelObject(` a: [1, 2, 3], b: 4 `);

    expect(parts).toHaveLength(2);
  });
});

describe("a jsonb value whose keys are not columns", () => {
  it("does not report the nested keys as columns", async () => {
    const result = await run({ "src/app/api/stripe/webhook/route.ts": WEBHOOK });

    const text = result.messages.join("\n");
    expect(text).not.toMatch(/'message'/);
    expect(text).not.toMatch(/'code'/);
  });

  it("passes on the shape that blocked SUB-1 twice", async () => {
    const result = await run({ "src/app/api/stripe/webhook/route.ts": WEBHOOK });

    expect(result.exitCode, result.messages.join("\n")).toBe(0);
  });
});

describe("what the probe must still catch", () => {
  it("a TOP-LEVEL key that no column backs", async () => {
    // The narrowing must not cost the probe its job: a real unknown column in
    // the payload still fails, which is the whole reason the check exists.
    const result = await run({
      "src/lib/x.ts": `
        await admin.from("invoices").update({ nonexistent_column: 1 }).eq("id", id);
      `,
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.messages.join("\n")).toMatch(/nonexistent_column/);
  });

  it("a top-level key that follows a nested object", async () => {
    // The entry AFTER the nested value is where truncation used to lose the
    // trail entirely, so an unknown column hiding there went unreported.
    const result = await run({
      "src/lib/x.ts": `
        await admin.from("invoices").update({
          last_payment_error: { message: "x" },
          bogus_trailing_column: 1,
        }).eq("id", id);
      `,
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.messages.join("\n")).toMatch(/bogus_trailing_column/);
  });
});
