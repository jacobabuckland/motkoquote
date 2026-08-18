/**
 * @vitest-environment happy-dom
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AccountPrompt } from "@/components/guest/account-prompt";
import { useState } from "react";
import { Button } from "@/components/ui/button";

afterEach(cleanup);

// Stands in for the guest quote screen's gated-action block: a control that
// reveals the prompt in place, with the guest's work still on screen around it.
const GatedActionHarness = () => {
  const [gated, setGated] = useState<string | null>(null);
  return (
    <div>
      <p>Ref ABCD1234</p>
      <Button type="button" onClick={() => setGated("Sending to a customer")}>
        Send to a customer
      </Button>
      {gated && <AccountPrompt action={gated} />}
    </div>
  );
};

describe("a guest reaching a gated action", () => {
  it("gets an inline prompt and keeps their work on screen", () => {
    render(<GatedActionHarness />);

    expect(screen.queryByText(/needs an account/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Send to a customer" }));

    expect(screen.getByText("Sending to a customer needs an account")).toBeTruthy();
    // The in-progress work is still rendered — nothing navigated away.
    expect(screen.getByText("Ref ABCD1234")).toBeTruthy();
  });

  it("offers both ways in, and neither is a redirect fired on its own", () => {
    render(<AccountPrompt action="Saving this quote" />);

    const create = screen.getByRole("link", { name: "Create an account" });
    const signIn = screen.getByRole("link", { name: "Sign in" });

    expect(create.getAttribute("href")).toBe("/signup");
    expect(signIn.getAttribute("href")).toBe("/login");
  });

  it("says plainly that the quote is device-local and an account starts fresh", () => {
    render(<AccountPrompt action="Invoicing it" />);
    expect(
      screen.getByText(/stays on this device. Creating an account starts a fresh job/),
    ).toBeTruthy();
  });
});
