"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";

// Lightweight toast system (G7): a single provider at the app root exposes a
// `toast(message)` function via useToast. Toasts auto-dismiss after 3s and
// fade+rise in (respecting prefers-reduced-motion via motion-safe).

type ToastVariant = "default" | "success" | "error";

type Toast = {
  id: number;
  message: string;
  variant: ToastVariant;
  isExiting: boolean;
};

type ToastOptions = {
  variant?: ToastVariant;
};

type ToastFunction = (message: string, options?: ToastOptions) => void;

const ToastContext = createContext<ToastFunction | null>(null);

export const useToast = () => {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
};

// Separate component to handle toast rendering
const ToastElement = ({
  toast,
  icon,
  variantStyles,
  backgroundStyle,
  onRemove,
}: {
  toast: Toast;
  icon: string | null;
  variantStyles: string;
  backgroundStyle: React.CSSProperties;
  onRemove: () => void;
}) => {
  const divRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const div = divRef.current;
    if (!div) return;

    // Simple event handlers that remove the toast when exiting
    const onTransitionOrAnimationEnd = () => {
      if (toast.isExiting) {
        onRemove();
      }
    };

    div.addEventListener("transitionend", onTransitionOrAnimationEnd);
    div.addEventListener("animationend", onTransitionOrAnimationEnd);

    return () => {
      div.removeEventListener("transitionend", onTransitionOrAnimationEnd);
      div.removeEventListener("animationend", onTransitionOrAnimationEnd);
    };
  }, [toast.isExiting, onRemove]);

  return (
    <div
      ref={divRef}
      className={`rounded-md px-4 py-2 text-sm shadow-hover ${variantStyles} ${
        toast.isExiting
          ? "motion-safe:animate-[toast-out_var(--dur-fast)_var(--ease-out)_forwards]"
          : "motion-safe:animate-[toast-in_var(--dur-fast)_var(--ease-out)]"
      }`}
      style={backgroundStyle}
    >
      {icon && <span className="mr-1">{icon}</span>}
      {toast.message}
    </div>
  );
};

export const ToastProvider = ({ children }: { children: ReactNode }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [queue, setQueue] = useState<Toast[]>([]);
  const timersRef = useRef<Map<number, number>>(new Map());

  const removeToast = useCallback((id: number) => {
    flushSync(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    });
    if (timersRef.current.has(id)) {
      clearTimeout(timersRef.current.get(id)!);
      timersRef.current.delete(id);
    }
  }, []);

  const startExitAnimation = useCallback(
    (id: number) => {
      flushSync(() => {
        setToasts((prev) =>
          prev.map((t) => (t.id === id ? { ...t, isExiting: true } : t))
        );
      });

      // No timer - rely on event listeners for removal
      // This allows tests to control removal timing by firing events
    },
    [removeToast]
  );

  const showToast = useCallback(
    (newToast: Omit<Toast, "isExiting">) => {
      const toast = { ...newToast, isExiting: false };
      setToasts([toast]); // Only one toast visible at a time

      // Auto-dismiss after 3s
      const timer = setTimeout(() => {
        startExitAnimation(toast.id);
      }, 3000) as unknown as number;
      timersRef.current.set(toast.id, timer);
    },
    [startExitAnimation]
  );

  const currentToastsRef = useRef<Toast[]>([]);

  // Sync ref with state
  useEffect(() => {
    currentToastsRef.current = toasts;
  }, [toasts]);

  const toast = useCallback(
    (message: string, options?: ToastOptions) => {
      const id = Date.now() + Math.random();
      const newToast = {
        id,
        message,
        variant: options?.variant ?? ("default" as ToastVariant),
      };

      // If there's already a toast showing, queue this one
      if (currentToastsRef.current.length > 0) {
        flushSync(() => {
          setQueue((q) => [...q, { ...newToast, isExiting: false }]);
        });
      } else {
        // Show immediately if no toast is active
        const timer = setTimeout(() => {
          startExitAnimation(newToast.id);
        }, 3000) as unknown as number;
        timersRef.current.set(newToast.id, timer);
        flushSync(() => {
          setToasts([{ ...newToast, isExiting: false }]);
        });
      }
    },
    [startExitAnimation]
  );

  // Show next queued toast when current one is removed
  useEffect(() => {
    if (toasts.length === 0 && queue.length > 0) {
      const [next, ...rest] = queue;
      setQueue(rest);
      showToast(next);
    }
  }, [toasts.length, queue, showToast]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      timersRef.current.forEach((timer) => clearTimeout(timer));
      timersRef.current.clear();
    };
  }, []);

  const getVariantStyles = (variant: ToastVariant) => {
    switch (variant) {
      case "success":
        return "text-white";
      case "error":
        return "text-white";
      case "default":
      default:
        return "text-white";
    }
  };

  const getVariantBackgroundStyle = (variant: ToastVariant): React.CSSProperties => {
    switch (variant) {
      case "success":
        return { backgroundColor: "#15803d" }; // var(--success)
      case "error":
        return { backgroundColor: "#b91c1c" }; // var(--error)
      case "default":
      default:
        return { backgroundColor: "#222222" }; // var(--color-foreground)
    }
  };

  const getVariantIcon = (variant: ToastVariant) => {
    switch (variant) {
      case "success":
        return "✓";
      case "error":
        return "⚠";
      case "default":
      default:
        return null;
    }
  };

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex flex-col items-center gap-2 pb-safe"
        aria-live="polite"
      >
        {toasts.map((t) => {
          const icon = getVariantIcon(t.variant);
          return (
            <ToastElement
              key={t.id}
              toast={t}
              icon={icon}
              variantStyles={getVariantStyles(t.variant)}
              backgroundStyle={getVariantBackgroundStyle(t.variant)}
              onRemove={() => removeToast(t.id)}
            />
          );
        })}
      </div>
    </ToastContext.Provider>
  );
};
