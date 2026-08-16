import type { ReactNode } from "react";
import Link from "next/link";
import { StatusChip, type StatusLabel } from "./status-chip";
import { Money } from "./money";

// The canonical list row: who it's for, what it is, what it's worth, and whose
// move it is.
//
// HIERARCHY BY STATE, NOT SAMENESS. A row the contractor has to act on carries
// an amber keyline down its leading edge; a row waiting on a customer does not.
// That single mark is what lets someone scan a screen of otherwise identical
// rows and see their own work first.
//
// The whole row is the tap target for the primary action. The name carries a
// stretched pseudo-element rather than the row being wrapped in an anchor, so
// the action slot stays independently tappable without nesting anchors — and
// the target is the full row height rather than the ~20px of the name itself.
type Props = {
  customerName: string;
  href?: string;
  descriptor?: string;
  amount?: number;
  status?: StatusLabel;
  dateLabel?: string;
  action?: ReactNode;
  /** True when this row is waiting on the CONTRACTOR. Drives the amber keyline. */
  yourMove?: boolean;
};

export const PipelineRow = ({
  customerName,
  href,
  descriptor,
  amount,
  status,
  dateLabel,
  action,
  yourMove = false,
}: Props) => (
  <div
    className={`relative flex items-center justify-between gap-3 rounded-card border border-line-strong bg-card py-3 pr-4 pl-4 transition-colors duration-150 ${
      yourMove ? "keyline-move" : ""
    } ${href ? "hover:bg-card-hover active:bg-card-hover" : ""}`}
  >
    <div className="flex min-w-0 flex-col gap-1">
      {href ? (
        <Link
          href={href}
          className="truncate text-sm font-semibold text-ink after:absolute after:inset-0 after:content-['']"
        >
          {customerName}
        </Link>
      ) : (
        <span className="truncate text-sm font-semibold text-ink">
          {customerName}
        </span>
      )}
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {status && <StatusChip status={status} />}
        {descriptor && (
          <span className="truncate text-xs text-ink-secondary">
            {descriptor}
          </span>
        )}
        {dateLabel && (
          <span className="truncate text-xs text-ink-muted">{dateLabel}</span>
        )}
      </span>
    </div>
    <div className="relative z-10 flex shrink-0 flex-col items-end gap-1">
      {amount !== undefined && <Money amount={amount} />}
      {action}
    </div>
  </div>
);
