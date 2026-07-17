"use client";

import { useEffect } from "react";

// Fields whose focus opens the on-screen keyboard.
const FIELD_SELECTOR = "input, textarea, select, [contenteditable]";
// Interactive elements that legitimately steal focus — tapping these must NOT
// dismiss the keyboard (otherwise moving between fields flickers it closed).
const INTERACTIVE_SELECTOR =
  "input, textarea, select, [contenteditable], button, a, label, [role='button']";

// One shared, plugin-free keyboard helper mounted at the app root. It gives the
// wrapped iOS WKWebView the two behaviours a native app has for free but a web
// view does not:
//   1. The focused field always scrolls clear of the keyboard.
//   2. Tapping outside any field dismisses the keyboard.
// Both are safe on the plain web too (desktop has no keyboard to avoid, and
// browsers already blur on outside taps), so it runs everywhere.
export const KeyboardManager = (): null => {
  useEffect(() => {
    const isField = (el: EventTarget | null): el is HTMLElement =>
      el instanceof HTMLElement && el.matches(FIELD_SELECTOR);

    // iOS shrinks window.visualViewport to the space above the keyboard. When
    // the focused field's bottom sits under that (or above the top), centre it
    // in the remaining visible area once the keyboard has finished animating.
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (!isField(target)) return;
      window.setTimeout(() => {
        if (document.activeElement !== target) return;
        const viewport = window.visualViewport;
        const visibleBottom = viewport ? viewport.height : window.innerHeight;
        const rect = target.getBoundingClientRect();
        if (rect.bottom > visibleBottom - 16 || rect.top < 16) {
          target.scrollIntoView({ block: "center", behavior: "smooth" });
        }
      }, 300);
    };

    // Tap outside any field dismisses the keyboard. In a browser clicking
    // elsewhere already blurs; inside the WKWebView it does not, so blur the
    // active field when the tap didn't land on another interactive control.
    const onPointerDown = (event: PointerEvent) => {
      const active = document.activeElement;
      if (!isField(active)) return;
      const target = event.target;
      if (target instanceof Element && target.closest(INTERACTIVE_SELECTOR)) {
        return;
      }
      active.blur();
    };

    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, []);

  return null;
};
