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
  <div className="flex flex-col items-start gap-1.5 rounded-card border border-line bg-card px-4 py-5">
    <p className="text-sm font-semibold text-ink">{title}</p>
    <p className="max-w-prose text-sm text-ink-secondary">{description}</p>
    {onRetry && (
      <Button
        type="button"
        variant="secondary"
        onClick={onRetry}
        className="mt-1.5"
      >
        Try again
      </Button>
    )}
    {action}
  </div>
);
