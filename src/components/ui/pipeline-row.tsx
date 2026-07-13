import type { ReactNode } from "react";
import { StatusChip, type StatusLabel } from "./status-chip";
import { formatGBP } from "@/lib/format";

// Canonical dashboard/list row (G6): customer, optional descriptor, right-
// aligned amount, status chip + relative date, and an optional action slot.
type Props = {
  customerName: string;
  descriptor?: string;
  amount?: number;
  status?: StatusLabel;
  dateLabel?: string;
  action?: ReactNode;
};

export const PipelineRow = ({
  customerName,
  descriptor,
  amount,
  status,
  dateLabel,
  action,
}: Props) => (
  <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface p-4">
    <div className="flex min-w-0 flex-col gap-1">
      <span className="truncate text-sm font-medium">{customerName}</span>
      {descriptor && (
        <span className="truncate text-xs text-secondary-text">
          {descriptor}
        </span>
      )}
      {(status || dateLabel) && (
        <span className="flex items-center gap-2">
          {status && <StatusChip status={status} />}
          {dateLabel && (
            <span className="text-xs text-secondary-text">{dateLabel}</span>
          )}
        </span>
      )}
    </div>
    <div className="flex shrink-0 flex-col items-end gap-1">
      {amount !== undefined && (
        <span className="tabular-nums text-sm font-semibold">
          {formatGBP(amount)}
        </span>
      )}
      {action}
    </div>
  </div>
);
