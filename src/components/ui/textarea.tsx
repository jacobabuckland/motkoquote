import { useId, type TextareaHTMLAttributes } from "react";

type Props = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: string;
  error?: string;
  hint?: string;
};

export const Textarea = ({
  label,
  error,
  hint,
  id,
  className = "",
  ...props
}: Props) => {
  const generatedId = useId();
  const textareaId = id ?? generatedId;

  return (
    <label htmlFor={textareaId} className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-text-secondary">{label}</span>
      <textarea
        id={textareaId}
        aria-invalid={Boolean(error)}
        className={`min-h-20 rounded-control border bg-surface px-3 py-2 text-sm text-foreground ${
          error ? "border-error" : "border-border"
        } ${className}`}
        {...props}
      />
      {error && <span className="text-xs text-error">{error}</span>}
      {!error && hint && <span className="text-xs text-text-muted">{hint}</span>}
    </label>
  );
};
