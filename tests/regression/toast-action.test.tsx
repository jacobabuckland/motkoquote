/**
 * @vitest-environment happy-dom
 */

// Archiving a contract is optimistic — the row leaves before the server has
// answered — so the only way back is an Undo in the toast that says it
// happened. The toast could not carry one: it took a message and nothing else.
//
// The trap this file exists for is the LAYER. TOAST_LAYER_CLASS is
// `pointer-events-none`, and deliberately so: the layer used to sit at the foot
// of the viewport over the Settings checkboxes, and taps passing through it are
// the reason it is inert. Inheriting that on a bubble with a button gives you a
// button that renders, reads correctly to a screen reader, and cannot be
// pressed — which is worse than no undo at all, because the row is already gone.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ToastProvider, useToast, TOAST_LAYER_CLASS } from "@/components/ui/toast";

afterEach(cleanup);

const Caller = ({
  message,
  options,
}: {
  message: string;
  options?: Parameters<ReturnType<typeof useToast>>[1];
}) => {
  const toast = useToast();
  return (
    <button type="button" onClick={() => toast(message, options)}>
      fire
    </button>
  );
};

const fire = (message: string, options?: Parameters<ReturnType<typeof useToast>>[1]) => {
  render(
    <ToastProvider>
      <Caller message={message} options={options} />
    </ToastProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "fire" }));
};

describe("a toast carrying an action", () => {
  it("renders the action as a real button", () => {
    fire("Contract archived", { action: { label: "Undo", onClick: () => {} } });

    expect(screen.getByText("Contract archived")).toBeDefined();
    expect(screen.getByRole("button", { name: "Undo" })).toBeDefined();
  });

  it("can actually be pressed, which the inert layer would otherwise prevent", () => {
    const onClick = vi.fn();
    fire("Contract archived", { action: { label: "Undo", onClick } });

    // The claim in two halves. The layer stays inert…
    expect(
      screen.getByTestId("toast-layer").className,
      "the layer must stay inert or it blocks the page underneath it",
    ).toContain("pointer-events-none");

    // …and the bubble holding a button opts back in, or the button is dead.
    const bubble = screen.getByRole("button", { name: "Undo" }).closest("div");
    expect(
      bubble?.className,
      "a bubble with an action must catch its own taps",
    ).toContain("pointer-events-auto");

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("dismisses itself when its action fires, rather than inviting a second press", () => {
    fire("Contract archived", { action: { label: "Undo", onClick: () => {} } });

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));

    // The state has already changed back; the toast offering to change it again
    // is a lie about what would happen.
    expect(screen.queryByText("Contract archived")).toBeNull();
  });

  it("stays up longer than a plain toast, because there is something to do", () => {
    vi.useFakeTimers();
    try {
      fire("Contract archived", {
        durationMs: 5000,
        action: { label: "Undo", onClick: () => {} },
      });

      // Three seconds is the default and would have taken this away while the
      // contractor was still reading it.
      act(() => {
        vi.advanceTimersByTime(3100);
      });
      expect(screen.queryByText("Contract archived")).not.toBeNull();

      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(screen.queryByText("Contract archived")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("a toast without one", () => {
  it("does not become tappable, so it still cannot block the page", () => {
    fire("Draft deleted.");

    const bubble = screen.getByText("Draft deleted.");
    expect(
      bubble.className,
      "only a bubble with an action may capture taps",
    ).not.toContain("pointer-events-auto");
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("keeps the original one-argument call working", () => {
    // Five call sites pass a bare message and must not have to change.
    fire("Saved");
    expect(screen.getByText("Saved")).toBeDefined();
  });

  it("still clears on the default timeout", () => {
    vi.useFakeTimers();
    try {
      fire("Saved");
      act(() => {
        vi.advanceTimersByTime(3100);
      });
      expect(screen.queryByText("Saved")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the layer contract the bubble depends on", () => {
  it("is inert at the layer, so this is a real constraint and not an accident", () => {
    expect(TOAST_LAYER_CLASS).toContain("pointer-events-none");
  });
});
