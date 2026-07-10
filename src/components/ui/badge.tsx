import type { ReactNode } from "react";

type Tone = "neutral" | "success" | "warning" | "error";

const toneClasses: Record<Tone, string> = {
  neutral: "bg-stone-100 text-text-secondary",
  success: "bg-success-bg text-success",
  warning: "bg-warning-bg text-warning",
  error: "bg-error-bg text-error",
};

export const Badge = ({
  tone = "neutral",
  children,
}: {
  tone?: Tone;
  children: ReactNode;
}) => (
  <span
    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${toneClasses[tone]}`}
  >
    {children}
  </span>
);
