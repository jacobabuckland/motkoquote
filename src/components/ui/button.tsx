import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "destructive" | "quiet";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
};

const base =
  "inline-flex items-center justify-center gap-2 rounded-sm h-11 text-sm font-semibold transition duration-150 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none";

const variantClasses: Record<Variant, string> = {
  primary: "bg-primary text-white hover:bg-primary-hover px-4",
  secondary:
    "border border-border bg-surface text-foreground hover:bg-surface-hover px-4",
  destructive: "border border-error text-error hover:bg-error-bg px-4",
  quiet:
    "text-secondary-text hover:text-foreground underline underline-offset-4 decoration-border hover:decoration-current px-1 active:scale-100",
};

// Exported so non-<button> elements (e.g. next/link) can share the exact
// same visual treatment as a real button.
export const buttonClass = (variant: Variant = "primary", className = "") =>
  `${base} ${variantClasses[variant]} ${className}`;

export const Button = ({
  variant = "primary",
  className = "",
  ...props
}: Props) => <button className={buttonClass(variant, className)} {...props} />;
