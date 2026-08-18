import type { ButtonHTMLAttributes } from "react";
import * as haptics from "@/lib/haptics";

// Three action variants + the InlineLink primitive for navigation (G3):
//  - primary:   the single most important action on a screen
//  - secondary: any other real, clickable action
//  - tertiary:  low-emphasis ghost action ("+ Add", mode toggles)
type Variant = "primary" | "secondary" | "tertiary";

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-busy'> & {
  variant?: Variant;
  loading?: boolean;
  success?: boolean;
};

// h-11 is the 44pt floor. Every variant carries BOTH a press scale and a press
// fill: on touch there is no hover, so a colour change that only fires on
// :hover is no feedback at all — it just sticks after the tap.
const base =
  "inline-flex items-center justify-center gap-2 rounded-sm h-11 text-sm font-semibold transition-colors duration-150 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green";

const variantClasses: Record<Variant, string> = {
  primary:
    "bg-green text-white hover:bg-green-hover active:bg-green-hover px-4",
  secondary:
    "border border-line-strong bg-card text-ink hover:bg-card-hover active:bg-card-hover px-4",
  tertiary:
    "text-ink-secondary hover:text-ink hover:bg-card-hover active:bg-card-hover px-3",
};

// Exported so non-<button> elements (e.g. next/link) can share the exact
// same visual treatment as a real button.
export const buttonClass = (variant: Variant = "primary", className = "") =>
  `${base} ${variantClasses[variant]} ${className}`;

const Spinner = () => (
  <svg
    role="status"
    className="spinner inline-block h-4 w-4 animate-spin"
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <circle
      className="opacity-25"
      cx="12"
      cy="12"
      r="10"
      stroke="currentColor"
      strokeWidth="4"
    />
    <path
      className="opacity-75"
      fill="currentColor"
      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
    />
  </svg>
);

const CheckMark = () => (
  <svg
    className="check inline-block h-4 w-4"
    aria-label="check"
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M20 6L9 17l-5-5"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const Button = ({
  variant = "primary",
  className = "",
  loading,
  success,
  onClick,
  children,
  ...props
}: Props) => {
  // Legacy path: when neither loading nor success is passed, render byte-identical DOM
  if (!loading && !success) {
    const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
      if (variant === "primary") {
        haptics.tap();
      }
      onClick?.(e);
    };

    return (
      <button
        className={buttonClass(variant, className)}
        onClick={handleClick}
        {...props}
      >
        {children}
      </button>
    );
  }

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    // Prevent clicks when loading
    if (loading) {
      e.preventDefault();
      return;
    }
    if (variant === "primary") {
      haptics.tap();
    }
    onClick?.(e);
  };

  // Loading wins when both loading and success are true
  const showLoading = loading;
  const showSuccess = success && !loading;

  return (
    <button
      className={`${buttonClass(variant, className)} ${
        showSuccess ? "button-success" : ""
      } ${showLoading ? "pointer-events-none" : ""} relative`}
      onClick={handleClick}
      {...props}
      aria-busy={loading || undefined}
    >
      {/* Always render children to preserve width */}
      <span
        className={`inline-flex items-center justify-center gap-2 ${
          showLoading || showSuccess ? "opacity-0" : ""
        }`}
      >
        {children}
      </span>
      {/* Absolutely positioned spinner/check overlays */}
      {showLoading && (
        <span className="absolute inset-0 inline-flex items-center justify-center">
          <Spinner />
        </span>
      )}
      {showSuccess && (
        <span className="absolute inset-0 inline-flex items-center justify-center">
          <CheckMark />
        </span>
      )}
    </button>
  );
};
