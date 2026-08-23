"use client";

import { useState, useEffect, useRef, cloneElement, isValidElement } from "react";
import * as haptics from "@/lib/haptics";
import {
  loadDisclosureState,
  loadDisclosureStateSync,
  saveDisclosureState,
} from "@/lib/disclosure-storage";

type DisclosureProps = {
  id: string;
  title: string;
  defaultOpen: boolean;
  children: React.ReactNode;
};

export function Disclosure({
  id,
  title,
  defaultOpen,
  children,
}: DisclosureProps) {
  // defaultOpen on BOTH server and client, always. Reading storage here is a
  // hydration mismatch: the server has no localStorage so it renders
  // defaultOpen, and the client hydrates with whatever is stored. That is the
  // finding QA raised on this item twice. The stored value is applied in an
  // effect below instead, which runs after hydration.
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const contentId = `${id}-content`;
  const contentRef = useRef<HTMLDivElement>(null);
  const expandedByDeepLinkRef = useRef(false);

  // Auto-expand if URL hash points to an element inside this disclosure
  useEffect(() => {
    if (!contentRef.current || !window.location.hash) return;

    const hash = window.location.hash.slice(1); // Remove '#'
    const target = document.getElementById(hash);

    if (target && contentRef.current.contains(target)) {
      // Expand without persisting the state change
      setIsOpen(true);
      expandedByDeepLinkRef.current = true;
    }
  }, []);

  // Apply the stored preference after mount. Synchronously on web, because
  // React flushes an effect inside the same commit — so the stored value lands
  // before the browser paints (no flash) and before the contract's "restores
  // state from localStorage on mount" test makes its first assertion. A
  // promise here defers it to a microtask after the commit and fails that
  // test; that was tried, and it does.
  //
  // Native falls through to the async path: loadDisclosureStateSync returns
  // null there, because Preferences is the source of truth and is genuinely
  // asynchronous.
  //
  // Neither path overrides a section a deep link has already expanded.
  useEffect(() => {
    const synchronous = loadDisclosureStateSync(id);
    if (synchronous !== null) {
      if (!expandedByDeepLinkRef.current) {
        // Deliberate suppression. The rule is a performance heuristic: setting
        // state in an effect body costs one extra render on mount, which it
        // does here, every time. That is the trade being made, not a case the
        // rule fails to understand — and the alternatives are the hydration
        // mismatch above or a failing contract test.
        //
        // useSyncExternalStore would remove the suppression entirely and is
        // the right long-term shape. It needs a subscribe/notify layer in
        // disclosure-storage.ts and a rework of the toggle, which is more than
        // this ticket is.
        //
        // Narrowed to the one rule on purpose: a bare disable switches off
        // every rule on the line, permanently and invisibly.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setIsOpen(synchronous === "open");
      }
      return;
    }

    let cancelled = false;
    loadDisclosureState(id).then((storedState) => {
      if (!cancelled && storedState !== null && !expandedByDeepLinkRef.current) {
        setIsOpen(storedState === "open");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Make inner content not focusable when collapsed
  useEffect(() => {
    if (!contentRef.current) return;

    const focusableElements = contentRef.current.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );

    focusableElements.forEach((el) => {
      if (isOpen) {
        // Restore tabindex if it was stored
        const stored = el.getAttribute("data-disclosure-tabindex");
        if (stored) {
          el.setAttribute("tabindex", stored);
          el.removeAttribute("data-disclosure-tabindex");
        } else {
          el.removeAttribute("tabindex");
        }
      } else {
        // Store current tabindex and set to -1
        const current = el.getAttribute("tabindex");
        if (current) {
          el.setAttribute("data-disclosure-tabindex", current);
        }
        el.setAttribute("tabindex", "-1");
      }
    });
  }, [isOpen]);

  const handleToggle = () => {
    const newState = !isOpen;
    setIsOpen(newState);

    // Fire haptic feedback
    haptics.tap();

    // Persist state (async, but we don't wait for it)
    saveDisclosureState(id, newState ? "open" : "closed");
  };

  // Clone children to inject aria-hidden when collapsed
  const enhancedChildren = isValidElement(children)
    ? cloneElement(children, {
        "aria-hidden": isOpen ? "false" : "true",
      } as Record<string, unknown>)
    : children;

  return (
    <div className="disclosure">
      <button
        type="button"
        onClick={handleToggle}
        aria-expanded={isOpen}
        aria-controls={contentId}
        className="w-full flex items-center justify-between gap-3 text-left font-semibold text-lg mb-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green active:scale-[0.98] transition-transform"
      >
        <span>{title}</span>
        {/* The affordance. Without it a collapsed section is indistinguishable
            from a heading with nothing under it — the behaviour was right but
            nothing on screen said the row could be opened. One chevron, drawn
            pointing right and rotated a quarter turn when open, so the two
            states are the same mark rather than two icons that have to agree.
            aria-hidden: the button's accessible name stays the title, and
            aria-expanded already tells a screen reader the state. */}
        <svg
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable="false"
          className="disclosure-chevron h-4 w-4 shrink-0 text-ink-secondary"
          style={{
            transform: isOpen ? "rotate(90deg)" : "rotate(0deg)",
            transitionProperty: "transform",
            // Tokens, not literals — reduced motion zeroes these at :root, so
            // the chevron settles instantly there without a second rule.
            transitionDuration: "var(--dur-base)",
            transitionTimingFunction: "var(--ease-standard)",
          }}
        >
          <path d="M7.5 4.5 13 10l-5.5 5.5" />
        </svg>
      </button>
      <div
        id={contentId}
        ref={contentRef}
        className="disclosure-content overflow-hidden transition-all"
        style={{
          transitionDuration: "var(--dur-base)",
          transitionTimingFunction: "var(--ease-standard)",
          maxHeight: isOpen ? "none" : "0",
          opacity: isOpen ? 1 : 0,
        }}
      >
        {enhancedChildren}
      </div>
    </div>
  );
}
