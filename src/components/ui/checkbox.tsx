import { useId, type InputHTMLAttributes, type ReactNode } from "react";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  label: ReactNode;
};

// Wrapping label gives a ≥44px touch row; the box itself is 20px for hit accuracy.
export const Checkbox = ({ label, id, className = "", ...props }: Props) => {
  const generatedId = useId();
  const checkboxId = id ?? generatedId;

  return (
    <label
      htmlFor={checkboxId}
      className="flex cursor-pointer items-start gap-3 py-2 text-sm"
    >
      <input
        id={checkboxId}
        type="checkbox"
        className={`mt-0.5 h-5 w-5 shrink-0 accent-accent ${className}`}
        {...props}
      />
      <span className="text-foreground">{label}</span>
    </label>
  );
};
