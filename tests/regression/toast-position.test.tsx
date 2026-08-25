/**
 * @vitest-environment happy-dom
 */

// Regression: the toast rendered over the notification checkboxes — the
// controls the Settings section exists for.
//
// It was `fixed inset-x-0 bottom-6 z-50`, full width at the foot of the
// viewport, which is exactly where "What to notify me about" sits. And it fires
// BECAUSE the user acted on that screen, so it was guaranteed to land on the
// control they were working with at the moment they were working with it.
//
// `pointer-events-none` meant taps still reached the checkboxes underneath, so
// this obscured rather than blocked — a distinction worth keeping straight, and
// one an earlier pass got wrong in the other direction by concluding that
// because taps passed through, nothing was overlaid. Something was.
//
// The fix is to anchor the layer to the TOP, where it competes with the header
// rather than with form controls.
//
// What these tests can and cannot do: happy-dom does not lay out or compute
// overlap, so nothing here proves two boxes do not intersect on a real screen.
// They pin the mechanism. Confirmation is one look at Settings on a device.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  ToastProvider,
  TOAST_BUBBLE_CLASS,
  TOAST_LAYER_CLASS,
  useToast,
} from "@/components/ui/toast";

afterEach(cleanup);

const Trigger = () => {
  const toast = useToast();
  return (
    <button type="button" onClick={() => toast("Saved")}>
      Fire
    </button>
  );
};

const fireToast = () => {
  render(
    <ToastProvider>
      <Trigger />
    </ToastProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Fire" }));
  return screen.getByTestId("toast-layer");
};

describe("where the toast lands", () => {
  it("is anchored to the top, not over the foot of the form", () => {
    const layer = fireToast();
    expect(layer.className).toContain("top-0");
    expect(
      layer.className,
      "a bottom-anchored full-width toast covers whatever control the user just used",
    ).not.toContain("bottom-");
  });

  it("clears the notch rather than the home indicator", () => {
    // At the bottom the thing to clear was the home indicator (pb-safe). At the
    // top it is the notch. Keeping the old one would tuck the toast under the
    // status bar on a notched device.
    const layer = fireToast();
    expect(layer.className).toContain("pt-safe");
    expect(layer.className).not.toContain("pb-safe");
  });

  it("stays inert, so taps still reach whatever is beneath it", () => {
    // Non-negotiable. This is why the defect obscured rather than blocked, and
    // losing it would turn a display bug into a dead control.
    expect(fireToast().className).toContain("pointer-events-none");
  });

  it("sits above the status-bar backdrop, which is at z-40 deliberately", () => {
    expect(fireToast().className).toContain("z-50");
  });

  it("stacks downward from the top, so several cover the header not the form", () => {
    // The stacked case has to hold too: the container is a flex column, and at
    // the top that grows down over the header. At the bottom it grew UP, taking
    // progressively more of the form with each additional toast.
    const layer = fireToast();
    expect(layer.className).toContain("flex-col");
  });
});

describe("the toast still behaves as a toast", () => {
  it("auto-dismisses after 3s", async () => {
    // Rotation and dismissal are deterministic, so advance the clock and assert
    // synchronously — never waitFor under fake timers, which deadlocks.
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Fire" }));
    expect(screen.getByText("Saved")).toBeDefined();

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(screen.queryByText("Saved")).toBeNull();
    vi.useRealTimers();
  });

  it("announces politely, so a screen reader is told without being interrupted", () => {
    expect(fireToast().getAttribute("aria-live")).toBe("polite");
  });
});

describe("the two toast surfaces cannot drift apart", () => {
  // ShareLinkButton paints its own toast rather than going through the
  // provider, and the two carried a copied class string. A fix applied to one
  // and not the other is how this defect half-survives.
  it("share-link-button paints into the same layer as the provider", async () => {
    const { ShareLinkButton } = await import("@/components/ui/share-link-button");

    // navigator.share absent → the button falls back to the clipboard path,
    // which is what raises its toast.
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: async () => {} },
      configurable: true,
    });

    render(<ShareLinkButton url="https://motko.app/q/ABCD1234" title="Quote" />);
    fireEvent.click(screen.getByRole("button", { name: "Share link" }));

    const layer = await screen.findByTestId("toast-layer");
    expect(
      layer.className,
      "share-link-button's toast has drifted from the provider's",
    ).toBe(TOAST_LAYER_CLASS);
    expect(layer.firstElementChild?.className).toBe(TOAST_BUBBLE_CLASS);
  });

  it("the provider paints into it too, so the constant is genuinely shared", () => {
    const layer = fireToast();
    expect(layer.className).toBe(TOAST_LAYER_CLASS);
    expect(layer.firstElementChild?.className).toBe(TOAST_BUBBLE_CLASS);
  });
});

describe("the offline banner outranks the toast", () => {
  it("sits above it, now that both are at the top of the viewport", async () => {
    // On equal z the toast would win on DOM order, hiding a persistent "you are
    // offline" behind a message that vanishes in three seconds — when the
    // banner is often the reason the toast's action didn't work.
    const source = await import("node:fs").then((fs) =>
      fs.promises.readFile("src/components/ui/offline-banner.tsx", "utf-8"),
    );
    expect(source).toContain("z-[60]");
    expect(TOAST_LAYER_CLASS).toContain("z-50");
  });
});
