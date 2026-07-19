import type { Stage } from "@/lib/job-stages";
import { PipelineStepper } from "@/components/ui/pipeline-stepper";

// The "where in the process" document from the real job page (/jobs/[id]):
// the five-stage pipeline that shows, at a glance, exactly whose move it is.
// Rendered with the same PipelineStepper the app ships, over a representative
// snapshot of stages — not a screenshot.
const STAGES: Stage[] = [
  { key: "quote_sent", label: "Quote sent", state: "complete", date: "2026-07-19" },
  { key: "accepted", label: "Accepted", state: "complete", date: "2026-07-19" },
  { key: "contract_signed", label: "Contract signed", state: "future", date: null },
  { key: "invoiced", label: "Invoiced", state: "complete", date: "2026-07-19" },
  { key: "paid", label: "Paid", state: "current", date: null },
];

export function ProcessCard() {
  return (
    <div className="rounded-[16px] border border-[color:var(--hairline)] bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
      <PipelineStepper stages={STAGES} />
    </div>
  );
}
