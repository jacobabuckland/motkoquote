/**
 * @vitest-environment happy-dom
 *
 * The mic gives PROOF it is hearing you, not a claim.
 *
 * "Listening" is a word that renders identically in a dead room and a live
 * one. A trade is about to talk at this screen for two minutes with no other
 * feedback, so the thing that matters is whether the bars move when they do.
 *
 * The level arrives as one inline custom property and every bar's height is a
 * calc() over it — see mic-level-meter.tsx for why. That makes the meter
 * testable without a layout engine: happy-dom resolves neither calc() nor
 * percentage heights, but it does record the custom property, which is the
 * value the whole thing is driven by.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MicLevelMeter } from "@/components/voice/mic-level-meter";

afterEach(cleanup);

const levelOf = (container: HTMLElement): number =>
  Number(
    (container.firstElementChild as HTMLElement).style.getPropertyValue("--level"),
  );

describe("the mic level meter", () => {
  it("renders five bars", () => {
    const { container } = render(<MicLevelMeter level={0} />);
    expect(container.querySelectorAll(".level-meter-bar")).toHaveLength(5);
  });

  it("rises with the voice", () => {
    const { container: quiet } = render(<MicLevelMeter level={0.02} />);
    const { container: loud } = render(<MicLevelMeter level={0.2} />);

    expect(levelOf(loud)).toBeGreaterThan(levelOf(quiet));
  });

  it("sits at zero in silence", () => {
    const { container } = render(<MicLevelMeter level={0} />);
    expect(levelOf(container)).toBe(0);
  });

  it("reaches full scale on an ordinary speaking voice, not only a shout", () => {
    // 0.22 RMS is a normal voice at arm's length. A meter that only fills when
    // shouted at reads as "it can't hear me" to someone speaking normally,
    // which is the exact anxiety it exists to remove.
    const { container } = render(<MicLevelMeter level={0.22} />);
    expect(levelOf(container)).toBe(1);
  });

  it("clamps instead of overflowing when the room is very loud", () => {
    const { container } = render(<MicLevelMeter level={5} />);
    expect(levelOf(container)).toBe(1);
  });

  it("never goes negative", () => {
    const { container } = render(<MicLevelMeter level={-1} />);
    expect(levelOf(container)).toBe(0);
  });

  it("weights the bars so the middle leads", () => {
    // Not decoration: uniform bars read as a progress indicator, and a
    // progress indicator during an open-ended conversation implies an end
    // point that does not exist.
    const { container } = render(<MicLevelMeter level={0.2} />);
    const weights = [...container.querySelectorAll(".level-meter-bar")].map((bar) =>
      Number((bar as HTMLElement).style.getPropertyValue("--bar-weight")),
    );

    expect(weights[2]).toBe(Math.max(...weights));
    expect(weights[0]).toBe(weights[4]);
    expect(weights[0]).toBeLessThan(weights[1]);
  });
});

describe("the reduced-motion fallback is reachable", () => {
  it("pins --level inside the ONE reduced-motion block, with !important", async () => {
    // Two things this catches, both of which have already happened once:
    //
    //   1. Without !important the stylesheet loses to the component's inline
    //      --level, so the bars keep moving for the people who asked them not
    //      to — the failure is invisible in every test that does not check the
    //      cascade.
    //   2. A SECOND @media (prefers-reduced-motion: reduce) block shadows the
    //      first for anything locating it by regex, which tests/acceptance/119
    //      and 140 both do. Adding one broke eight of their assertions.
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const css = readFileSync(
      join(__dirname, "../../src/app/globals.css"),
      "utf8",
    );

    // Comments stripped first, and the opening brace required. Counting the
    // bare string matched the prose in this very stylesheet explaining why
    // there must only be one of these — a regex over source over-matching in
    // exactly the way that costs a cycle.
    const code = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const blocks =
      code.match(/@media \(prefers-reduced-motion: reduce\)\s*\{/g) ?? [];
    expect(blocks).toHaveLength(1);
    expect(css).toMatch(/--level:\s*[\d.]+\s*!important/);
  });
});
