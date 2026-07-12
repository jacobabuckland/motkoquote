import Link from "next/link";
import type { ReactNode } from "react";

type Props = {
  backHref?: string;
  backLabel?: string;
  title?: ReactNode;
  action?: ReactNode;
};

// One canonical top bar for screens that aren't inside the authenticated AppHeader
// (e.g. a back link on the new-quote and job-detail flows).
export const PageHeader = ({
  backHref,
  backLabel = "Back",
  title,
  action,
}: Props) => (
  <header className="border-b border-border">
    <div className="mx-auto flex w-full max-w-2xl items-center justify-between gap-3 px-6 py-4">
      <div className="flex items-center gap-3">
        {backHref && (
          <Link
            href={backHref}
            className="text-sm text-text-secondary hover:text-foreground"
          >
            ← {backLabel}
          </Link>
        )}
        {title && <span className="text-sm font-semibold">{title}</span>}
      </div>
      {action}
    </div>
  </header>
);
