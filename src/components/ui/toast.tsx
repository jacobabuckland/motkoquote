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

/**
 * An optional control inside the toast — Undo, in practice.
 *
 * It exists because an optimistic action needs somewhere to be taken back, and
 * the toast is the only thing on screen that knows the action just happened.
 * Keep these rare: a toast with a button is a modal decision with a timer on
 * it, which is the right shape for "undo that" and the wrong shape for
 * anything the user must not miss.
 */
type ToastAction = { label: string; onClick: () => void };

type Toast = {
  id: number;
  message: string;
  action?: ToastAction;
  /** Held so a toast can be dismissed early — by its own action firing. */
  timer?: ReturnType<typeof setTimeout>;
};

type ToastOptions = {
  action?: ToastAction;
  /** Defaults to DEFAULT_TOAST_MS. Longer only where there is something to do. */
  durationMs?: number;
};

const DEFAULT_TOAST_MS = 3000;

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

const ToastContext = createContext<
  ((message: string, options?: ToastOptions) => void) | null
>(null);

export const useToast = () => {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
};

export const ToastProvider = ({ children }: { children: ReactNode }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => {
      const going = prev.find((t) => t.id === id);
      if (going?.timer) clearTimeout(going.timer);
      return prev.filter((t) => t.id !== id);
    });
  }, []);

  const toast = useCallback((message: string, options?: ToastOptions) => {
    const id = Date.now() + Math.random();
    const timer = setTimeout(
      () => setToasts((prev) => prev.filter((t) => t.id !== id)),
      options?.durationMs ?? DEFAULT_TOAST_MS,
    );
    setToasts((prev) => [...prev, { id, message, action: options?.action, timer }]);
  }, []);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className={TOAST_LAYER_CLASS} aria-live="polite" data-testid="toast-layer">
        {toasts.map((t) => (
          <div
            key={t.id}
            // pointer-events-auto ONLY on a bubble carrying an action. The
            // layer stays inert (see TOAST_LAYER_CLASS) because a toast that
            // swallows taps meant for the page underneath is the defect that
            // moved this thing to the top of the screen in the first place. A
            // bubble with a button has to catch its own taps or the button
            // cannot be pressed, so it opts in — and only it does.
            className={
              t.action ? `${TOAST_BUBBLE_CLASS} pointer-events-auto` : TOAST_BUBBLE_CLASS
            }
          >
            {t.action ? (
              <span className="flex items-center gap-4">
                <span>{t.message}</span>
                <button
                  type="button"
                  onClick={() => {
                    // Dismissed first: the action is a decision, and leaving
                    // its toast up afterwards invites a second press against a
                    // state that has already changed back.
                    dismiss(t.id);
                    t.action?.onClick();
                  }}
                  className="shrink-0 font-semibold underline underline-offset-2"
                >
                  {t.action.label}
                </button>
              </span>
            ) : (
              t.message
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};
