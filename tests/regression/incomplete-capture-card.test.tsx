/**
 * @vitest-environment happy-dom
 */

// The incomplete-capture card stopped asserting a cause it has no evidence for.
//
// Reported 12 Sep, against a real job that showed two stacked amber cards:
//
//   "Call ended before who supplies the materials, what's been agreed on cost,
//    the customer's name, contact details, the site address were captured"
//   "The quote was drafted without it — tap to review and fill it in."
//   "Call was cut short by a time or question limit"
//
// The slots weren't missed because the call ended early. They were missed
// because Motko never asked. Every source feeding `unasked_required` tests
// ANSWEREDNESS, not asked-ness — `wrapIncompleteSlotsRef` says so in its own
// comment, and getMissingCustomerDetails/missingSiteAddress are plain absence
// checks — so no cause may be claimed until N2.1 can tell the two apart.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { IncompleteCaptureCard } from "@/app/jobs/[id]/incomplete-capture-card";
import { describeUnaskedSlot } from "@/lib/schemas/sow";

afterEach(cleanup);

const FIVE = [
  "materials_supply",
  "agreed_costs",
  "customer_name",
  "customer_contact",
  "site_address",
];

describe("it states the fact and claims no cause", () => {
  it("never tells the trade the call ended early", () => {
    render(<IncompleteCaptureCard unaskedRequired={FIVE} capEnded={false} href="#quote" />);

    expect(screen.queryByText(/call ended before/i)).toBeNull();
    expect(screen.queryByText(/didn't ask|did not ask/i)).toBeNull();
    expect(screen.queryByText(/hung up|cut short/i)).toBeNull();
  });

  it("leads with how many are missing", () => {
    render(<IncompleteCaptureCard unaskedRequired={FIVE} capEnded={false} href="#quote" />);
    expect(screen.getByText("5 details are missing from this quote")).toBeDefined();
  });

  it("says it in the singular for one", () => {
    render(
      <IncompleteCaptureCard unaskedRequired={["customer_name"]} capEnded={false} href="#quote" />,
    );

    expect(screen.getByText("1 detail is missing from this quote")).toBeDefined();
    expect(screen.getByText(/fill it in/)).toBeDefined();
  });

  it("says 'them' for more than one, which the old body never did", () => {
    render(<IncompleteCaptureCard unaskedRequired={FIVE} capEnded={false} href="#quote" />);
    expect(screen.getByText(/fill them in/)).toBeDefined();
    expect(screen.queryByText(/drafted without it/)).toBeNull();
  });
});

describe("the slots are a list, not a sentence", () => {
  it("gives every missing slot its own list item", () => {
    render(<IncompleteCaptureCard unaskedRequired={FIVE} capEnded={false} href="#quote" />);

    const items = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toEqual([
      "who supplies the materials",
      "what's been agreed on cost",
      "the customer's name",
      "contact details",
      "the site address",
    ]);
  });

  it("shows an unlabelled id rather than dropping it", () => {
    // A SoW written before a label existed still names something real.
    render(
      <IncompleteCaptureCard unaskedRequired={["future_slot"]} capEnded={false} href="#quote" />,
    );
    expect(screen.getAllByRole("listitem")[0]?.textContent).toBe("future_slot");
    expect(describeUnaskedSlot("future_slot")).toBe("future_slot");
  });
});

describe("one incident, one card", () => {
  it("folds the cap into the gaps card rather than stacking a second alarm", () => {
    render(<IncompleteCaptureCard unaskedRequired={FIVE} capEnded href="#quote" />);

    // One heading, not two.
    expect(screen.getByText("5 details are missing from this quote")).toBeDefined();
    expect(screen.queryByText("The call reached its limit")).toBeNull();
    expect(screen.getByText(/ended on its time or question limit/)).toBeDefined();
  });

  it("still shows the cap on its own, because the two are independently true", () => {
    // A call can hit its cap having answered everything: the wrap detour ran
    // and landed every slot. That is a real fact and the only evidence-backed
    // flag of the two, so it keeps its own card — softened, since nothing is
    // actually missing.
    render(<IncompleteCaptureCard unaskedRequired={[]} capEnded href="#quote" />);

    expect(screen.getByText("The call reached its limit")).toBeDefined();
    expect(screen.queryByText(/details are missing/)).toBeNull();
    expect(screen.queryByRole("listitem")).toBeNull();
  });

  it("renders nothing at all when the call went cleanly", () => {
    const { container } = render(
      <IncompleteCaptureCard unaskedRequired={[]} capEnded={false} href="#quote" />,
    );
    expect(container.innerHTML).toBe("");
  });
});

describe("it is still a way through to the fix", () => {
  it("links to the quote editor", () => {
    render(<IncompleteCaptureCard unaskedRequired={FIVE} capEnded={false} href="#quote" />);
    expect(screen.getByRole("link").getAttribute("href")).toBe("#quote");
  });

  it("reads its heading in amber-ink, not amber", () => {
    // docs/design-rules.md: --amber is 4.18:1 on --amber-tint and fails AA for
    // body text; --amber-ink is 5.91:1. The old card used the mark colour for
    // text it expected to be read.
    render(<IncompleteCaptureCard unaskedRequired={FIVE} capEnded={false} href="#quote" />);
    const heading = screen.getByText("5 details are missing from this quote");
    expect(heading.className).toContain("text-amber-ink");
    expect(heading.className).not.toContain("text-warning");
  });
});
