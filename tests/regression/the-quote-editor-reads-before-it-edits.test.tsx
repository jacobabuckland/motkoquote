/**
 * @vitest-environment happy-dom
 *
 * A quote is CHECKED before it is sent, and only sometimes edited.
 *
 * Six line items each showing four number inputs is a form to be survived. The
 * same six as readable rows — description, what the line is made of, the money
 * — is a quote you can scan. Editing is still there; it is just no longer the
 * default posture of the screen.
 *
 * The three things pinned here have each been a defect in their own right:
 * "Multiplier" as a label, the per-row "Assumed — Estimated…" sentence, and an
 * invisible pending-save state on a screen where a failed persist aborts the
 * send.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QuoteEditor } from "@/app/jobs/[id]/quote-editor";
import type { LineItem } from "@/lib/schemas/job";

afterEach(cleanup);

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const materials: LineItem = {
  description: "10-way RCBO consumer unit",
  category: "materials",
  quantity: 1,
  unit: "unit",
  unit_price: 180,
  multiplier: 1.5,
  people_count: 1,
  overtime: false,
  assumed: true,
  assumption_note: "Estimated material cost — confirm against supplier price",
};

const labour: LineItem = {
  description: "Consumer unit replacement — 2-day job",
  category: "labour",
  quantity: 2,
  unit: "day",
  unit_price: 300,
  multiplier: 1,
  people_count: 1,
  overtime: false,
  assumed: false,
};

const renderEditor = (items: LineItem[] = [labour, materials]) =>
  render(
    <QuoteEditor
      jobId="job_1"
      quoteId="quote_1"
      jobTitle="Consumer unit & sockets"
      initialLineItems={items}
      vatRegistered={false}
    />,
  );

const rowFor = (name: RegExp) =>
  screen.getAllByRole("button").find((b) => name.test(b.textContent ?? ""))!;

describe("rows read before they edit", () => {
  it("shows what a line is made of without opening it", () => {
    renderEditor();
    const row = rowFor(/Consumer unit replacement/);

    expect(row.textContent).toContain("2 day @ £300.00");
    expect(row.textContent).toContain("£600.00");
  });

  it("keeps the edit fields closed until the row is tapped", () => {
    renderEditor();
    expect(screen.queryByLabelText("Markup")).toBeNull();

    fireEvent.click(rowFor(/10-way RCBO/));
    expect(screen.getByLabelText("Markup")).toBeTruthy();
  });

  it("opens ONE row at a time", () => {
    // Two rows open is two forms, which is the thing being removed.
    renderEditor();

    fireEvent.click(rowFor(/10-way RCBO/));
    expect(screen.getAllByLabelText("Markup")).toHaveLength(1);

    fireEvent.click(rowFor(/Consumer unit replacement/));
    expect(screen.getAllByLabelText("Markup")).toHaveLength(1);
  });
});

describe("estimates are marked once, not once per row", () => {
  it("puts a chip on the estimated row and a single footnote under the group", () => {
    renderEditor();

    expect(rowFor(/10-way RCBO/).textContent).toContain("Est.");
    expect(rowFor(/Consumer unit replacement/).textContent).not.toContain("Est.");
    expect(
      screen.getAllByText(/Items marked Est\. are estimates/),
    ).toHaveLength(1);
  });

  it("never prints the contractor-facing assumption note on the row", () => {
    // It read "Assumed — Estimated material cost — confirm against supplier
    // price. Confirm before sending." on every materials line: the concept
    // twice, the instruction twice.
    renderEditor();

    // Scoped to the ROW. The group footnote deliberately ends "...confirm
    // against supplier price" — said once, for all estimated lines — so a
    // page-wide assertion on that phrase would contradict the thing this
    // change exists to produce.
    const row = rowFor(/10-way RCBO/);
    expect(row.textContent).not.toContain("confirm against supplier price");
    expect(row.textContent).not.toContain("Assumed");
    expect(row.textContent).not.toContain("Confirm before sending");
  });

  it("says nothing about estimates when no line is estimated", () => {
    renderEditor([labour]);
    expect(screen.queryByText(/Items marked Est\./)).toBeNull();
  });
});

describe("Markup is a label change and nothing more", () => {
  it("is labelled in trade terms, not developer terms", () => {
    renderEditor();
    fireEvent.click(rowFor(/10-way RCBO/));

    expect(screen.getByLabelText("Markup")).toBeTruthy();
    expect(screen.queryByLabelText("Multiplier")).toBeNull();
  });

  it("still holds the STORED multiplier, unconverted", () => {
    // The load-bearing assertion of this file. Expressing the field as a true
    // percentage would change what is persisted and needs a migration; this
    // change is cosmetic, so 1.5 must still be 1.5 in the box.
    renderEditor();
    fireEvent.click(rowFor(/10-way RCBO/));

    expect((screen.getByLabelText("Markup") as HTMLInputElement).value).toBe("1.5");
  });

  it("says what the number means in the only terms that matter", () => {
    renderEditor();
    fireEvent.click(rowFor(/10-way RCBO/));

    expect(screen.getByText("1.5 = 50% on top of cost")).toBeTruthy();
  });

  it("stays quiet when there is no markup to explain", () => {
    renderEditor();
    fireEvent.click(rowFor(/Consumer unit replacement/));

    expect(screen.queryByText(/on top of cost/)).toBeNull();
  });
});

describe("the pending save is impossible to miss", () => {
  it("says nothing before anything is edited", () => {
    renderEditor();
    expect(screen.queryByText(/unsaved/)).toBeNull();
  });

  it("counts the rows that are outstanding", () => {
    // Auto-save was withdrawn because the guard that aborts a send on a failed
    // persist outranks the friction argument. This is the compensation: a
    // contractor cannot send stale prices believing they saved.
    renderEditor();
    fireEvent.click(rowFor(/10-way RCBO/));
    fireEvent.change(screen.getByLabelText("Cost (£)"), { target: { value: "200" } });

    expect(screen.getByText("1 unsaved change")).toBeTruthy();
  });

  it("pluralises on more than one", () => {
    renderEditor();

    fireEvent.click(rowFor(/10-way RCBO/));
    fireEvent.change(screen.getByLabelText("Cost (£)"), { target: { value: "200" } });
    fireEvent.click(rowFor(/Consumer unit replacement/));
    fireEvent.change(screen.getByLabelText("Cost (£)"), { target: { value: "350" } });

    expect(screen.getByText("2 unsaved changes")).toBeTruthy();
  });
});
