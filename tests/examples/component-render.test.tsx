/**
 * @vitest-environment happy-dom
 *
 * Example test demonstrating rendering a real React component from src/.
 *
 * The companion example, dom-capacitor.test.tsx, builds DOM nodes by hand with
 * document.createElement. That proves the DOM environment works but not that a
 * component can be mounted, which is what an acceptance test for a UI item
 * actually needs — see #118, where the Button item could not be specced
 * because nothing here could render <Button />.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Button } from "@/components/ui/button";

// Registered explicitly: the vitest config does not set `globals: true`, so
// Testing Library's automatic cleanup never registers itself. Without this,
// each test's markup stays in document.body and the next test's query finds
// the previous test's elements.
afterEach(cleanup);

describe("Rendering a real component", () => {
  it("mounts the component and exposes it by its accessible role", () => {
    render(<Button>Send quote</Button>);

    const button = screen.getByRole("button", { name: "Send quote" });
    expect(button).toBeTruthy();
    expect(button.tagName).toBe("BUTTON");
  });

  it("passes props through to the underlying element", () => {
    render(<Button disabled>Send quote</Button>);

    const button = screen.getByRole("button", { name: "Send quote" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it("fires a user interaction and observes the handler", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Send quote</Button>);

    fireEvent.click(screen.getByRole("button", { name: "Send quote" }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does not fire the handler when disabled", () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Send quote
      </Button>
    );

    fireEvent.click(screen.getByRole("button", { name: "Send quote" }));

    expect(onClick).not.toHaveBeenCalled();
  });

  it("leaves no markup behind for the next test", () => {
    expect(document.body.querySelectorAll("button")).toHaveLength(0);
  });
});
