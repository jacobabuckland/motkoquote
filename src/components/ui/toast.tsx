"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";

// Lightweight toast system (G7): a single provider at the app root exposes a
// `toast(message)` function via useToast. Toasts auto-dismiss after 3s and
// fade+rise in (respecting prefers-reduced-motion via motion-safe).

type Toast = { id: number; message: string };

/**
 * Where every toast in the app is painted.
 *
 * **Top-anchored, and that is the fix.** It used to be `bottom-6`, pinned
 * full-width to the foot of the viewport. On Settings the "What to notify me
 * about" checkbox list occupies exactly that region, so a confirmation landed
 * on top of the controls the user had opened that section to reach — and it
 * lands *because* they acted there, so it is guaranteed to cover the control
 * they are working with at the moment they are working with it. Worst on the
 * notification section, where a failure fires a toast on every retry.
 *
 * `pointer-events-none` meant taps still reached the checkboxes underneath, so
 * this obscured rather than blocked. Obscuring a control you can still hit
 * blind is a defect all the same.
 *
 * The ticket's own first suggestion was to reserve bottom padding on scrollable
 * content instead. Rejected: it needs every page to cooperate, so it is true
 * only on the pages someone remembered to pad and silently false on the next
 * one added; it costs permanent height on the `flex-1` full-height screens; and
 * it is worst in landscape, where there is least room to give away.
 *
 * Anchoring to the top needs no per-page cooperation and cannot be defeated by
 * a screen nobody thought about. It competes with the header — non-interactive
 * text and a sign-out button — rather than with form controls, it is never
 * behind the keyboard, and stacked toasts grow down over the header rather than
 * further up the form. It is also what the platform itself does with banners.
 *
 * `pt-safe` rather than `pb-safe`: at the top the thing to clear is the notch,
 * not the home indicator. `z-50` keeps it above the status-bar backdrop, which
 * sits at `z-40` deliberately.
 *
 * Exported because share-link-button paints its own toast and the two used to
 * share a copied class string. One definition, so they cannot drift.
 */
export const TOAST_LAYER_CLASS =
  "pointer-events-none fixed inset-x-0 top-0 z-50 flex flex-col items-center gap-2 pt-safe";

/** The toast bubble itself. Shared for the same reason as the layer. */
export const TOAST_BUBBLE_CLASS =
  "rounded-md bg-foreground px-4 py-2 text-sm text-white shadow-hover motion-safe:animate-[toast-in_150ms_ease-out]";

const ToastContext = createContext<((message: string) => void) | null>(null);

export const useToast = () => {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
};

export const ToastProvider = ({ children }: { children: ReactNode }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((message: string) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message }]);
    setTimeout(
      () => setToasts((prev) => prev.filter((t) => t.id !== id)),
      3000,
    );
  }, []);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className={TOAST_LAYER_CLASS} aria-live="polite" data-testid="toast-layer">
        {toasts.map((t) => (
          <div key={t.id} className={TOAST_BUBBLE_CLASS}>
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};
