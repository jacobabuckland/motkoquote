// Single status vocabulary + colour taxonomy for quotes, contracts and
// invoices, used identically on internal and customer-facing pages.
//
// STATE IS COLOUR. There are no grey "everything" badges any more — a chip's
// colour tells the contractor whose move it is before they read the word:
//
//   green    a positive milestone or a settled job
//   amber    the contractor owes an action — and NOTHING else in the product
//            is amber, so it always means "your move"
//   neutral  waiting on the customer, or inert history. Deliberately quiet:
//            nothing here should pull the eye.
//   red      a dead end — declined or expired
//
// Terminal states (Paid, Signed) additionally render as a ruled stamp rather
// than a soft chip: the stamped-and-dated authority of a document that means
// money. The stamp is not rotated — that was tried and read as a sticker.

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
  | "Expired"
  | "Archived";

type Tone = "neutral" | "green" | "amber" | "red";

const toneOf: Record<StatusLabel, Tone> = {
  // Your move — the contractor has to do something.
  Draft: "amber",
  Overdue: "amber",
  // Positive milestones and settled work.
  Accepted: "green",
  Signed: "green",
  Paid: "green",
  // Waiting on the customer, or inert. Nothing needs the contractor.
  Sent: "neutral",
  Viewed: "neutral",
  "Awaiting payment": "neutral",
  "Awaiting signature": "neutral",
  Archived: "neutral",
  // Dead ends.
  Declined: "red",
  Expired: "red",
};

const chipClasses: Record<Tone, string> = {
  neutral: "bg-card-hover text-ink-secondary",
  green: "bg-green-tint text-green",
  amber: "bg-amber-tint text-amber",
  red: "bg-red-tint text-red",
};

const stampColour: Record<Tone, string> = {
  neutral: "text-ink-secondary",
  green: "text-green",
  amber: "text-amber",
  red: "text-red",
};

// The two states that mean "this job is finished and the money is settled".
const STAMPED: ReadonlySet<StatusLabel> = new Set(["Paid", "Signed"]);

export const StatusChip = ({ status }: { status: StatusLabel }) => {
  const tone = toneOf[status];

  if (STAMPED.has(status)) {
    return <span className={`stamp ${stampColour[tone]}`}>{status}</span>;
  }

  return (
    <span
      className={`inline-flex items-center rounded-sm px-2 py-0.5 text-xs font-semibold ${chipClasses[tone]}`}
    >
      {status}
    </span>
  );
};
