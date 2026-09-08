/**
 * @vitest-environment happy-dom
 */

/**
 * The page a customer accepts on must state the work, not only the price.
 *
 * `/q/[id]` selected `line_items_json` and never `sow_json`, and rendered a
 * heading, a priced table, a total and an Accept button. Nothing on it said
 * what the work was. In fixed-price mode that is a single line reading
 * "<trade> works as described" over one figure — described nowhere the customer
 * can reach.
 *
 * The quote PDF has carried the scope for some time, but a PDF the customer may
 * never open is not the artefact the acceptance binds to. The button is on the
 * page. So a customer who accepted had accepted a number, not an agreement.
 *
 * Option (iii) of the plan's §6, and the reason it beat attaching the statement
 * of work: the defect is not that the customer lacks a second document, it is
 * that the thing they accepted does not state the work.
 *
 * `buildQuoteScope` is the source, deliberately — its own header calls it "the
 * list of things a customer is allowed to read", a narrowed projection that
 * keeps the SOW's contractor-only channels (next_question, unasked_required,
 * wrap_incomplete) off a customer surface by construction rather than by
 * remembering. This renders that projection and nothing else, so the page and
 * the PDF cannot state different scope.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { QuoteScopeSection } from "@/components/customer/quote-scope-section";
import { buildQuoteScope } from "@/lib/pdf/quote-payload";
import { EMPTY_SOW_STATE, type SowState } from "@/lib/schemas/sow";

afterEach(cleanup);

const sow = (overrides: Partial<SowState>): SowState => ({ ...EMPTY_SOW_STATE, ...overrides });

const renderScope = (state: SowState) => {
  const scope = buildQuoteScope(state, []);
  if (!scope) throw new Error("expected a scope for this fixture");
  render(<QuoteScopeSection scope={scope} />);
  return scope;
};

describe("the customer is shown the work before the price", () => {
  it("states the rooms and what happens in each", () => {
    renderScope(
      sow({
        rooms: [
          { name: "Kitchen", dimensions: "4m x 3m", work_items: ["Replace six sockets"] },
          { name: "Landing", dimensions: undefined, work_items: ["Two-way switch"] },
        ],
      }),
    );

    expect(screen.getByText(/Kitchen/)).toBeDefined();
    expect(screen.getByText(/4m x 3m/)).toBeDefined();
    expect(screen.getByText("Replace six sockets")).toBeDefined();
    expect(screen.getByText("Two-way switch")).toBeDefined();
  });

  it("states work that applies throughout once, not once per room", () => {
    // P1-5's lift, arriving on the customer's page. Without it this sentence
    // would appear three times on the document being accepted.
    renderScope(
      sow({
        rooms: ["Bed 1", "Bed 2", "Bed 3"].map((name) => ({
          name,
          dimensions: undefined,
          work_items: ["Make good and dust sheets"],
        })),
      }),
    );

    expect(screen.getAllByText("Make good and dust sheets")).toHaveLength(1);
  });

  it("states what is NOT included, which is what a dispute turns on", () => {
    renderScope(
      sow({
        rooms: [{ name: "Kitchen", dimensions: undefined, work_items: ["Rewire"] }],
        inclusions: ["Making good the chases"],
        exclusions: ["Redecoration", "Plastering"],
      }),
    );

    expect(screen.getByText("Redecoration")).toBeDefined();
    expect(screen.getByText("Plastering")).toBeDefined();
    expect(screen.getByText("Making good the chases")).toBeDefined();
  });

  it("states the assumptions the price was built on", () => {
    renderScope(
      sow({
        rooms: [{ name: "Kitchen", dimensions: undefined, work_items: ["Rewire"] }],
        assumptions_and_unknowns: [
          { description: "Board thickness assumed standard 18mm", treatment: "assumed_ok" },
        ],
      }),
    );

    expect(screen.getByText("Board thickness assumed standard 18mm")).toBeDefined();
  });

  it("omits a section the job captured nothing for, rather than heading an empty one", () => {
    renderScope(
      sow({ rooms: [{ name: "Kitchen", dimensions: undefined, work_items: ["Rewire"] }] }),
    );

    expect(screen.queryByText("Not included")).toBeNull();
    expect(screen.queryByText("Throughout")).toBeNull();
  });
});

describe("what the customer must never be shown", () => {
  it("carries none of the SOW's contractor-only channels", () => {
    // buildQuoteScope makes this structural — there is no field on QuoteScope
    // for any of them — and this asserts the structure holds end to end.
    const scope = renderScope(
      sow({
        rooms: [{ name: "Kitchen", dimensions: undefined, work_items: ["Rewire"] }],
        next_question: "Ask how many people are on site",
        wrap_incomplete: true,
        unasked_required: ["crew", "customer_name"],
      }),
    );

    expect(Object.keys(scope)).not.toContain("nextQuestion");
    expect(document.body.textContent).not.toContain("Ask how many people are on site");
    expect(document.body.textContent).not.toContain("customer_name");
  });
});
