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
  | "Work complete"
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
  "Work complete": "green",
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

/*
  A glyph as well as a colour, so the chip survives a bright screen, a
  greyscale print and colour blindness — the three conditions this product is
  actually used in. Keyed on TONE rather than on the label, because the tone is
  already the thing that carries meaning here and a per-label table would drift
  from it the first time a label is added.

    ✓  green   — done, settled
    ●  amber   — your move: a filled mark, because it is asking for something
    ○  neutral — waiting on someone else: the same shape, unfilled, because it
                 is the same kind of fact without the demand
    !  red     — a dead end
*/
const glyphOf: Record<Tone, string> = {
  green: "✓",
  amber: "●",
  neutral: "○",
  red: "!",
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
      className={`inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-xs font-semibold ${chipClasses[tone]}`}
    >
      <span aria-hidden>{glyphOf[tone]}</span>
      {status}
    </span>
  );
};
