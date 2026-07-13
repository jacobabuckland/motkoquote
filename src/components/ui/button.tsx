import type { ButtonHTMLAttributes } from "react";

// Three action variants + the InlineLink primitive for navigation (G3):
//  - primary:   the single most important action on a screen
//  - secondary: any other real, clickable action
//  - tertiary:  low-emphasis ghost action ("+ Add", mode toggles)
type Variant = "primary" | "secondary" | "tertiary";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
};

const base =
  "inline-flex items-center justify-center gap-2 rounded-sm h-11 text-sm font-semibold transition duration-150 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

const variantClasses: Record<Variant, string> = {
  primary: "bg-primary text-white hover:bg-primary-hover px-4",
  secondary:
    "border border-border bg-surface text-foreground hover:bg-surface-hover px-4",
  tertiary:
    "text-secondary-text hover:text-foreground hover:bg-surface-hover px-3",
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
