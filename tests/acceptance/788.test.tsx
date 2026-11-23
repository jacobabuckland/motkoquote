/**
 * @vitest-environment happy-dom
 */

/**
 * KNOW-1: The knowledge layer suggests; it never applies.
 *
 * Learned tendencies stop entering the drafting prompt as instructions and
 * become contractor-facing suggestions in the quote editor, each with a one-tap
 * accept. Nothing a tendency proposes reaches a customer document unless the
 * contractor puts it there. (Jacob, 16 Sep — "suggest, never apply".)
 *
 * ONE environment directive governs the whole file and it must be the first
 * docblock, so the node-shaped tests below run under happy-dom too. That is
 * deliberate: the alternative is two files for one contract.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { Tendency } from "@/lib/quote-learning";
import type { LineItem } from "@/lib/schemas/job";
import type { JobExtraction } from "@/lib/schemas/job";

// What the model was actually asked. The contractor object is serialised
// wholesale into the user message (claude.ts — `JSON.stringify({ job, contractor })`),
// so capturing the request is how we see what reached the model.
type CapturedRequest = { system: string; userContent: string };

// vi.hoisted, NOT a plain top-level const. A vi.mock factory is hoisted above
// the file body, so a factory closing over an ordinary `const` hits the
// temporal dead zone the first time the mock runs — and the ReferenceError
// surfaces as an empty capture list rather than as itself.
const { captured } = vi.hoisted(() => ({ captured: [] as CapturedRequest[] }));

// Every parameter is declared OPTIONAL. A zero-argument `vi.fn(async () => …)`
// is TS2554 the moment the code under test calls it with an argument, and a
// required parameter is TS2554 when a test calls it with none — both are
// invisible to vitest and fatal to a frozen file.
vi.mock("@anthropic-ai/sdk", () => {
  class FakeAnthropic {
    messages = {
      create: async (body?: {
        system?: string;
        messages?: { role: string; content: string }[];
      }) => {
        captured.push({
          system: body?.system ?? "",
          userContent: body?.messages?.[0]?.content ?? "",
        });
        // A parseable draft with one real line. The draft schema is a union
        // discriminated on `kind` (not `category`, which is the shape of a
        // COMPILED line), and an empty `line_items` fails it outright — a test
        // that depends on the call throwing asserts the parser's behaviour
        // rather than the drafter's.
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                line_items: [
                  {
                    kind: "provisional",
                    description: "Strip out and refit",
                    suggested_amount_pence: 30000,
                    reason: "Scope confirmed on the call",
                  },
                ],
                contractor_flags: [],
              }),
            },
          ],
        };
      },
    };
  }
  return { default: FakeAnthropic };
});

// The editor's only outward edges. Neither is under test.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/app/jobs/actions", () => ({
  updateQuoteLineItems: vi.fn(),
  sendQuote: vi.fn(),
  redraftJob: vi.fn(),
  reportEmptyQuoteDraft: vi.fn(),
  setQuotePricingMode: vi.fn(),
}));

afterEach(cleanup);
beforeEach(() => {
  captured.length = 0;
});

// ---------------------------------------------------------------------------
// Fixtures. Each literal satisfies its real type IN FULL — a partial object
// runs green under vitest and fails only `tsc`, by which point the file is
// frozen.
// ---------------------------------------------------------------------------

const extraction: JobExtraction = {
  job_type: "Bathroom refit",
  scope_items: ["Strip out existing suite", "Tile walls and floor"],
  additional_items: [],
  materials_mentioned: ["Tiles", "Adhesive"],
  // The nullish fields transform null -> undefined, so their OUTPUT type is
  // `string | undefined` and writing `null` here is TS2322. Omitted rather
  // than nulled: absent is what "not captured" actually looks like.
  crew_description: "just me",
};

const contractor = {
  trade: "plumber",
  day_rate: 30000,
  overtime_rate: 4000,
  callout_min: 8000,
  travel_rate: 5000,
  markup_pct: 20,
  team_members: [],
};

// A stored edit, in full. `summarizeTendencies` takes a Pick<> of LineItemEdit,
// so these six fields are the whole shape it sees.
const modifiedEdit = (drafted: number, final: number) => ({
  description: "Tiles and adhesive",
  normalized_description: "tiles and adhesive",
  category: "material",
  edit_type: "modified" as const,
  drafted_unit_price: drafted,
  final_unit_price: final,
});

const addedEdit = () => ({
  description: "Waste removal",
  normalized_description: "waste removal",
  category: "other",
  edit_type: "added" as const,
  drafted_unit_price: null,
  final_unit_price: 8000,
});

const tiledWall: LineItem = {
  description: "Tiles and adhesive",
  category: "materials",
  quantity: 1,
  unit: "job",
  // The editor's "Cost (£)" input binds `unit_price` directly, so this is
  // pounds and renders as the string "400".
  unit_price: 400,
  multiplier: 1,
  people_count: 1,
  overtime: false,
  assumed: false,
};

// ---------------------------------------------------------------------------
// Criterion 1 — the tendencies do not reach the model
// ---------------------------------------------------------------------------

// `tests/setup.ts` replaces `draftQuoteLineItems` with a stub for the whole
// suite, so importing it normally reaches a mock that never calls a model and
// no implementation could ever satisfy an assertion about the request. Unmock
// it, reset the module registry, THEN import — order is the whole thing.
const realDrafter = async () => {
  vi.doUnmock("@/lib/claude");
  vi.resetModules();
  const mod = await import("@/lib/claude");
  return mod.draftQuoteLineItems;
};

describe("what the drafter asks the model", () => {
  it("sends no tendency prose, even when a caller still supplies one", async () => {
    const draftQuoteLineItems = await realDrafter();

    // Spread into a variable first. A fresh object literal passed straight to
    // the parameter would be an excess-property error once the field is gone,
    // which would make this test unsatisfiable by the implementation it exists
    // to demand. Through a variable it typechecks before AND after.
    const tendencySentence =
      'Across 3 past quotes, this contractor typically prices "material" line items about 20% higher than the initial estimate — adjust accordingly.';
    const withTendencies = {
      ...contractor,
      contractor_tendencies: [tendencySentence],
    };

    await draftQuoteLineItems(extraction, withTendencies, []);

    expect(captured).toHaveLength(1);
    expect(captured[0].userContent).not.toContain(tendencySentence);
    expect(captured[0].userContent).not.toContain("contractor_tendencies");
  });

  it("no longer tells the model to apply tendencies proactively", async () => {
    const draftQuoteLineItems = await realDrafter();

    await draftQuoteLineItems(extraction, contractor, []);

    expect(captured).toHaveLength(1);
    // The system prompt is a runtime value sent over the wire, not source text.
    expect(captured[0].system).not.toMatch(/apply them proactively/i);
    expect(captured[0].system).not.toMatch(/contractor_tendencies/);
  });

  it("asks the same thing with tendencies recorded as without", async () => {
    const draftQuoteLineItems = await realDrafter();

    const withTendencies = {
      ...contractor,
      contractor_tendencies: ["anything at all"],
    };

    await draftQuoteLineItems(extraction, withTendencies, []);
    await draftQuoteLineItems(extraction, contractor, []);

    expect(captured).toHaveLength(2);
    expect(captured[0].userContent).toBe(captured[1].userContent);
    expect(captured[0].system).toBe(captured[1].system);
  });
});

// ---------------------------------------------------------------------------
// Criteria 2-5 — structure, not prose; and three samples, not two
// ---------------------------------------------------------------------------

describe("what the edit history computes", () => {
  it("returns records a UI can offer an accept against, not sentences", async () => {
    const { summarizeTendencies } = await import("@/lib/quote-learning");

    const tendencies: Tendency[] = summarizeTendencies([
      modifiedEdit(10000, 12000),
      modifiedEdit(10000, 12000),
      modifiedEdit(10000, 12000),
    ]);

    expect(tendencies).toHaveLength(1);
    expect(tendencies[0].kind).toBe("price");
    expect(tendencies[0].subject).toBe("material");
    expect(tendencies[0].sampleSize).toBe(3);
  });

  it("carries a SIGNED percentage saying which way the contractor moved it", async () => {
    const { summarizeTendencies } = await import("@/lib/quote-learning");

    const up: Tendency[] = summarizeTendencies([
      modifiedEdit(10000, 12000),
      modifiedEdit(10000, 12000),
      modifiedEdit(10000, 12000),
    ]);
    const down: Tendency[] = summarizeTendencies([
      modifiedEdit(10000, 8000),
      modifiedEdit(10000, 8000),
      modifiedEdit(10000, 8000),
    ]);

    // The sign is the whole point: a magnitude alone cannot tell a contractor
    // whether accepting would raise or lower what the customer is charged.
    expect(up[0].percentChange).toBeGreaterThan(0);
    expect(down[0].percentChange).toBeLessThan(0);
  });

  it("names the line and the count on a repeatedly added item", async () => {
    const { summarizeTendencies } = await import("@/lib/quote-learning");

    const tendencies: Tendency[] = summarizeTendencies([
      addedEdit(),
      addedEdit(),
      addedEdit(),
    ]);

    const add = tendencies.find((t) => t.kind === "add");
    expect(add).toBeDefined();
    expect(add?.subject).toBe("Waste removal");
    expect(add?.sampleSize).toBe(3);
    expect(add?.percentChange).toBeNull();
  });

  it("says nothing about a pattern seen only twice", async () => {
    const { summarizeTendencies } = await import("@/lib/quote-learning");

    // Two quotes is a coincidence. This is the threshold moving from 2 to 3,
    // so it fails today by returning one tendency rather than none.
    expect(summarizeTendencies([modifiedEdit(10000, 12000), modifiedEdit(10000, 12000)]))
      .toHaveLength(0);
    expect(summarizeTendencies([addedEdit(), addedEdit()])).toHaveLength(0);
  });

  it("reports nothing at all for a contractor who has never edited a quote", async () => {
    const { summarizeTendencies } = await import("@/lib/quote-learning");

    expect(summarizeTendencies([])).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Criteria 6-10 — the editor suggests, and only suggests
// ---------------------------------------------------------------------------

const priceTendency: Tendency = {
  kind: "price",
  subject: "materials",
  sampleSize: 3,
  percentChange: 20,
};

const addTendency: Tendency = {
  kind: "add",
  subject: "Waste removal",
  sampleSize: 3,
  percentChange: null,
};

const renderEditor = async (tendencies: Tendency[]) => {
  const { QuoteEditor } = await import("@/app/jobs/[id]/quote-editor");
  return render(
    <QuoteEditor
      jobId="job-1"
      quoteId="quote-1"
      jobTitle="Bathroom refit"
      initialLineItems={[tiledWall]}
      tendencies={tendencies}
      vatRegistered={false}
    />,
  );
};

describe("the quote editor's suggestions", () => {
  it("shows a suggestion naming the line and how many quotes it came from", async () => {
    await renderEditor([addTendency]);

    // What a contractor can perceive: the line's name and the count, on screen.
    // Read from the rendered document rather than with getByText, which throws
    // when a string matches more than one element — a correct implementation is
    // free to name the line twice, and an assertion that forbids that is an
    // assertion about layout.
    const shown = document.body.textContent ?? "";
    expect(shown).toContain("Waste removal");
    expect(shown).toContain("3");
  });

  it("gives every suggestion its own accept control", async () => {
    await renderEditor([priceTendency, addTendency]);

    // Two suggestions, two accepts — a tendency is applied deliberately or not
    // at all. This is the whole of "suggest, never apply" as a user sees it.
    const accepts = screen.getAllByRole("button", { name: /accept/i });
    expect(accepts).toHaveLength(2);
  });

  it("changes no figure until the contractor accepts", async () => {
    await renderEditor([priceTendency]);

    // The suggestion is on screen...
    expect(screen.getAllByRole("button", { name: /accept/i }).length).toBeGreaterThan(0);

    // ...and untouched, so the line the contractor sees is still the £400.00 it
    // was compiled at. If merely opening the editor moved it to £480.00, the
    // tendency would be applying itself — the entire defect this item ends.
    // Asserted on the money a contractor can read, not on an input's value:
    // the per-line inputs sit behind a disclosure and a collapsed control is
    // not what anyone perceives.
    expect(screen.getAllByText("£400.00").length).toBeGreaterThan(0);
    expect(screen.queryByText("£480.00")).toBeNull();
  });

  it("shows no panel at all for a contractor with nothing recorded", async () => {
    await renderEditor([]);

    expect(screen.queryByRole("button", { name: /accept/i })).toBeNull();
    expect(screen.queryAllByText(/Waste removal/)).toHaveLength(0);
  });

  it("keeps the suggestions out of the customer-facing quote", async () => {
    const { container } = await renderEditor([addTendency]);

    // The customer document is rendered from the line items alone. Whatever
    // the suggestions panel says, no preview of what the customer receives may
    // repeat it.
    const preview = container.querySelector("[data-customer-preview]");
    if (preview) {
      expect(within(preview as HTMLElement).queryAllByText(/Waste removal/)).toHaveLength(0);
    }
    // And a suggestion is never a line on the quote merely by being displayed:
    // the only line here is the one that was compiled.
    expect(screen.queryByDisplayValue("Waste removal")).toBeNull();
  });
});
