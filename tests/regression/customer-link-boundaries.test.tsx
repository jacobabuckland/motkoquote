/**
 * @vitest-environment happy-dom
 */

/**
 * A customer must be able to tell a broken link from a broken server.
 *
 * Until these boundaries existed, ONE file — src/app/error.tsx — rendered
 * "That didn't load. Something went wrong loading this screen. Check your
 * connection and try again." for every uncaught error anywhere in the app, and
 * every `notFound()` on a customer route rendered Next's stock 404.
 *
 * Both are wrong for the person holding the link:
 *
 *   - "Check your connection" blames the customer for our fault. On 8 Sep a
 *     customer opening a quote got exactly this because a malformed APNs key
 *     made the CONTRACTOR's notification throw. Their connection was fine.
 *   - An unknown id and a server fault were indistinguishable, so a customer
 *     could not know whether to retry or to ask for a new link.
 *   - Nothing on either screen could be quoted, so a report could not be joined
 *     to a server log line. Five distinct-looking defects were logged from one
 *     bug for exactly this reason.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { CustomerLinkError } from "@/components/customer/link-error";
import { CustomerLinkNotFound } from "@/components/customer/link-not-found";

vi.mock("next/navigation", () => ({ usePathname: () => "/q/some-id" }));
vi.mock("@/app/actions", () => ({ reportRenderError: vi.fn(async () => {}) }));

afterEach(cleanup);

const anError = (digest?: string): Error & { digest?: string } =>
  Object.assign(new Error("error:1E08010C:DECODER routines::unsupported"), { digest });

describe("the customer error boundary", () => {
  it("does not blame the customer's connection", () => {
    render(<CustomerLinkError error={anError()} reset={() => {}} document="quote" />);

    // The exact words a customer saw on 8 Sep while their connection was fine.
    expect(document.body.textContent).not.toMatch(/check your connection/i);
  });

  it("says the fault is ours and that nothing was lost", () => {
    // The question a customer actually has after tapping Accept and seeing an
    // error: did it go through? Silence on that is the expensive part.
    render(<CustomerLinkError error={anError()} reset={() => {}} document="quote" />);

    expect(screen.getByText(/not yours/i)).toBeDefined();
    expect(screen.getByText(/nothing you've done has been lost/i)).toBeDefined();
  });

  it("names the document the customer was opening", () => {
    render(<CustomerLinkError error={anError()} reset={() => {}} document="invoice" />);

    expect(screen.getByRole("heading").textContent).toMatch(/invoice/i);
  });

  it("offers a retry that actually calls reset", () => {
    const reset = vi.fn();
    render(<CustomerLinkError error={anError()} reset={reset} document="quote" />);

    fireEvent.click(screen.getByRole("button", { name: /try again/i }));

    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("shows the digest so a report can be matched to a log line", () => {
    render(
      <CustomerLinkError error={anError("1722272750")} reset={() => {}} document="quote" />,
    );

    expect(screen.getByText("1722272750")).toBeDefined();
  });

  it("never shows the raw error text", () => {
    // A customer must not be shown "DECODER routines::unsupported", and it must
    // not leak what our infrastructure is doing.
    render(
      <CustomerLinkError error={anError("1722272750")} reset={() => {}} document="quote" />,
    );

    expect(document.body.textContent).not.toMatch(/DECODER|APNS|routines/i);
  });

  it("says nothing about a code when there is no digest", () => {
    // Telling someone to quote a code and then not giving them one is worse
    // than not mentioning it.
    render(<CustomerLinkError error={anError()} reset={() => {}} document="quote" />);

    expect(document.body.textContent).not.toMatch(/quote\s/i);
  });
});

describe("the customer not-found page", () => {
  it("reads as a broken link, not as a server fault", () => {
    render(<CustomerLinkNotFound document="quote" />);

    expect(screen.getByRole("heading").textContent).toMatch(/link doesn't work/i);
    expect(document.body.textContent).not.toMatch(/went wrong|try again in a moment/i);
  });

  it("gives the customer both plausible causes and something to do", () => {
    render(<CustomerLinkNotFound document="contract" />);

    expect(document.body.textContent).toMatch(/cut short/i);
    expect(document.body.textContent).toMatch(/ask the tradesperson/i);
  });

  it("never discloses that an account was erased", () => {
    // This page is also what an erased contractor's documents resolve to.
    // `/q/[id]` answers them with the same neutral not-found as a mistyped id
    // precisely so nothing reveals that an account was deleted, or whose —
    // wording that leaks it would undo that at the last step.
    render(<CustomerLinkNotFound document="quote" />);

    expect(document.body.textContent).not.toMatch(
      /delet|erase|clos(ed|ure)|account|removed|suspend/i,
    );
  });

  it("does not offer a retry, because retrying cannot help", () => {
    render(<CustomerLinkNotFound document="invoice" />);

    expect(screen.queryByRole("button", { name: /try again/i })).toBeNull();
  });
});
