/**
 * @vitest-environment happy-dom
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SwipeToReveal } from "@/components/ui/swipe-to-reveal";

afterEach(cleanup);

const REVEAL_WIDTH = 104;

const row = () => screen.getByTestId("swipe-to-reveal");
const sled = () => screen.getByTestId("swipe-to-reveal-row");

// The offset the row is currently held at, read back off the transform it
// renders rather than off component internals.
const offsetOf = (element: HTMLElement) => {
  const match = /translate3d\((-?[\d.]+)px/.exec(element.style.transform);
  return match ? Number(match[1]) : Number.NaN;
};

// A real tap always begins with a pointerdown — which is what tells the row a
// fresh gesture has started. fireEvent.click on its own does not, so tapping
// through the whole sequence is the only faithful model of one.
const tap = (element: HTMLElement) => {
  fireEvent.pointerDown(element, { pointerId: 2, pointerType: "touch", clientX: 10, clientY: 10 });
  fireEvent.pointerUp(element, { pointerId: 2, pointerType: "touch", clientX: 10, clientY: 10 });
  fireEvent.click(element);
};

const pull = (from: { x: number; y: number }, to: { x: number; y: number }) => {
  const target = row();
  fireEvent.pointerDown(target, { pointerId: 1, pointerType: "touch", clientX: from.x, clientY: from.y });
  fireEvent.pointerMove(target, { pointerId: 1, pointerType: "touch", clientX: to.x, clientY: to.y });
  fireEvent.pointerUp(target, { pointerId: 1, pointerType: "touch", clientX: to.x, clientY: to.y });
};

const renderRow = (onDelete = vi.fn(), onOpen?: () => void) => {
  render(
    <SwipeToReveal
      onOpen={onOpen}
      action={
        <button type="button" onClick={onDelete}>
          Delete
        </button>
      }
    >
      <a href="#job-1">Mrs Patel</a>
    </SwipeToReveal>,
  );
  return onDelete;
};

describe("SwipeToReveal", () => {
  it("starts closed with the action mounted, so it is reachable without the gesture", () => {
    renderRow();

    expect(offsetOf(sled())).toBe(0);
    expect(screen.getByRole("button", { name: "Delete" })).toBeDefined();
  });

  it("pulls the row to the right and settles it open past halfway", () => {
    const onOpen = vi.fn();
    renderRow(vi.fn(), onOpen);

    pull({ x: 20, y: 40 }, { x: 100, y: 42 });

    expect(offsetOf(sled())).toBe(REVEAL_WIDTH);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("springs back when the pull stops short of halfway", () => {
    const onOpen = vi.fn();
    renderRow(vi.fn(), onOpen);

    pull({ x: 20, y: 40 }, { x: 50, y: 40 });

    expect(offsetOf(sled())).toBe(0);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("never pulls further than the revealed track", () => {
    renderRow();
    const target = row();

    fireEvent.pointerDown(target, { pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(target, { pointerId: 1, clientX: 400, clientY: 0 });

    expect(offsetOf(sled())).toBe(REVEAL_WIDTH);
  });

  it("does not pull to the left — the action only lives on the leading edge", () => {
    renderRow();
    const target = row();

    fireEvent.pointerDown(target, { pointerId: 1, clientX: 200, clientY: 0 });
    fireEvent.pointerMove(target, { pointerId: 1, clientX: 100, clientY: 0 });

    expect(offsetOf(sled())).toBe(0);
  });

  it("leaves a vertical drag alone, so the list still scrolls", () => {
    renderRow();

    // Mostly down, with the sideways wobble a real thumb has.
    pull({ x: 20, y: 40 }, { x: 34, y: 160 });

    expect(offsetOf(sled())).toBe(0);
  });

  it("never fires the action from the gesture alone", () => {
    const onDelete = renderRow();

    pull({ x: 20, y: 40 }, { x: 200, y: 40 });

    expect(onDelete).not.toHaveBeenCalled();
  });

  it("fires the action when the revealed control is tapped", () => {
    const onDelete = renderRow();

    pull({ x: 20, y: 40 }, { x: 200, y: 40 });
    tap(screen.getByRole("button", { name: "Delete" }));

    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("swallows the click a pull lands on, so the row's own link does not fire", () => {
    const onNavigate = vi.fn((event: MouseEvent) => event.preventDefault());
    renderRow();
    const link = screen.getByRole("link", { name: "Mrs Patel" });
    link.addEventListener("click", onNavigate);

    pull({ x: 20, y: 40 }, { x: 200, y: 40 });
    fireEvent.click(link);

    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("puts an open row away when the row itself is tapped", () => {
    renderRow();

    pull({ x: 20, y: 40 }, { x: 200, y: 40 });
    expect(offsetOf(sled())).toBe(REVEAL_WIDTH);

    tap(screen.getByRole("link", { name: "Mrs Patel" }));

    expect(offsetOf(sled())).toBe(0);
  });

  it("opens on focus, so the action is usable from the keyboard", () => {
    renderRow();

    fireEvent.focus(screen.getByRole("button", { name: "Delete" }));

    expect(offsetOf(sled())).toBe(REVEAL_WIDTH);
  });

  it("shows one row's action at a time", () => {
    render(
      <>
        <SwipeToReveal action={<button type="button">Delete A</button>}>
          <span>A</span>
        </SwipeToReveal>
        <SwipeToReveal action={<button type="button">Delete B</button>}>
          <span>B</span>
        </SwipeToReveal>
      </>,
    );

    const [first, second] = screen.getAllByTestId("swipe-to-reveal");
    const sleds = screen.getAllByTestId("swipe-to-reveal-row");

    const pullOpen = (target: HTMLElement) => {
      fireEvent.pointerDown(target, { pointerId: 1, clientX: 0, clientY: 0 });
      fireEvent.pointerMove(target, { pointerId: 1, clientX: 200, clientY: 0 });
      fireEvent.pointerUp(target, { pointerId: 1, clientX: 200, clientY: 0 });
    };

    pullOpen(first);
    expect(offsetOf(sleds[0])).toBe(REVEAL_WIDTH);

    pullOpen(second);
    expect(offsetOf(sleds[1])).toBe(REVEAL_WIDTH);
    expect(offsetOf(sleds[0])).toBe(0);
  });
});
