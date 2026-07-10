import { useId, type InputHTMLAttributes } from "react";

type Props = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  error?: string;
  hint?: string;
};

export const Input = ({
  label,
  error,
  hint,
  id,
  className = "",
  ...props
}: Props) => {
  const generatedId = useId();
  const inputId = id ?? generatedId;

  return (
    <label htmlFor={inputId} className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-text-secondary">{label}</span>
      <input
        id={inputId}
        aria-invalid={Boolean(error)}
        className={`h-11 rounded-control border bg-surface px-3 text-sm text-foreground ${
          error ? "border-error" : "border-border"
        } ${className}`}
        {...props}
      />
      {error && <span className="text-xs text-error">{error}</span>}
      {!error && hint && <span className="text-xs text-text-muted">{hint}</span>}
    </label>
  );
};
