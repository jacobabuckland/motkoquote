import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  findDrift,
  referencesInSelect,
  referencesInSource,
  schemaFromMigrations,
  splitTopLevel,
} from "../../scripts/ci/schema-in-tree";
import { parseAddedLines, wasWritten } from "../../scripts/ci/check-schema-in-tree";

// A guard whose rule cannot be exercised in a test is a guard nobody can
// trust, so the parser is unit-tested rather than only run.
//
// It found twelve pre-existing drifts on main the first time it ran, and it
// found them only after two parser bugs were fixed — the first version missed
// six columns because it required `alter table X add column` to be adjacent.
// That is the failure mode to defend against here: a checker that quietly
// under-reports looks exactly like a clean tree.

const migration = (sql: string) => [{ path: "m.sql", sql }];

describe("splitTopLevel", () => {
  it("splits on commas outside parentheses", () => {
    expect(splitTopLevel("a, b, c")).toEqual(["a", "b", "c"]);
  });

  it("keeps a parenthesised group together", () => {
    // `numeric(10,2)` and `contracts(id, status)` both break a naive split.
    expect(splitTopLevel("total numeric(10,2), status text")).toEqual([
      "total numeric(10,2)",
      "status text",
    ]);
    expect(splitTopLevel("id, contracts(id, status), total")).toEqual([
      "id",
      "contracts(id, status)",
      "total",
    ]);
  });

  it("handles nesting", () => {
    expect(splitTopLevel("id, job:jobs(customer:customers(name), id), total")).toEqual([
      "id",
      "job:jobs(customer:customers(name), id)",
      "total",
    ]);
  });
});

describe("schemaFromMigrations", () => {
  it("reads columns out of a create table", () => {
    const { tables } = schemaFromMigrations(
      migration("create table quotes (id uuid primary key, total numeric(10,2));"),
    );
    expect([...(tables.get("quotes") ?? [])]).toEqual(["id", "total"]);
  });

  it("does not mistake a table-level constraint for a column", () => {
    const { tables } = schemaFromMigrations(
      migration(
        "create table quotes (id uuid, job_id uuid, unique (job_id), primary key (id));",
      ),
    );
    expect(tables.get("quotes")).toEqual(new Set(["id", "job_id"]));
  });

  it("reads an alter table add column", () => {
    const { tables } = schemaFromMigrations(
      migration(
        "create table quotes (id uuid);\nalter table quotes add column sent_total numeric(10,2);",
      ),
    );
    expect(tables.get("quotes")?.has("sent_total")).toBe(true);
  });

  it("reads EVERY column of a multi-clause alter table", () => {
    // The bug that made the first version of this check useless. Migration 012
    // adds four columns in one statement; only the first was seen, so six real
    // columns across the repo were reported as missing.
    const { tables } = schemaFromMigrations(
      migration(`
        create table contracts (id uuid);
        alter table contracts
          add column rendered_body text,
          add column signer_name text,
          add column signed_at timestamptz;
      `),
    );
    expect(tables.get("contracts")).toEqual(
      new Set(["id", "rendered_body", "signer_name", "signed_at"]),
    );
  });

  it("tolerates `if not exists` and a schema qualifier", () => {
    const { tables } = schemaFromMigrations(
      migration(
        "create table if not exists public.events (id uuid);\nalter table public.events add column if not exists event_name text;",
      ),
    );
    expect(tables.get("events")).toEqual(new Set(["id", "event_name"]));
  });

  it("ignores DDL inside a comment", () => {
    const { tables } = schemaFromMigrations(
      migration(
        "-- alter table quotes add column rolled_back text;\ncreate table quotes (id uuid);",
      ),
    );
    expect(tables.get("quotes")?.has("rolled_back")).toBe(false);
  });

  it("reports a rename or a drop rather than modelling it wrongly", () => {
    // Neither appears in this repo's migrations today. If one arrives, the
    // column set this builds is wrong in a way that produces confident
    // nonsense — so it must refuse, not guess.
    expect(
      schemaFromMigrations(migration("alter table quotes rename column a to b;")).unmodelled,
    ).toEqual(["m.sql"]);
    expect(
      schemaFromMigrations(migration("alter table quotes drop column a;")).unmodelled,
    ).toEqual(["m.sql"]);
  });
});

describe("referencesInSelect", () => {
  it("reads plain columns", () => {
    expect(referencesInSelect("id, total", "quotes", 1).map((r) => r.column)).toEqual([
      "id",
      "total",
    ]);
  });

  it("ignores a star", () => {
    expect(referencesInSelect("*", "quotes", 1)).toEqual([]);
  });

  it("attributes an embedded resource's columns to the EMBEDDED table", () => {
    // The claim this check rests on. Attributing them to the outer table would
    // flag almost every select in the app and make the check unusable.
    const refs = referencesInSelect("id, contracts(status, deposit_pct)", "quotes", 1);
    expect(refs).toEqual([
      { table: "quotes", column: "id", line: 1, endLine: 1 },
      { table: "contracts", column: "status", line: 1, endLine: 1 },
      { table: "contracts", column: "deposit_pct", line: 1, endLine: 1 },
    ]);
  });

  it("resolves an alias to the relation it names", () => {
    // "customer:customers(name)" queries `customers`, not `customer`.
    expect(referencesInSelect("customer:customers(name)", "jobs", 1)).toEqual([
      { table: "customers", column: "name", line: 1, endLine: 1 },
    ]);
  });

  it("resolves an aliased plain column to the column, not the alias", () => {
    expect(referencesInSelect("viewed:viewed_at", "quotes", 1)).toEqual([
      { table: "quotes", column: "viewed_at", line: 1, endLine: 1 },
    ]);
  });

  it("strips a join hint from a relation name", () => {
    expect(referencesInSelect("quotes!inner(total)", "jobs", 1)).toEqual([
      { table: "quotes", column: "total", line: 1, endLine: 1 },
    ]);
  });

  it("descends through nesting", () => {
    const refs = referencesInSelect(
      "id, job:jobs(customer:customers(name), contractor:contractors(company_name))",
      "quotes",
      1,
    );
    expect(refs).toEqual([
      { table: "quotes", column: "id", line: 1, endLine: 1 },
      { table: "customers", column: "name", line: 1, endLine: 1 },
      { table: "contractors", column: "company_name", line: 1, endLine: 1 },
    ]);
  });
});

describe("referencesInSource", () => {
  it("attributes a select to its own from, not a later one", () => {
    const source = [
      'await supabase.from("quotes").select("id, total");',
      'await supabase.from("jobs").select("status");',
    ].join("\n");

    expect(referencesInSource(source)).toEqual([
      { table: "quotes", column: "id", line: 1, endLine: 1 },
      { table: "quotes", column: "total", line: 1, endLine: 1 },
      { table: "jobs", column: "status", line: 2, endLine: 2 },
    ]);
  });

  it("reads a select broken across lines", () => {
    // Every long select in this codebase is written this way.
    const source = [
      'const { data } = await supabase',
      '  .from("quotes")',
      '  .select(',
      '    "id, sent_total",',
      '  )',
      '  .maybeSingle();',
    ].join("\n");

    expect(referencesInSource(source).map((r) => `${r.table}.${r.column}`)).toEqual([
      "quotes.id",
      "quotes.sent_total",
    ]);
  });
});

describe("findDrift", () => {
  const tables = new Map([["quotes", new Set(["id", "total"])]]);

  it("flags a column no migration creates", () => {
    const found = findDrift(
      "src/x.ts",
      'supabase.from("quotes").select("id, sent_total")',
      tables,
    );
    expect(found).toEqual([
      { file: "src/x.ts", line: 1, endLine: 1, table: "quotes", column: "sent_total" },
    ]);
  });

  it("is silent when every column exists", () => {
    expect(findDrift("src/x.ts", 'supabase.from("quotes").select("id, total")', tables)).toEqual(
      [],
    );
  });

  it("skips a table the migrations do not describe", () => {
    // Selects reach views, RPC results and test stubs. A check that fires on
    // everything it does not recognise is a check people turn off.
    expect(
      findDrift("src/x.ts", 'supabase.from("mystery").select("whatever")', tables),
    ).toEqual([]);
  });
});

describe("the check as it runs on this repository", () => {
  const run = (): { out: string; status: number } => {
    try {
      return {
        out: execFileSync("npx", ["tsx", "scripts/ci/check-schema-in-tree.ts"], {
          encoding: "utf8",
        }),
        status: 0,
      };
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; status?: number };
      return { out: `${e.stdout ?? ""}${e.stderr ?? ""}`, status: e.status ?? 1 };
    }
  };

  it("finds the real drift already on main", () => {
    // Not a synthetic fixture: these are live queries PostgREST rejects.
    //
    // `contractors.mandate_status` used to be named here too — it was in
    // `hasCancelledMandate`, which selected `mandate_id, mandate_status` where
    // every other site says `fee_mandate_*`, and threw on the rejection, taking
    // the whole uncollectable-fees report down with it. #460 deleted that
    // function, so the drift is gone and naming it here would pin a defect this
    // repository no longer has.
    //
    // Removing an example is legitimate exactly when the drift it names has
    // been FIXED, and never to quiet the check. Leave at least one real finding
    // here: an empty expectation cannot tell a working detector from a broken
    // one, which is the whole point of running it against the live tree rather
    // than a fixture.
    const { out } = run();
    expect(out).toContain("jobs.customer_name");
  });

  it("does not fail the build on drift it did not introduce", () => {
    // A check that cannot land catches nothing. Pre-existing findings are
    // warnings; new ones in changed files are errors.
    expect(run().status).toBe(0);
  });

  it("never lets a green run be read as 'production has these columns'", () => {
    // The misreading that took production down: a green schema check taken as
    // confirmation the columns were on prod. This one reads the tree only, and
    // says so on every run.
    const { out } = run();
    expect(out).toMatch(/cannot tell you whether these migrations have been APPLIED/i);
  });
});

describe("the workflow runs it", () => {
  const ci = readFileSync(".github/workflows/ci.yml", "utf8");

  it("has a step invoking the check", () => {
    expect(ci).toContain("scripts/ci/check-schema-in-tree.ts");
  });

  it("gives it the base ref, so it can tell new drift from old", () => {
    // Without GITHUB_BASE_REF every finding is a warning and the gate never
    // refuses anything — the check would be decorative.
    const step = ci.slice(ci.indexOf("schema-in-tree"));
    expect(ci.slice(0, ci.indexOf("schema-in-tree")) + step).toMatch(/GITHUB_BASE_REF/);
  });
});

// A finding fails the build only when this PR WROTE it. Scoping that by file
// rather than by line is what blocked #403: `jobs.description` has been in
// src/app/ledger/query-actions.ts since long before that item, and an edit
// seventy lines away in the same file inherited the error. #409's own
// precedent line says this check blocks "on what a PR introduces and warning
// on what it inherits", and proximity is neither.
describe("parseAddedLines", () => {
  it("reads a single-line hunk header with no count", () => {
    const added = parseAddedLines(
      ["--- a/src/x.ts", "+++ b/src/x.ts", "@@ -12 +12 @@", "+const a = 1;"].join("\n"),
    );

    expect([...(added.get("src/x.ts") ?? [])]).toEqual([12]);
  });

  it("reads a counted hunk header as the whole range", () => {
    const added = parseAddedLines(
      ["--- a/src/x.ts", "+++ b/src/x.ts", "@@ -0,0 +40,3 @@"].join("\n"),
    );

    expect([...(added.get("src/x.ts") ?? [])]).toEqual([40, 41, 42]);
  });

  it("adds nothing for a pure deletion", () => {
    const added = parseAddedLines(
      ["--- a/src/x.ts", "+++ b/src/x.ts", "@@ -5,3 +4,0 @@", "-gone"].join("\n"),
    );

    // The file is present — it was touched — but no line in it was written.
    expect(added.has("src/x.ts")).toBe(true);
    expect([...(added.get("src/x.ts") ?? [])]).toEqual([]);
  });

  it("keeps hunks in the file they belong to", () => {
    const added = parseAddedLines(
      [
        "--- a/src/a.ts",
        "+++ b/src/a.ts",
        "@@ -1 +1 @@",
        "+a",
        "--- a/src/b.ts",
        "+++ b/src/b.ts",
        "@@ -9 +9 @@",
        "+b",
      ].join("\n"),
    );

    expect([...(added.get("src/a.ts") ?? [])]).toEqual([1]);
    expect([...(added.get("src/b.ts") ?? [])]).toEqual([9]);
  });
});

describe("wasWritten", () => {
  const finding = (line: number, endLine = line) => ({
    file: "src/x.ts",
    line,
    endLine,
    table: "jobs",
    column: "description",
  });

  it("is true for a select on a line this PR wrote", () => {
    expect(wasWritten(new Map([["src/x.ts", new Set([199])]]), finding(199))).toBe(true);
  });

  it("is false for a select elsewhere in a file this PR merely touched", () => {
    // This is #403 exactly: the edit was at line 129, the drift at line 199.
    expect(wasWritten(new Map([["src/x.ts", new Set([129])]]), finding(199))).toBe(false);
  });

  it("is false for a file this PR did not touch at all", () => {
    expect(wasWritten(new Map(), finding(199))).toBe(false);
  });

  it("is true when the written line falls anywhere inside a multi-line select", () => {
    // referencesInSource reports every column of a select at the line the
    // `.select(` opens on, so asking only about that line would let a column
    // added on line four of a five-line select read as inherited drift —
    // which is precisely the edit this check exists to refuse.
    expect(wasWritten(new Map([["src/x.ts", new Set([203])]]), finding(200, 205))).toBe(
      true,
    );
  });

  it("is still false for a line just past the end of the select", () => {
    expect(wasWritten(new Map([["src/x.ts", new Set([206])]]), finding(200, 205))).toBe(
      false,
    );
  });
});

describe("a select spread over several lines", () => {
  it("reports a span, not a single line", () => {
    const source = [
      'const q = supabase',
      '  .from("jobs")',
      '  .select(`',
      '    id,',
      '    description',
      '  `);',
    ].join("\n");

    const refs = referencesInSource(source);

    expect(refs.map((r) => r.column)).toEqual(["id", "description"]);
    // Both are named inside the select that opens on line 3 and closes on 6.
    expect(refs.every((r) => r.line === 3 && r.endLine === 6)).toBe(true);
  });
});
