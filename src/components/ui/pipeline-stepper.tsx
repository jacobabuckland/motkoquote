import type { Stage } from "@/lib/job-stages";
import { formatDate } from "@/lib/format";

// A job's five stages, laid out as a vertical list on mobile and an even
// horizontal row on wider screens. The states are made visually distinct so
// "done" never reads the same as "waiting on this now":
//   complete → solid green dot + tick (+ date)
//   current  → accent-ringed dot with a filled centre and an "In progress"
//              caption, so the active stage can't be mistaken for an empty
//              future circle
//   future   → plain muted grey outline, empty
//   declined → solid red dot + cross so the pipeline visibly stops there
const dotClasses: Record<Stage["state"], string> = {
  complete: "border-primary bg-primary text-white",
  current: "border-primary bg-primary/10 text-primary ring-2 ring-primary/20",
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
          {stage.state === "complete" ? (
            "✓"
          ) : stage.state === "declined" ? (
            "✕"
          ) : stage.state === "current" ? (
            <span className="h-2 w-2 rounded-full bg-primary" />
          ) : (
            ""
          )}
        </span>
        <div className="flex flex-col sm:items-center">
          <span className={`text-sm ${labelClasses[stage.state]}`}>{stage.label}</span>
          {stage.state === "complete" && stage.date && (
            <span className="text-xs text-text-muted">{formatDate(stage.date)}</span>
          )}
          {stage.state === "current" && (
            <span className="text-xs text-primary">In progress</span>
          )}
        </div>
      </li>
    ))}
  </ol>
);
