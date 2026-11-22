import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

// An in-memory, table-aware stand-in for the Supabase client, for the PA tests.
//
// tests/helpers/supabase.ts hands back the SAME rows for every query, which is
// right for asserting how one query was built and useless for a flow that reads
// five tables and must not leak across contractors. This one actually filters
// (eq, neq, is, in, gt, lt), orders, limits, inserts and updates, so
// "contractor B cannot see contractor A's row" and "the second claim matches
// nothing" are real behaviours rather than assertions about a stub.
//
// It does NOT model RLS; the tests prove the code-level scoping, and the
// migration's policies are checked separately.

export type Row = Record<string, unknown>;
type Filter = { op: string; column: string; value: unknown };

export type FakeDb = {
  client: SupabaseClient;
  tables: Record<string, Row[]>;
  // Every filter of every query, in order, for "the query was scoped" assertions.
  queries: { table: string; method: string; filters: Filter[] }[];
};

class Builder implements PromiseLike<{ data: unknown; error: null }> {
  private filters: Filter[] = [];
  private payload: Row | Row[] | null = null;
  private method: "select" | "insert" | "update" | "delete" = "select";
  private orderBy: { column: string; ascending: boolean } | null = null;
  private max: number | null = null;
  private single: "single" | "maybe" | null = null;
  private returning = false;

  constructor(
    private readonly db: FakeDb,
    private readonly table: string,
  ) {}

  select(_columns?: string): this {
    if (this.method !== "select") this.returning = true;
    return this;
  }
  insert(payload: Row | Row[]): this {
    this.method = "insert";
    this.payload = payload;
    return this;
  }
  update(payload: Row): this {
    this.method = "update";
    this.payload = payload;
    return this;
  }
  delete(): this {
    this.method = "delete";
    return this;
  }
  eq(column: string, value: unknown): this {
    this.filters.push({ op: "eq", column, value });
    return this;
  }
  neq(column: string, value: unknown): this {
    this.filters.push({ op: "neq", column, value });
    return this;
  }
  is(column: string, value: unknown): this {
    this.filters.push({ op: "is", column, value });
    return this;
  }
  in(column: string, value: unknown[]): this {
    this.filters.push({ op: "in", column, value });
    return this;
  }
  gt(column: string, value: unknown): this {
    this.filters.push({ op: "gt", column, value });
    return this;
  }
  lt(column: string, value: unknown): this {
    this.filters.push({ op: "lt", column, value });
    return this;
  }
  order(column: string, options?: { ascending?: boolean }): this {
    this.orderBy = { column, ascending: options?.ascending ?? true };
    return this;
  }
  limit(count: number): this {
    this.max = count;
    return this;
  }
  maybeSingle(): this {
    this.single = "maybe";
    return this;
  }
  // Mirrors PostgREST: .single() errors unless exactly one row matches.
  singleRow(): this {
    this.single = "single";
    return this;
  }

  private matches(row: Row): boolean {
    return this.filters.every((filter) => {
      const actual = row[filter.column];
      switch (filter.op) {
        case "eq":
          return actual === filter.value;
        case "neq":
          return actual !== filter.value;
        case "is":
          return (actual ?? null) === filter.value;
        case "in":
          return (filter.value as unknown[]).includes(actual);
        case "gt":
          return actual != null && String(actual) > String(filter.value);
        case "lt":
          return actual != null && String(actual) < String(filter.value);
        default:
          return false;
      }
    });
  }

  private run(): { data: unknown; error: { message: string } | null } {
    const rows = (this.db.tables[this.table] ??= []);
    this.db.queries.push({ table: this.table, method: this.method, filters: [...this.filters] });
    let result: Row[] = [];

    if (this.method === "insert") {
      const incoming = Array.isArray(this.payload) ? this.payload : [this.payload as Row];
      for (const item of incoming) {
        const row = { id: randomUUID(), ...item };
        rows.push(row);
        result.push(row);
      }
    } else if (this.method === "update") {
      for (const row of rows) {
        if (this.matches(row)) {
          Object.assign(row, this.payload);
          result.push(row);
        }
      }
    } else if (this.method === "delete") {
      for (const row of [...rows]) {
        if (this.matches(row)) {
          rows.splice(rows.indexOf(row), 1);
          result.push(row);
        }
      }
    } else {
      result = rows.filter((row) => this.matches(row));
    }

    if (this.orderBy) {
      const { column, ascending } = this.orderBy;
      result = [...result].sort((a, b) => {
        const left = String(a[column] ?? "");
        const right = String(b[column] ?? "");
        return ascending ? left.localeCompare(right) : right.localeCompare(left);
      });
    }
    if (this.max !== null) result = result.slice(0, this.max);

    const wantsRows = this.method === "select" || this.returning;
    if (!wantsRows) return { data: null, error: null };
    if (this.single === "maybe") return { data: result[0] ?? null, error: null };
    if (this.single === "single") {
      return result.length === 1
        ? { data: result[0], error: null }
        : { data: null, error: { message: "expected one row" } };
    }
    return { data: result, error: null };
  }

  then<R1 = { data: unknown; error: null }, R2 = never>(
    onfulfilled?: ((value: { data: unknown; error: null }) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return Promise.resolve(this.run() as { data: unknown; error: null }).then(
      onfulfilled,
      onrejected,
    );
  }
}

export const createFakeDb = (seed: Record<string, Row[]> = {}): FakeDb => {
  const db: FakeDb = {
    client: undefined as unknown as SupabaseClient,
    tables: Object.fromEntries(
      Object.entries(seed).map(([table, rows]) => [table, rows.map((row) => ({ ...row }))]),
    ),
    queries: [],
  };
  const make = (table: string) => {
    const builder = new Builder(db, table);
    // supabase-js: `.single()` is the strict one, `.maybeSingle()` the lenient.
    (builder as unknown as { single: () => Builder }).single = () => builder.singleRow();
    return builder;
  };
  db.client = { from: make } as unknown as SupabaseClient;
  return db;
};
