import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DESTRUCTIVE,
  findDestructive,
  stripSqlComments,
} from "@/../scripts/ci/migration-safety";

const labels = (sql: string): string[] => findDestructive(sql).map((h) => h.label);

describe("stripping SQL comments", () => {
  it("blanks a line comment but keeps the line", () => {
    const out = stripSqlComments("select 1;\n-- drop table x;\nselect 2;");
    expect(out.split("\n")).toHaveLength(3);
    expect(out).not.toMatch(/drop table x/i);
    expect(out).toContain("select 1;");
    expect(out).toContain("select 2;");
  });

  it("blanks a block comment, and counts nesting the way Postgres does", () => {
    const out = stripSqlComments("a /* one /* two */ still-comment */ b");
    expect(out).toContain("a");
    expect(out).toContain("b");
    expect(out).not.toContain("still-comment");
  });

  // Line numbers have to survive, or the error points at the wrong line.
  it("preserves line numbering through a multi-line comment", () => {
    const sql = ["select 1;", "/*", "drop table x;", "*/", "drop table y;"].join("\n");
    const hits = findDestructive(sql);
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(5);
  });

  it("does not treat -- inside a string as a comment", () => {
    // Truncating at the -- would hide the real DDL later on the same line.
    const out = stripSqlComments("select 'a -- b'; drop table x;");
    expect(out).toMatch(/drop table x/i);
  });

  it("leaves a dollar-quoted function body intact", () => {
    const sql = [
      "create function f() returns void language plpgsql as $$",
      "begin",
      "  -- this is a comment inside the body",
      "  perform 1;",
      "end;",
      "$$;",
    ].join("\n");
    expect(stripSqlComments(sql)).toContain("perform 1;");
  });

  it("handles a tagged dollar quote", () => {
    expect(stripSqlComments("as $body$ select 'x'; $body$;")).toContain("select 'x';");
  });

  it("handles an escaped quote inside a literal", () => {
    expect(stripSqlComments("select 'it''s fine'; drop table x;")).toMatch(/drop table x/i);
  });
});

describe("what counts as destructive", () => {
  // The regression. #244 was blocked for documenting how to undo itself.
  it("passes a migration whose rollback plan is in comments", () => {
    const sql = [
      "create table job_costs (id uuid primary key);",
      "create table counterparties (id uuid primary key);",
      "",
      "-- Down migration (for rollback):",
      "-- drop table job_costs;",
      "-- drop table counterparties;",
    ].join("\n");
    expect(findDestructive(sql)).toEqual([]);
  });

  it("still fails a real DROP TABLE", () => {
    expect(labels("drop table job_costs;")).toEqual(["DROP TABLE"]);
  });

  it("still catches every statement it claims to", () => {
    expect(labels("alter table t drop column c;")).toContain("DROP COLUMN");
    expect(labels("drop schema public;")).toContain("DROP SCHEMA");
    expect(labels("truncate t;")).toContain("TRUNCATE");
    expect(labels("delete from t where 1=1;")).toContain("DELETE FROM");
    expect(DESTRUCTIVE).toHaveLength(5);
  });

  // DECIDED AND STATED: string literals are scanned. Dynamic SQL is real DDL,
  // and exempting strings would make this guard one quote away from bypassable.
  it("fails a DROP TABLE hidden in a string literal, because that is dynamic SQL", () => {
    expect(labels("execute 'drop table job_costs';")).toContain("DROP TABLE");
    expect(labels("execute format('drop table %I', t);")).toContain("DROP TABLE");
  });

  it("fails one inside a dollar-quoted function body too", () => {
    const sql = ["as $$", "begin", "  execute 'drop table x';", "end;", "$$;"].join("\n");
    expect(labels(sql)).toContain("DROP TABLE");
  });

  it("reads a mixed file correctly: comments ignored, real statements caught", () => {
    const sql = [
      "-- drop table commented_out;",
      "create table keep (id int);",
      "/* drop table also_commented; */",
      "alter table keep drop column gone;",
      "-- truncate nope;",
    ].join("\n");
    const hits = findDestructive(sql);
    expect(hits).toHaveLength(1);
    expect(hits[0].label).toBe("DROP COLUMN");
    expect(hits[0].line).toBe(4);
  });

  it("is case insensitive and tolerates odd whitespace", () => {
    expect(labels("DrOp    TaBlE x;")).toContain("DROP TABLE");
  });
});

describe("the runtime", () => {
  const run = (sql: string): { status: number; out: string } => {
    const dir = mkdtempSync(join(tmpdir(), "migration-safety-"));
    const file = join(dir, "00000000000099_x.sql");
    writeFileSync(file, sql);
    try {
      return {
        status: 0,
        out: execFileSync("npx", ["tsx", "scripts/ci/migration-safety.ts", file], {
          encoding: "utf8",
        }),
      };
    } catch (err) {
      const e = err as { status?: number; stdout?: string; stderr?: string };
      return { status: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
    }
  };

  it("exits zero on a documented rollback", () => {
    const r = run("create table t (id int);\n-- drop table t;");
    expect(r.status).toBe(0);
    expect(r.out).toContain("ok:");
  }, 60_000);

  it("exits non-zero on a real one, naming the line", () => {
    const r = run("create table t (id int);\ndrop table t;");
    expect(r.status).toBe(1);
    expect(r.out).toContain("line=2");
    expect(r.out).toContain("DROP TABLE");
  }, 60_000);

  it("says nothing to check when given no files", () => {
    const out = execFileSync("npx", ["tsx", "scripts/ci/migration-safety.ts"], {
      encoding: "utf8",
    });
    expect(out).toContain("No migrations to check.");
  }, 60_000);
});

// The twice-hit blind spot: logic that composes while the artefact the workflow
// calls is not reachable by the exact call it makes.
describe("the runtime plumbing", () => {
  const ci = readFileSync(".github/workflows/ci.yml", "utf8");

  it("CI calls this script rather than grepping the raw file", () => {
    expect(ci).toContain("npx tsx scripts/ci/migration-safety.ts");
    expect(ci).not.toMatch(/grep -Eiq 'DROP \(TABLE\|COLUMN\|SCHEMA\)/);
  });

  it("the migration-check job installs what the call needs", () => {
    const job = ci.slice(ci.indexOf("migration-check:"), ci.indexOf("schema-drift-probe:"));
    expect(job).toContain("npm ci");
    expect(job).toContain("actions/setup-node");
  });
});
