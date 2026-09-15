/**
 * #750 (JOBUI-2) moves the quote editor onto its own route, /jobs/[id]/quote.
 *
 * A route reachable by id has to authorise the ROW, not just authenticate the
 * user. The job page has always scoped its read with
 * `.eq("contractor_id", contractor.id)`; the first shape of this route did not,
 * and authenticated on `getUser()` alone. Any signed-in contractor could then
 * open /jobs/<someone-else's-id>/quote, read a stranger's line items, and
 * re-price them — the editor's server actions take the ids the page hands
 * them.
 *
 * So this file asserts the two halves separately, because they fail
 * separately: the FILTER the page builds, and what it does when the row does
 * not come back. Asserting only the second would pass against a page that
 * fetches every job and gets lucky with the fixture.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const NOT_FOUND = "NEXT_NOT_FOUND";

const CONTRACTOR_ID = "contractor-1";
const JOB_ID = "11111111-1111-4111-8111-111111111111";

type Filter = { table: string; method: string; args: unknown[] };

const h = vi.hoisted(() => {
  const state = {
    user: { id: "u-1" } as { id: string } | null,
    contractor: { id: "contractor-1", vat_registered: false } as Record<string, unknown> | null,
    /**
     * null models BOTH "not yours" and "doesn't exist". The predicate under
     * test is what makes those two cases indistinguishable, which is the
     * property we want: a probe must not be able to tell a stranger's job from
     * a nonexistent one.
     */
    job: null as Record<string, unknown> | null,
    quote: null as Record<string, unknown> | null,
    filters: [] as Filter[],
  };

  const client = {
    auth: { getUser: async () => ({ data: { user: state.user }, error: null }) },
    from: (table: string) => {
      const b = {
        select: () => b,
        eq: (col: string, val: unknown) => {
          state.filters.push({ table, method: "eq", args: [col, val] });
          return b;
        },
        maybeSingle: async () => {
          if (table === "contractors") return { data: state.contractor, error: null };
          if (table === "jobs") return { data: state.job, error: null };
          return { data: state.quote, error: null };
        },
      };
      return b;
    },
  };

  return { state, client };
});

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => h.client }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error(NOT_FOUND);
  },
}));

const renderPage = async () => {
  const { default: QuotePage } = await import("@/app/jobs/[id]/quote/page");
  return QuotePage({ params: Promise.resolve({ id: JOB_ID }) });
};

const jobFilters = () => h.state.filters.filter((f) => f.table === "jobs");

const ownedJob = {
  id: JOB_ID,
  transcript: null,
  sow_json: null,
  customer: { name: "A customer", contact: {} },
};

const ownedQuote = {
  id: "quote-1",
  line_items_json: [],
  contractor_flags_json: [],
  status: "draft",
  sent_total: null,
  total: 250,
  subtotal: 250,
  vat_amount: 0,
  deposit_pennies: null,
};

beforeEach(() => {
  h.state.user = { id: "u-1" };
  h.state.contractor = { id: CONTRACTOR_ID, vat_registered: false };
  h.state.job = null;
  h.state.quote = null;
  h.state.filters = [];
});

describe("the quote route authorises the row, not just the session", () => {
  it("scopes the job read to the signed-in contractor", async () => {
    h.state.job = ownedJob;
    h.state.quote = ownedQuote;

    await renderPage();

    // The FILTER, not the row the stub handed back. The stub returns whatever
    // it was constructed with, so asserting the rendered output would pass
    // with this predicate deleted — which is the entire hole.
    expect(jobFilters()).toContainEqual({
      table: "jobs",
      method: "eq",
      args: ["contractor_id", CONTRACTOR_ID],
    });
    expect(jobFilters()).toContainEqual({
      table: "jobs",
      method: "eq",
      args: ["id", JOB_ID],
    });
  });

  it("404s when the job is not this contractor's, indistinguishably from missing", async () => {
    h.state.job = null; // what the scoped read returns for someone else's job
    h.state.quote = ownedQuote;

    await expect(renderPage()).rejects.toThrow(NOT_FOUND);
  });

  it("404s when the contractor has no profile at all", async () => {
    h.state.contractor = null;
    h.state.job = ownedJob;
    h.state.quote = ownedQuote;

    await expect(renderPage()).rejects.toThrow(NOT_FOUND);
    // And it stopped before reading any job — an unprofiled session cannot
    // probe for jobs by id.
    expect(jobFilters()).toHaveLength(0);
  });

  it("404s when nobody is signed in", async () => {
    h.state.user = null;
    h.state.job = ownedJob;
    h.state.quote = ownedQuote;

    await expect(renderPage()).rejects.toThrow(NOT_FOUND);
  });
});

describe("the editor is handed the recorded figures, not left to recompute", () => {
  it("selects migration 80's split and the agreed deposit", async () => {
    // THE FIFTH VAT SURFACE. Every other surface reads the recorded split; an
    // editor that recomputes from today's registration flag puts two totals
    // for one quote on one screen — the job page's recorded £740 above the
    // editor's recomputed £888.
    h.state.job = ownedJob;
    h.state.quote = ownedQuote;

    const page = await renderPage();
    const json = JSON.stringify(page);

    expect(json).toContain("recordedQuote");
    expect(json).toContain("initialDepositPennies");
  });
});
