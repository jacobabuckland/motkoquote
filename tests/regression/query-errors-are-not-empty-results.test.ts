import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// #387 named `quotes.sent_total` in two selects while the migration adding it
// had never been applied to production. PostgREST rejected both, and because
// both call sites destructured only `data`, the rejection was dropped:
//
//   - the job page fell into its no-quote branch and rendered "Your quote is on
//     its way — refresh in a moment" beside a "Quote ready" badge;
//   - the public quote page called notFound(), 404ing every customer quote link
//     that had already been sent.
//
// Nothing logged, nothing threw, no stack trace. The outage was found by a
// contractor reporting a screen that looked calm and said the wrong thing.
//
// These tests pin the distinction that was lost: an error is a failure, and an
// empty result is an answer.

const logError = vi.fn(async () => {});
vi.mock("@/lib/analytics", () => ({
  logError,
  track: vi.fn(async () => {}),
}));

const NOT_FOUND = "NEXT_NOT_FOUND";
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error(NOT_FOUND);
  },
}));

/**
 * Enough of the PostgREST builder for `.from().select().eq().maybeSingle()`.
 * Every method returns the same thenable, so the chain resolves to `result`
 * whatever order the call site uses.
 */
type QueryResult = { data: unknown; error: unknown };

/**
 * The client object must NOT itself be thenable — `await createClient()` on a
 * thenable unwraps it to the query result, and the page then sees a client with
 * no `auth`. Only the per-query chain carries `then`.
 */
const stubClient = (byTable: QueryResult | Record<string, QueryResult>) => {
  const resultFor = (table: string): QueryResult =>
    "data" in byTable
      ? (byTable as QueryResult)
      : (byTable as Record<string, QueryResult>)[table] ?? { data: null, error: null };

  return {
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    from: (table: string) => {
      const result = resultFor(table);
      const chain: Record<string, unknown> = {};
      for (const method of ["select", "eq", "order", "limit", "update", "in"]) {
        chain[method] = () => chain;
      }
      chain.maybeSingle = async () => result;
      chain.single = async () => result;
      chain.then = (resolve: (value: unknown) => unknown) =>
        Promise.resolve(result).then(resolve);
      return chain;
    },
  };
};

beforeEach(() => {
  logError.mockClear();
});

afterEach(() => {
  vi.resetModules();
});

describe("throwIfQueryFailed", () => {
  it("does nothing when there is no error", async () => {
    const { throwIfQueryFailed } = await import("@/lib/query-error");
    await expect(throwIfQueryFailed(null, "Loading the quote")).resolves.toBeUndefined();
    expect(logError).not.toHaveBeenCalled();
  });

  it("throws when the query returned an error", async () => {
    const { throwIfQueryFailed } = await import("@/lib/query-error");
    await expect(
      throwIfQueryFailed({ message: "connection reset", code: "08006" }, "Loading the quote"),
    ).rejects.toThrow(/Loading the quote failed: connection reset/);
  });

  it("logs the failure as well as throwing, so it is visible without a browser", async () => {
    const { throwIfQueryFailed } = await import("@/lib/query-error");
    await expect(
      throwIfQueryFailed({ message: "connection reset", code: "08006" }, "Loading the quote"),
    ).rejects.toThrow();

    expect(logError).toHaveBeenCalledTimes(1);
    const [source, message, context] = logError.mock.calls[0] as unknown as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect(source).toBe("server");
    expect(message).toContain("Loading the quote");
    expect(context.message).toBe("connection reset");
    expect(context.code).toBe("08006");
  });

  it("names a missing column as a deploy-ordering fault, not a transient one", async () => {
    // This is the actual production message. Someone reading the log needs to
    // be told the answer is "apply the migration", not "retry" — that
    // distinction is what cost hours on 26 Aug.
    const { throwIfQueryFailed } = await import("@/lib/query-error");
    const failing = throwIfQueryFailed(
      {
        message: 'column quotes.sent_total does not exist',
        code: "42703",
      },
      "Loading the quote",
    );

    await expect(failing).rejects.toThrow(/migration/i);

    const [, , context] = logError.mock.calls[0] as unknown as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect(context.likely_schema_drift).toBe(true);
  });

  it("does not claim schema drift for an ordinary failure", async () => {
    const { throwIfQueryFailed } = await import("@/lib/query-error");
    await expect(
      throwIfQueryFailed({ message: "connection reset", code: "08006" }, "Loading the quote"),
    ).rejects.toThrow();

    const [, , context] = logError.mock.calls[0] as unknown as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect(context.likely_schema_drift).toBe(false);
  });
});

describe("the public quote page", () => {
  const loadPage = async (result: { data: unknown; error: unknown }) => {
    vi.resetModules();
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => stubClient(result),
    }));
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
    }));
    const mod = await import("@/app/q/[id]/page");

    return mod.default;
  };

  it("throws rather than 404ing when the query failed", async () => {
    // The behaviour that mattered: a quote that exists, told it does not,
    // on a link the customer had already been sent.
    const Page = await loadPage({
      data: null,
      error: { message: "column quotes.sent_total does not exist", code: "42703" },
    });

    await expect(
      Page({ params: Promise.resolve({ id: "q1" }) }),
    ).rejects.toThrow(/sent_total/);
  });

  it("still 404s when the link genuinely points at nothing", async () => {
    const Page = await loadPage({ data: null, error: null });

    await expect(
      Page({ params: Promise.resolve({ id: "nope" }) }),
    ).rejects.toThrow(NOT_FOUND);
  });
});

describe("the job page", () => {
  const job = {
    id: "j1",
    status: "drafted",
    transcript: null,
    extracted_json: null,
    sow_json: null,
    fee_amount_pennies: null,
    fee_status: null,
    fee_waived_reason: null,
    customer: { name: "A", contact: null },
    contractor: { vat_registered: false, free_jobs_remaining: 1, business_profile: null },
  };

  const loadPage = async (tables: Record<string, QueryResult>) => {
    vi.resetModules();
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => stubClient(tables),
    }));
    const mod = await import("@/app/jobs/[id]/page");
    return mod.default;
  };

  const render = (Page: (props: never) => unknown) =>
    (Page as (props: {
      params: Promise<{ id: string }>;
      searchParams: Promise<Record<string, string>>;
    }) => Promise<unknown>)({
      params: Promise.resolve({ id: "j1" }),
      searchParams: Promise.resolve({}),
    });

  it("throws when the quote query failed, rather than saying the quote is on its way", async () => {
    // The screen the contractor actually reported: "Quote ready" beside "Your
    // quote is on its way — refresh in a moment", on a job whose quote existed.
    const Page = await loadPage({
      jobs: { data: job, error: null },
      quotes: {
        data: null,
        error: { message: "column quotes.sent_total does not exist", code: "42703" },
      },
    });

    await expect(render(Page as never)).rejects.toThrow(/sent_total/);
  });

  it("throws when the job query failed, rather than 404ing a job that exists", async () => {
    const Page = await loadPage({
      jobs: { data: null, error: { message: "connection reset", code: "08006" } },
      quotes: { data: null, error: null },
    });

    await expect(render(Page as never)).rejects.toThrow(/connection reset/);
  });

  it("still 404s when the job genuinely does not exist", async () => {
    const Page = await loadPage({
      jobs: { data: null, error: null },
      quotes: { data: null, error: null },
    });

    await expect(render(Page as never)).rejects.toThrow(NOT_FOUND);
  });
});
