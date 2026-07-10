import type { HTMLAttributes } from "react";

export const Card = ({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div
    className={`rounded-card border border-border bg-surface p-4 ${className}`}
    {...props}
  />
);
