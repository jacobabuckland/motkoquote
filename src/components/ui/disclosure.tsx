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
  // On web, load synchronously to avoid flash. On native, this returns null and the
  // async useEffect below will load from Capacitor Preferences.
  const [isOpen, setIsOpen] = useState(() => {
    const syncState = loadDisclosureStateSync(id);
    return syncState !== null ? syncState === "open" : defaultOpen;
  });
  const contentId = `${id}-content`;
  const contentRef = useRef<HTMLDivElement>(null);

  // Load stored preference after mount (post-hydration) for native platforms.
  // On web, the sync loader above already handled it, so this is a no-op.
  useEffect(() => {
    // Use async function to support Capacitor Preferences on native platforms
    loadDisclosureState(id).then((storedState) => {
      if (storedState !== null) {
        setIsOpen(storedState === "open");
      }
    });
  }, [id]);

  // Auto-expand if URL hash points to an element inside this disclosure
  useEffect(() => {
    if (!contentRef.current || !window.location.hash) return;

    const hash = window.location.hash.slice(1); // Remove '#'
    const target = document.getElementById(hash);

    if (target && contentRef.current.contains(target)) {
      // Expand without persisting the state change
      setIsOpen(true);
    }
  }, []);

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
        className="w-full text-left font-semibold text-lg mb-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green active:scale-[0.98] transition-transform"
      >
        {title}
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
