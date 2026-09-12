import type { TimelineRow } from "@/lib/job-timeline";
import { formatDate } from "@/lib/format";

/*
  The timeline, read top to bottom.

  It was a horizontal row of dots, which works while there are four of them and
  stops working on a phone. Vertical rows give each step a full line: a marker,
  a label, and the one fact that matters on the right — the date it happened,
  or, on the step still open, what it is waiting for.

  THE CURRENT STEP IS AMBER AND THE COMPLETED ONES ARE GREEN. That is the
  product's colour rule and not a local choice: green is done, amber is your
  move. The old stepper painted the current step in a pale green that read as
  "complete-ish", which is precisely the question a contractor opens this
  screen to answer.
*/

const markerClasses: Record<TimelineRow["state"], string> = {
  complete: "border-green bg-green text-white",
  current: "border-amber bg-amber text-white",
  future: "border-line-strong bg-card",
  declined: "border-red bg-red text-white",
  // Marked complete for monotonicity rather than actually reached — shown as
  // reached but hollow, so it cannot be mistaken for either.
  forced: "border-green bg-card text-green",
};

const labelClasses: Record<TimelineRow["state"], string> = {
  complete: "text-ink",
  current: "font-semibold text-amber-ink",
  future: "text-ink-secondary",
  declined: "font-semibold text-red",
  forced: "text-ink",
};

const Marker = ({ state }: { state: TimelineRow["state"] }) => (
  <span
    aria-hidden
    className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-pill border text-xs ${markerClasses[state]}`}
  >
    {state === "complete" ? (
      "✓"
    ) : state === "declined" ? (
      "✕"
    ) : state === "forced" ? (
      "–"
    ) : state === "current" ? (
      // A white centre, so the current step reads as a target rather than as
      // another completed tick.
      <span className="h-[7px] w-[7px] rounded-pill bg-card" />
    ) : null}
  </span>
);

export const JobTimeline = ({ rows }: { rows: TimelineRow[] }) => (
  <ol className="flex flex-col gap-3.5">
    {rows.map((row) => (
      <li key={row.key} className="flex items-center gap-3">
        <Marker state={row.state} />
        <span className={`flex-1 text-sm ${labelClasses[row.state]}`}>
          {row.label}
        </span>
        {row.requirement ? (
          <span className="shrink-0 text-sm font-semibold text-amber-ink">
            {row.requirement}
          </span>
        ) : row.date ? (
          <span className="shrink-0 font-mono text-xs text-ink-secondary">
            {formatDate(row.date)}
          </span>
        ) : null}
      </li>
    ))}
  </ol>
);
