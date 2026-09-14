/**
 * @vitest-environment happy-dom
 */
// THE FIFTH VAT SURFACE.
//
// The PDF, /q/[id], the job page and the contract all read migration 80's
// recorded columns by 14 Sep. The editable quote block inside the job page did
// not — it recomputed from the contractor's CURRENT `vat_registered` flag — so
// switching registration put two totals for one quote on one screen: the
// header reading the recorded £740.00 over a block reading £888.00.
//
// The rule this pins: while the lines are as they were loaded, the editor
// shows what the row records. The moment a line moves, the contractor is
// building a new price and it recomputes, which is the only thing it can do.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QuoteEditor } from "@/app/jobs/[id]/quote-editor";
import type { LineItem } from "@/lib/schemas/job";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

afterEach(cleanup);

const line = (over: Partial<LineItem> = {}): LineItem => ({
  description: "Reskim hallway ceiling",
  category: "other",
  quantity: 1,
  unit: "job",
  unit_price: 740,
  multiplier: 1,
  people_count: 1,
  overtime: false,
  assumed: false,
  ...over,
});

/** Written while UNREGISTERED, so £740 with no VAT ever charged. */
const RECORDED_NIL = { total: 740, subtotal: 740, vat_amount: 0 };

const editor = (props: Partial<React.ComponentProps<typeof QuoteEditor>> = {}) => (
  <QuoteEditor
    jobId="11111111-1111-4111-8111-111111111111"
    quoteId="22222222-2222-4222-8222-222222222222"
    jobTitle="Ceiling reskim"
    initialLineItems={[line()]}
    vatRegistered
    recordedQuote={RECORDED_NIL}
    {...props}
  />
);

describe("the editor shows the price the row records", () => {
  it("does NOT invent £148 of VAT because registration is on today", () => {
    render(editor());

    // The reported screen read Subtotal £740.00 · VAT (20%) £148.00 ·
    // Total £740.00 — three figures that do not reconcile.
    expect(screen.queryByText("£148.00")).toBeNull();
    expect(screen.queryByText("£888.00")).toBeNull();
    expect(screen.getAllByText("£740.00").length).toBeGreaterThan(0);
  });

  it("agrees with itself whichever way the registration flag points", () => {
    const { unmount } = render(editor({ vatRegistered: true }));
    const on = screen.queryAllByText("£888.00").length;
    unmount();
    cleanup();

    render(editor({ vatRegistered: false }));
    const off = screen.queryAllByText("£888.00").length;

    expect(on).toBe(0);
    expect(off).toBe(0);
  });

  it("keeps a registered quote's recorded VAT when the flag is switched OFF", () => {
    // The mirror case, and the one that moves a customer's document: what they
    // agreed to does not shrink because a setting did.
    render(
      editor({
        vatRegistered: false,
        initialLineItems: [line({ unit_price: 2666.9 })],
        recordedQuote: { total: 3200.28, subtotal: 2666.9, vat_amount: 533.38 },
      }),
    );

    expect(screen.getAllByText("£3,200.28").length).toBeGreaterThan(0);
    expect(screen.getByText("£533.38")).toBeDefined();
  });

  it("RECOMPUTES once a line is edited, because there is nothing recorded yet", () => {
    render(editor());

    // Open the line, then change its quantity. From here the figures on screen
    // are a new price the contractor is building, not the one the row holds.
    fireEvent.click(screen.getByRole("button", { name: /Reskim hallway ceiling/ }));
    const quantity = screen.getAllByLabelText("Qty")[0];
    fireEvent.change(quantity, { target: { value: "2" } });

    // 2 × £740 = £1,480 net, £296 VAT at the live registration, £1,776 gross.
    expect(screen.getAllByText("£1,776.00").length).toBeGreaterThan(0);
    expect(screen.queryByText("£740.00")).toBeNull();
  });

  it("falls back to computing on a quote written before the columns existed", () => {
    // Legacy behaviour is deliberately unchanged — there is no better answer
    // for a row that recorded nothing.
    render(editor({ recordedQuote: { total: 740, subtotal: null, vat_amount: null } }));
    expect(screen.getAllByText("£888.00").length).toBeGreaterThan(0);
  });
});
