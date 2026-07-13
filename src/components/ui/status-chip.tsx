// Single status vocabulary + colour taxonomy for quotes, contracts and
// invoices (G4), used identically on internal and customer-facing pages.

export type StatusLabel =
  | "Draft"
  | "Sent"
  | "Viewed"
  | "Accepted"
  | "Signed"
  | "Paid"
  | "Awaiting payment"
  | "Awaiting signature"
  | "Overdue"
  | "Declined"
  | "Expired";

type Tone = "neutral" | "info" | "success" | "warning" | "error";

const toneOf: Record<StatusLabel, Tone> = {
  Draft: "neutral",
  Sent: "info",
  Viewed: "info",
  Accepted: "success",
  Signed: "success",
  Paid: "success",
  "Awaiting payment": "warning",
  "Awaiting signature": "warning",
  Overdue: "error",
  Declined: "error",
  Expired: "error",
};

const toneClasses: Record<Tone, string> = {
  neutral: "bg-surface-hover text-secondary-text",
  info: "bg-info-bg text-info",
  success: "bg-success-bg text-success",
  warning: "bg-warning-bg text-warning",
  error: "bg-error-bg text-error",
};

export const StatusChip = ({ status }: { status: StatusLabel }) => (
  <span
    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${toneClasses[toneOf[status]]}`}
  >
    {status}
  </span>
);
