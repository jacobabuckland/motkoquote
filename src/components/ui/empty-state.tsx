import type { ReactNode } from "react";

export const EmptyState = ({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) => (
  <div className="flex flex-col items-center gap-2 rounded-card border border-dashed border-border p-8 text-center">
    <p className="text-sm font-medium text-foreground">{title}</p>
    {description && <p className="text-sm text-text-secondary">{description}</p>}
    {action}
  </div>
);
