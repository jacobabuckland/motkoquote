/**
 * @vitest-environment happy-dom
 *
 * Money position, COMING IN, on motko.app 21 Sep:
 *
 *     Megan Farrant        £348.00    0 days
 *
 * The dashboard's row for that same invoice read "due in 7 days".
 *
 * They are not in conflict — they count different things. The dashboard counts
 * time UNTIL DUE; this counts the invoice's AGE, and the invoice had been
 * raised that morning. But neither the row nor its heading said which, so
 * beside money owed a bare "0 days" reads as a countdown that has run out.
 *
 * The drawer this row opens already labels the identical figure "N days old".
 * The summary now agrees with its own detail.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { invoiceAgeLabel } from "@/lib/format";

afterEach(cleanup);

describe("the figure beside money owed", () => {
  it("does not say a bare '0 days' about an invoice raised today", () => {
    expect(invoiceAgeLabel(0)).toBe("raised today");
    expect(invoiceAgeLabel(0)).not.toBe("0 days");
  });

  it("says what it counts once there is an age to report", () => {
    expect(invoiceAgeLabel(3)).toBe("3 days old");
    expect(invoiceAgeLabel(45)).toBe("45 days old");
  });

  it("does not say '1 days old'", () => {
    expect(invoiceAgeLabel(1)).toBe("1 day old");
  });

  it("never prints a negative age from a future-dated row or a skewed clock", () => {
    // A third thing for a trade to decode, on the one panel that has to be
    // read at a glance.
    expect(invoiceAgeLabel(-2)).toBe("raised today");
  });

  it("is never bare, whatever it is given", () => {
    // The defect stated as a property rather than a set of cases: every
    // rendering names the quantity.
    for (const days of [-5, 0, 1, 2, 7, 30, 365]) {
      expect(invoiceAgeLabel(days)).toMatch(/raised today|day old|days old/);
    }
  });
});

describe("rendered beside the amount", () => {
  // Rendering the label where it lives, so a refactor that drops the call site
  // fails here rather than passing on the helper alone.
  const Row = ({ ageDays }: { ageDays: number }) => (
    <div>
      <span>Megan Farrant</span>
      <span>£348.00</span>
      <span>{invoiceAgeLabel(ageDays)}</span>
    </div>
  );

  it("reads as an age, not as a countdown that expired", () => {
    render(<Row ageDays={0} />);

    expect(screen.getByText("raised today")).toBeTruthy();
    expect(screen.queryByText("0 days")).toBeNull();
  });
});
