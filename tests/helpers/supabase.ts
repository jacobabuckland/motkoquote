import { vi } from "vitest";

interface FilterRecord {
  method: string;
  args: unknown[];
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
 * Records selected columns and every filter so a test can assert the query as
 * well as the result.
 *
 * @param rows - The rows to return from queries
 * @returns An object with the mocked client, select spy, from spy, and getFilters function
 */
export function mockSupabaseClient<T = unknown>(rows: T[]) {
  const select = vi.fn((_columns?: string) => {
    const builder = new MockQueryBuilder(rows);
    // Store the builder's getFilters on the select spy so getFilters() can reach it
    (select as unknown as { _lastBuilder?: MockQueryBuilder<T> })._lastBuilder =
      builder;
    return builder;
  });

  const from = vi.fn((_table?: string) => {
    return { select };
  });

  const getFilters = () => {
    const lastBuilder = (
      select as unknown as { _lastBuilder?: MockQueryBuilder<T> }
    )._lastBuilder;
    return lastBuilder ? lastBuilder.getFilters() : [];
  };

  const client = { from } as unknown as {
    from: typeof from;
  };

  return { client, select, from, getFilters };
}
