import type { Stage } from "@/lib/job-stages";
import { formatDate } from "@/lib/format";

// A job's five stages, laid out as a vertical list on mobile and an even
// horizontal row on wider screens. Completed stages show a tick + date, the
// current stage is brand-highlighted and bold, future stages are muted, and a
// declined stage shows a red marker so the pipeline visibly stops there.
const dotClasses: Record<Stage["state"], string> = {
  complete: "border-primary bg-primary text-white",
  current: "border-primary bg-surface text-primary",
  future: "border-border bg-surface text-text-muted",
  declined: "border-error bg-error text-white",
};

const labelClasses: Record<Stage["state"], string> = {
  complete: "text-foreground",
  current: "font-semibold text-primary",
  future: "text-text-muted",
  declined: "font-semibold text-error",
};

export const PipelineStepper = ({ stages }: { stages: Stage[] }) => (
  <ol className="flex flex-col gap-3 sm:flex-row sm:gap-2">
    {stages.map((stage) => (
      <li
        key={stage.key}
        className="flex items-center gap-3 sm:flex-1 sm:flex-col sm:items-center sm:text-center"
      >
        <span
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs ${dotClasses[stage.state]}`}
          aria-hidden
        >
          {stage.state === "complete" ? "✓" : stage.state === "declined" ? "✕" : ""}
        </span>
        <div className="flex flex-col sm:items-center">
          <span className={`text-sm ${labelClasses[stage.state]}`}>{stage.label}</span>
          {stage.state === "complete" && stage.date && (
            <span className="text-xs text-text-muted">{formatDate(stage.date)}</span>
          )}
        </div>
      </li>
    ))}
  </ol>
);
