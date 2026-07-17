import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

// The one error state used everywhere data can fail to load — route error
// boundaries, failed client fetches, anywhere. Deliberately never renders the
// raw error object or a stack trace to the user; the message is plain English
// and there's always a way forward (retry, or a caller-supplied action).
export const ErrorState = ({
  title = "That didn't load",
  description = "Something went wrong at our end. Give it another go.",
  onRetry,
  action,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
  action?: ReactNode;
}) => (
  <div className="flex flex-col items-center gap-3 rounded-card border border-dashed border-border p-8 text-center">
    <p className="text-sm font-medium text-foreground">{title}</p>
    <p className="text-sm text-text-secondary">{description}</p>
    {onRetry && (
      <Button type="button" variant="secondary" onClick={onRetry}>
        Try again
      </Button>
    )}
    {action}
  </div>
);
