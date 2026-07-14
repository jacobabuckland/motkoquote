import type { TimelineEvent } from "@/lib/job-stages";
import { formatDate, formatRelative } from "@/lib/format";

// A simple vertical timeline of everything that has happened on a job, newest
// first. Built only from event types present in the data (see buildTimeline),
// so nothing speculative is shown. The exact timestamp is available on hover
// via the title attribute; the relative time reads at a glance.
const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

export const ActivityTimeline = ({ events }: { events: TimelineEvent[] }) => {
  if (events.length === 0) return null;

  return (
    <ol className="flex flex-col gap-3">
      {events.map((event, index) => (
        <li key={index} className="flex items-baseline gap-3">
          <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden />
          <div className="flex flex-1 flex-wrap items-baseline justify-between gap-x-3">
            <span className="text-sm">{event.label}</span>
            <span
              className="text-xs text-text-muted"
              title={`${formatDate(event.at)}, ${timeOf(event.at)}`}
            >
              {formatDate(event.at)} · {formatRelative(event.at)}
            </span>
          </div>
        </li>
      ))}
    </ol>
  );
};
