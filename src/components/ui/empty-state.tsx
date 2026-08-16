import type { ReactNode } from "react";

// An empty state is an invitation, not a void. It is a real surface with the
// same treatment as any other card — no dashed borders anywhere in the
// product — and it speaks in the product's voice about what will appear here,
// rather than announcing that nothing has.
//
// Left-aligned on purpose: centred text in a dashed box reads as an error.
export const EmptyState = ({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) => (
  <div className="flex flex-col items-start gap-1.5 rounded-card border border-line bg-card px-4 py-5">
    <p className="text-sm font-semibold text-ink">{title}</p>
    {description && (
      <p className="max-w-prose text-sm text-ink-secondary">{description}</p>
    )}
    {action && <div className="mt-1.5">{action}</div>}
  </div>
);
