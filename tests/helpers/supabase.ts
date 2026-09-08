import type { SupabaseClient } from "@supabase/supabase-js";
import { vi } from "vitest";

interface FilterRecord {
  method: string;
  args: unknown[];
}

interface WriteRecord {
  method: "insert" | "update" | "upsert" | "delete";
  table: string | undefined;
  payload: unknown;
}

interface QueryResult<T> {
  data: T | null;
  error: null;
}

// A PostgREST-shaped query builder that records every filter and is awaitable.
// Every filter method returns the builder, so .eq().eq().eq() chains without
// dying — the trap that killed #639 and #640.
class MockQueryBuilder<T> {
  private filters: FilterRecord[] = [];
  private rows: T[];

  constructor(rows: T[]) {
    this.rows = rows;
  }

  // Filter methods — each returns `this` for chaining
  eq(column: string, value: unknown): this {
    this.filters.push({ method: "eq", args: [column, value] });
    return this;
  }

  neq(column: string, value: unknown): this {
    this.filters.push({ method: "neq", args: [column, value] });
    return this;
  }

  gt(column: string, value: unknown): this {
    this.filters.push({ method: "gt", args: [column, value] });
    return this;
  }

  gte(column: string, value: unknown): this {
    this.filters.push({ method: "gte", args: [column, value] });
    return this;
  }

  lt(column: string, value: unknown): this {
    this.filters.push({ method: "lt", args: [column, value] });
    return this;
  }

  lte(column: string, value: unknown): this {
    this.filters.push({ method: "lte", args: [column, value] });
    return this;
  }

  like(column: string, pattern: string): this {
    this.filters.push({ method: "like", args: [column, pattern] });
    return this;
  }

  ilike(column: string, pattern: string): this {
    this.filters.push({ method: "ilike", args: [column, pattern] });
    return this;
  }

  is(column: string, value: unknown): this {
    this.filters.push({ method: "is", args: [column, value] });
    return this;
  }

  in(column: string, values: unknown[]): this {
    this.filters.push({ method: "in", args: [column, values] });
    return this;
  }

  not(column: string, operator: string, value: unknown): this {
    this.filters.push({ method: "not", args: [column, operator, value] });
    return this;
  }

  or(query: string): this {
    this.filters.push({ method: "or", args: [query] });
    return this;
  }

  order(column: string, options?: { ascending?: boolean }): this {
    this.filters.push({ method: "order", args: [column, options] });
    return this;
  }

  limit(count: number): this {
    this.filters.push({ method: "limit", args: [count] });
    return this;
  }

  range(from: number, to: number): this {
    this.filters.push({ method: "range", args: [from, to] });
    return this;
  }

  single(): Promise<QueryResult<T>> {
    this.filters.push({ method: "single", args: [] });
    return Promise.resolve({
      data: (this.rows[0] as T) ?? null,
      error: null,
    });
  }

  maybeSingle(): Promise<QueryResult<T>> {
    this.filters.push({ method: "maybeSingle", args: [] });
    return Promise.resolve({
      data: (this.rows[0] as T) ?? null,
      error: null,
    });
  }

  // A write path ends in `.select()` when the caller wants the affected rows
  // back — `.update({…}).eq(…).select().maybeSingle()` is the shape of an
  // atomic claim. Recorded like any other link so the query can be asserted.
  select(columns?: string): this {
    this.filters.push({ method: "select", args: [columns] });
    return this;
  }

  getFilters(): FilterRecord[] {
    return [...this.filters];
  }

  // Make the builder awaitable — returning the full result set
  then<TResult1 = QueryResult<T[]>, TResult2 = never>(
    onfulfilled?:
      | ((value: QueryResult<T[]>) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve({
      data: this.rows,
      error: null,
    } as QueryResult<T[]>).then(onfulfilled, onrejected);
  }
}

/**
 * Mock a Supabase client for testing. Returns a PostgREST-shaped query builder
 * where every filter returns the builder (chainable), the builder is awaitable,
 * and the caller supplies the rows to return.
 *
 * Records the selected columns, every filter, and every write payload, so a test
 * can assert the query the code *built* rather than only the rows it got back.
 * That distinction matters: where the stub supplies the data, asserting on the
 * data proves nothing — it is what you handed over. Assert `getFilters()`.
 *
 * `client` is cast to `SupabaseClient` so it can be passed straight to a function
 * that takes one. Returning it untyped forced every call site to add its own
 * cast, and a test that omitted one failed `tsc` after being frozen (#659).
 *
 * @param rows - The rows to return from queries
 * @returns The client alongside the spies and recorders, so nothing is hidden
 *   behind the cast
 */
export function mockSupabaseClient<T = unknown>(rows: T[]) {
  const builders: MockQueryBuilder<T>[] = [];
  let lastTable: string | undefined;
  const writes: WriteRecord[] = [];

  const build = () => {
    const builder = new MockQueryBuilder(rows);
    builders.push(builder);
    return builder;
  };

  const record = (method: WriteRecord["method"], payload?: unknown) => {
    writes.push({ method, table: lastTable, payload });
    return build();
  };

  const select = vi.fn((_columns?: string) => build());
  const insert = vi.fn((_payload?: unknown) => record("insert", _payload));
  const update = vi.fn((_payload?: unknown) => record("update", _payload));
  const upsert = vi.fn((_payload?: unknown) => record("upsert", _payload));
  const remove = vi.fn(() => record("delete"));

  const from = vi.fn((_table?: string) => {
    lastTable = _table;
    return { select, insert, update, upsert, delete: remove };
  });

  // Every filter the code built, across EVERY query — not just the last one.
  //
  // A real flow is rarely one query. Claiming a referral credit reads the
  // unconsumed row and then claims it by id; a guard reads the contractor and
  // then reads the projection. Returning only the last builder's filters made
  // the first query unassertable, so a criterion about *which* rows the code
  // asked for could not be checked at all — #660's frozen atomicity test
  // asserted the `contractor_id` filter and saw only the claim-by-id that
  // followed it.
  //
  // A single-query test is unaffected: one builder flat-maps to exactly its own
  // chain, which is what `tests/acceptance/647.test.ts` and the exact-list
  // assertions below already pin.
  const getFilters = () => builders.flatMap((builder) => builder.getFilters());
  const getWrites = () => [...writes];

  // The stub implements the handful of methods the code under test touches, not
  // the hundred the type declares, so the cast is load-bearing. Everything it
  // hides is returned alongside it.
  const client = { from } as unknown as SupabaseClient;

  return {
    client,
    select,
    insert,
    update,
    upsert,
    delete: remove,
    from,
    getFilters,
    getWrites,
  };
}
