/**
 * @vitest-environment happy-dom
 *
 * 20 SEP, from a dashboard screenshot. The hero read
 *
 *     Every invoice is paid
 *     £2,190.00of agreed work hasn't been invoiced yet. Raise it when the job's done.
 *
 * Two defects in one view. This file covers the typographic one; the second —
 * "Your move" reading "Nothing needs you right now" directly beneath that
 * figure — is a change to `dashboardSection` that `tests/acceptance/419.test.tsx`
 * freezes, and is Jacob's call to release.
 *
 * The space is not reproducible under vitest's JSX transform: the assertion
 * below passes against the unfixed component. It is a PIN on the rendered
 * output rather than a reproduction, which is why the fix is the explicit
 * `{" "}` the same file already uses for the greeting two branches down — a
 * no-op wherever the whitespace already survives.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { DashboardHero } from "@/components/ui/dashboard-hero";

afterEach(cleanup);

describe("the hero's uninvoiced line", () => {
  it("does not run the amount into the word after it", () => {
    render(<DashboardHero outstandingTotal={0} uninvoicedTotal={2190} />);

    expect(screen.getByText(/agreed work/).textContent).toContain(
      "£2,190.00 of agreed work",
    );
  });

  it("still names what to do about the figure", () => {
    render(<DashboardHero outstandingTotal={0} uninvoicedTotal={2190} />);

    expect(screen.getByText(/agreed work/).textContent).toContain(
      "Raise it when the job's done.",
    );
  });

  it("leaves the all-square state alone", () => {
    render(<DashboardHero outstandingTotal={0} uninvoicedTotal={0} />);

    expect(screen.getByText("You're all square")).toBeTruthy();
  });

  it("leaves the ledger figure alone when something is outstanding", () => {
    render(<DashboardHero outstandingTotal={840} uninvoicedTotal={2190} />);

    expect(screen.getByText("£840.00")).toBeTruthy();
  });
});
