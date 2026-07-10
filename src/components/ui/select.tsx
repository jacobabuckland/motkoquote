import { useId, type SelectHTMLAttributes } from "react";

type Props = SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
};

export const Select = ({ label, id, className = "", children, ...props }: Props) => {
  const generatedId = useId();
  const selectId = id ?? generatedId;

  return (
    <label htmlFor={selectId} className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-text-secondary">{label}</span>
      <select
        id={selectId}
        className={`h-11 rounded-control border border-border bg-surface px-3 text-sm text-foreground ${className}`}
        {...props}
      >
        {children}
      </select>
    </label>
  );
};
