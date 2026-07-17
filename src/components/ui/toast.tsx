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
      <div
        className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex flex-col items-center gap-2 pb-safe"
        aria-live="polite"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className="rounded-md bg-foreground px-4 py-2 text-sm text-white shadow-hover motion-safe:animate-[toast-in_150ms_ease-out]"
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};
