"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card as Surface } from "@/components/ui/card";
import { InlineLink } from "@/components/ui/inline-link";
import { Money } from "@/components/ui/money";
import { StatusChip } from "@/components/ui/status-chip";
import { formatGBP } from "@/lib/format";
import type { AssumptionSlot, AssumptionView, ConfirmCard, QuoteCard } from "@/lib/pa/types";

const ASK_PROMPT: Record<AssumptionSlot, string> = {
  pricing_mode: "How do you want this priced: fixed price, day rate, or worked out from my rates?",
  crew: "Who's on this job: just me, or ",
  materials_supply: "For materials: I'm supplying them / the customer is supplying them.",
};

const AssumptionChip = ({
  assumption,
  disabled,
  onConfirm,
  onAsk,
}: {
  assumption: AssumptionView;
  disabled: boolean;
  onConfirm: (slot: AssumptionSlot, value: string) => void;
  onAsk: (text: string) => void;
}) => {
  const { slot, label, value, confirmed } = assumption;
  const state = confirmed ? "Confirmed" : value === null ? "Not set. Tap to tell me" : "Tap to confirm";
  return (
    <button
      type="button"
      disabled={disabled || confirmed}
      onClick={() => (value === null ? onAsk(ASK_PROMPT[slot]) : onConfirm(slot, value))}
      aria-label={`${label}: ${value ?? "not set"}. ${state}`}
      className={`inline-flex min-h-11 flex-col items-start justify-center rounded-card border px-3 py-1 text-left text-sm transition-colors duration-150 ${
        confirmed
          ? "border-line-strong bg-green-tint text-green"
          : "border-line-strong bg-amber-tint text-ink"
      }`}
    >
      <span className="text-xs font-semibold">
        {confirmed ? "✓ " : "● "}
        {label}
      </span>
      <span>{value ?? "Not set"}</span>
      {!confirmed && <span className="text-xs text-ink-secondary">{state}</span>}
    </button>
  );
};

// What can be changed on a draft, as things to tap rather than a blank box. Each
// one starts the sentence for the contractor and leaves the cursor where the
// answer goes. These all map onto tools that already exist (update_quote and
// set_assumption), so nothing here promises something chat cannot do.
const CHANGES: { label: string; start: (who: string) => string }[] = [
  { label: "Price", start: (who) => `On the ${who} quote: make the price £` },
  { label: "Customer details", start: (who) => `On the ${who} quote: the customer's email is ` },
  { label: "Add a line", start: (who) => `On the ${who} quote: add a line for ` },
  { label: "Remove a line", start: (who) => `On the ${who} quote: remove line ` },
];

const DraftActions = ({
  card,
  busy,
  onSend,
  onAsk,
}: {
  card: QuoteCard;
  busy: boolean;
  onSend: (jobId: string) => void;
  onAsk: (text: string) => void;
}) => {
  const [changing, setChanging] = useState(false);
  const who = card.customerName ?? card.title;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Button
          disabled={busy || !card.canSend}
          onClick={() => onSend(card.jobId)}
          className="flex-1"
        >
          Send
        </Button>
        <Button
          variant="secondary"
          disabled={busy}
          aria-expanded={changing}
          onClick={() => setChanging((open) => !open)}
          className="flex-1"
        >
          Change
        </Button>
      </div>
      {changing && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="What would you like to change?">
          {CHANGES.map((change) => (
            <button
              key={change.label}
              type="button"
              disabled={busy}
              onClick={() => {
                setChanging(false);
                onAsk(change.start(who));
              }}
              className="inline-flex min-h-11 items-center rounded-card border border-line-strong px-3 text-sm text-ink"
            >
              {change.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export const QuoteCardView = ({
  card,
  busy,
  onConfirmSlot,
  onSend,
  onAsk,
}: {
  card: QuoteCard;
  busy: boolean;
  onConfirmSlot: (jobId: string, slot: AssumptionSlot, value: string) => void;
  onSend: (jobId: string) => void;
  onAsk: (text: string) => void;
}) => (
  <Surface className="flex flex-col gap-3" data-testid="quote-card">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="eyebrow">Quote</p>
        <p className="truncate text-base font-semibold text-ink">
          {card.customerName ? `${card.customerName}: ` : ""}
          {card.title}
        </p>
      </div>
      <StatusChip status={card.status} />
    </div>

    {card.lines.length > 0 ? (
      <ul className="flex flex-col gap-1 text-sm">
        {card.lines.map((line, index) => (
          <li key={index} className="flex justify-between gap-3">
            <span className="min-w-0 text-ink-secondary">
              {line.description}
              <span className="text-xs"> ({line.quantity} {line.unit})</span>
            </span>
            <span className="shrink-0">{formatGBP(line.amount)}</span>
          </li>
        ))}
        {card.moreLines > 0 && (
          <li className="text-xs text-ink-secondary">+ {card.moreLines} more</li>
        )}
      </ul>
    ) : (
      <p className="text-sm text-ink-secondary">No lines yet.</p>
    )}

    <div className="flex items-baseline justify-between gap-3 border-t border-line-strong pt-2">
      <span className="text-sm text-ink-secondary">
        Total{card.vatRegistered ? " incl. VAT" : ""}
      </span>
      <Money amount={card.total} size="total" data-testid="quote-card-total" />
    </div>

    <div className="flex flex-wrap gap-2" role="group" aria-label="What this quote assumes">
      {card.assumptions.map((assumption) => (
        <AssumptionChip
          key={assumption.slot}
          assumption={assumption}
          disabled={busy || card.status !== "Draft"}
          onConfirm={(slot, value) => onConfirmSlot(card.jobId, slot, value)}
          onAsk={onAsk}
        />
      ))}
    </div>

    {card.status === "Draft" && card.blockers.length > 0 && (
      <ul className="flex flex-col gap-1 text-sm text-amber">
        {card.blockers.map((blocker) => (
          <li key={blocker}>{blocker}</li>
        ))}
      </ul>
    )}

    {card.status === "Draft" ? (
      <DraftActions card={card} busy={busy} onSend={onSend} onAsk={onAsk} />
    ) : (
      <div className="flex flex-col gap-1 border-t border-line-strong pt-2 text-sm">
        <p className="text-ink-secondary">{card.nextStep}</p>
        <InlineLink href={`/jobs/${card.jobId}`}>Open the job</InlineLink>
      </div>
    )}
  </Surface>
);

export const ConfirmCardView = ({
  card,
  busy,
  onConfirm,
}: {
  card: ConfirmCard;
  busy: boolean;
  onConfirm: (card: ConfirmCard) => Promise<void>;
}) => {
  const [working, setWorking] = useState(false);
  const state = card.state ?? "pending";
  return (
    <Surface className="flex flex-col gap-2 border-green" data-testid="confirm-card">
      <p className="text-base font-semibold text-ink">{card.title}</p>
      <p className="text-sm text-ink-secondary">{card.summary}</p>
      {state === "pending" ? (
        <Button
          disabled={busy || working}
          onClick={async () => {
            setWorking(true);
            try {
              await onConfirm(card);
            } finally {
              setWorking(false);
            }
          }}
        >
          {working ? "Working…" : card.confirmLabel}
        </Button>
      ) : (
        <p className="text-sm font-semibold text-ink-secondary">
          {state === "done"
            ? "Done"
            : state === "refused"
              ? (card.outcomeMessage ?? "That didn't go through. Ask me again.")
              : state === "unknown"
                ? "I can't tell whether that went through. Check the job page before asking me again."
                : "Expired. Ask me again."}
        </p>
      )}
    </Surface>
  );
};
