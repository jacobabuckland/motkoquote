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
    {/* The top bar is the first thing under the notch. The viewport is
        `viewportFit: "cover"` (root layout), so without a top inset the bar's
        contents — the Sign in link most visibly — sit underneath the iOS
        status bar and can't be tapped. The max() keeps the normal 1rem padding
        off-notch.

        This comment used to end: "where the shell already insets the web view
        env(safe-area-inset-top) resolves to 0, so this never double-insets."
        That was false, and it is why the bug below went unnoticed through
        several audits — it reads as a settled question. `viewportFit: "cover"`
        is exactly what stops env() collapsing inside an inset web view, so the
        shell's inset and this padding both applied. Measured doubled, to the
        pixel, on an iPhone 16 Pro.

        --safe-top is that inset as one token: the real value on the web, zero
        inside the Capacitor shell. See globals.css for the measurement and for
        why this is not fixed in capacitor.config.ts. */}
    <div className="mx-auto flex w-full max-w-2xl items-center justify-between gap-3 px-6 pb-4 pt-[max(1rem,var(--safe-top))]">
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
