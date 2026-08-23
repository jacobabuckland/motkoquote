"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type SetStateAction,
} from "react";

// A list row that can be pulled to the right to reveal one action tucked
// behind its leading edge — the phone gesture for "get this out of my list".
//
// THE PULL REVEALS, IT NEVER FIRES. The gesture is two-stage by design: a drag
// only slides the action into view, and nothing happens until that control is
// tapped. A stray sideways drag while scrolling therefore costs a snap-back and
// nothing else, which is what makes it safe to put a destructive action here.
//
// A vertical gesture is the page scrolling and is handed straight back — the
// axis is decided once, after the pointer has moved past AXIS_SLOP, and a row
// that has decided "vertical" stays out of the way for the rest of the drag.
//
// The revealed control stays mounted while the row is shut rather than being
// conditionally rendered, so it is reachable by Tab and announced by a screen
// reader. Focusing it slides the row open: that is the gesture's keyboard
// equivalent, and without it the action would exist only for people who can
// drag.

// Only one row shows its action at a time — opening one puts the last away,
// the way a phone list behaves. Module-level because it is a property of the
// list, not of any row in it. The open row is held by its own offset setter,
// which React keeps stable and unique per mounted row, so it doubles as the
// row's identity and the means of shutting it.
let openRow: Dispatch<SetStateAction<number>> | null = null;

const DEFAULT_REVEAL_WIDTH = 104;

// How far a pointer travels before the gesture is read as a horizontal pull
// rather than a vertical scroll.
const AXIS_SLOP = 8;

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

type Gesture = { x: number; y: number; from: number; axis: "unknown" | "x" | "y" };

type Props = {
  /** The control revealed behind the row. Rendered whether or not it is showing. */
  action: ReactNode;
  /** The row itself. */
  children: ReactNode;
  /** Width of the revealed track, in px. */
  revealWidth?: number;
  /** Fired when the row settles open — for a haptic, typically. */
  onOpen?: () => void;
};

export const SwipeToReveal = ({
  action,
  children,
  revealWidth = DEFAULT_REVEAL_WIDTH,
  onOpen,
}: Props) => {
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const gesture = useRef<Gesture | null>(null);
  const track = useRef<HTMLDivElement | null>(null);
  // A pull that moved the row must not also fire the row's own link on
  // release: PipelineRow's name carries a stretched anchor over the whole row,
  // so every drag ends on top of a hit target.
  const swallowNextClick = useRef(false);

  const close = useCallback(() => {
    setOffset(0);
    if (openRow === setOffset) openRow = null;
  }, []);

  const open = useCallback(() => {
    if (openRow && openRow !== setOffset) openRow(0);
    openRow = setOffset;
    setOffset(revealWidth);
    onOpen?.();
  }, [onOpen, revealWidth]);

  useEffect(
    () => () => {
      if (openRow === setOffset) openRow = null;
    },
    [],
  );

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    swallowNextClick.current = false;
    gesture.current = { x: event.clientX, y: event.clientY, from: offset, axis: "unknown" };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = gesture.current;
    if (!current) return;

    const dx = event.clientX - current.x;
    const dy = event.clientY - current.y;

    if (current.axis === "unknown") {
      if (Math.abs(dx) < AXIS_SLOP && Math.abs(dy) < AXIS_SLOP) return;
      current.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      if (current.axis === "x") {
        setDragging(true);
        // Keep receiving moves if the finger leaves the row mid-pull.
        try {
          event.currentTarget.setPointerCapture?.(event.pointerId);
        } catch {
          // Capture is a nicety; a browser that refuses it still tracks the
          // gesture while the pointer stays over the row.
        }
      }
    }

    if (current.axis !== "x") return;
    swallowNextClick.current = true;
    setOffset(clamp(current.from + dx, 0, revealWidth));
  };

  const endGesture = () => {
    const current = gesture.current;
    gesture.current = null;
    setDragging(false);
    if (!current || current.axis !== "x") return;
    // Past halfway it settles open, otherwise it springs shut. Nothing is
    // fired either way.
    if (offset >= revealWidth / 2) open();
    else close();
  };

  const onClickCapture = (event: React.MouseEvent<HTMLDivElement>) => {
    if (swallowNextClick.current) {
      swallowNextClick.current = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    // With the action showing, a tap on the row puts it away rather than
    // following the row's link — the same escape a phone list gives you.
    if (offset > 0 && !track.current?.contains(event.target as Node)) {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  };

  return (
    <div
      data-testid="swipe-to-reveal"
      // pan-y so a vertical drag still scrolls the page; the horizontal axis
      // is ours.
      className="relative touch-pan-y overflow-hidden rounded-card"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endGesture}
      onPointerCancel={endGesture}
      onClickCapture={onClickCapture}
    >
      <div
        ref={track}
        className="absolute inset-y-0 left-0 flex items-stretch"
        style={{ width: revealWidth }}
        onFocus={open}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) close();
        }}
      >
        {action}
      </div>
      <div
        data-testid="swipe-to-reveal-row"
        className={dragging ? "" : "motion-safe:transition-transform motion-safe:duration-200"}
        style={{ transform: `translate3d(${offset}px, 0, 0)` }}
      >
        {children}
      </div>
    </div>
  );
};
