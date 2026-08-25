/**
 * @vitest-environment happy-dom
 */

// Two things from the 25 Aug device screenshots of the "Ask about money" screen.
//
// 1. MicExplainer took a `starting` prop driving `disabled` and a "Starting…"
//    label. All four call sites passed a literal `false`, so neither ever
//    happened. Wiring it to real state would not have helped either: every
//    surface gates this screen on `attempt === 0`, so `onStart` unmounts the
//    whole explainer in the same commit. The prop was unreachable by
//    construction. It is gone.
//
// 2. The screen promised "I'll speak the answer and close". The session never
//    closes itself — response.done returns it to listening — and the transcript
//    in the screenshots is a multi-turn conversation. The copy now matches.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MicExplainer } from "@/components/voice/mic-permission-screen";

afterEach(cleanup);

// Worth being straight about what these three prove. They pass against the old
// code as well, because `starting={false}` meant the button was already enabled
// and already showed its label — dead code has no observable behaviour to
// regress. They are not evidence the removal fixed anything; they are the guard
// that it broke nothing, and they fail if a pending state is ever reintroduced
// defaulting to disabled, or if the decline path is dropped. The test that
// actually fails against the old code is the copy one at the bottom.
describe("the start button", () => {
  it("is enabled and tappable", () => {
    const onStart = vi.fn();
    render(
      <MicExplainer
        intro="Ask me about your money."
        startLabel="Start voice query"
        onStart={onStart}
      />,
    );

    const button = screen.getByRole("button", { name: "Start voice query" });
    expect((button as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(button);
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("shows its real label, never an unreachable pending state", () => {
    render(
      <MicExplainer
        intro="Ask me about your money."
        startLabel="Start voice query"
        onStart={() => {}}
      />,
    );

    expect(screen.queryByText(/Starting…/)).toBeNull();
    expect(screen.getByRole("button", { name: "Start voice query" })).toBeDefined();
  });

  it("keeps the manual escape hatch for someone who will not use the mic", () => {
    // Removing the dead prop must not take the decline path with it — that is
    // the only way off this screen for a contractor who won't grant the mic.
    const onManual = vi.fn();
    render(
      <MicExplainer
        intro="Ask me about your money."
        startLabel="Start voice query"
        onStart={() => {}}
        onManual={onManual}
        manualLabel="Back to dashboard"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Back to dashboard" }));
    expect(onManual).toHaveBeenCalledTimes(1);
  });
});

describe("what the screen promises before you start", () => {
  it("does not claim the session closes after one question", async () => {
    vi.doMock("next/navigation", () => ({
      useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
    }));

    const { default: LedgerQueryPage } = await import("@/app/ledger/query/page");
    render(<LedgerQueryPage />);

    const intro = screen.getByText(/Ask me about your money/i).textContent ?? "";

    expect(
      intro,
      "the session does not close itself — response.done returns it to listening",
    ).not.toMatch(/and close/i);
    // It stays open until the contractor says otherwise, so say that instead.
    expect(intro).toMatch(/ask again/i);
    expect(intro).toMatch(/Done/);
  });
});
