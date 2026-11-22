"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card as Surface } from "@/components/ui/card";
import { InlineLink } from "@/components/ui/inline-link";
import { Money } from "@/components/ui/money";
import { StatusChip } from "@/components/ui/status-chip";
import { PipelineStepper } from "@/components/ui/pipeline-stepper";
import { formatDate } from "@/lib/format";
import type {
  AssumptionSlot,
  AssumptionView,
  ConfirmCard,
  MoneyCard,
  ProgressCard,
  QuoteCard,
} from "@/lib/pa/types";
import { Tick } from "./chat-icons";

// Cards are the heavy things in the thread: real documents, set in the job-sheet
// language the rest of the product uses. Motko's own words stay light, so these
// are what the eye finds. A card never sits inside a bubble.

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
  // Drawn only when it flips during this visit. A chip that was already
  // confirmed when the page loaded just shows its tick.
  const [wasConfirmed] = useState(confirmed);
  const state = confirmed ? "Confirmed" : value === null ? "Not set. Tap to tell me" : "Tap to confirm";
  return (
    <button
      type="button"
      disabled={disabled || confirmed}
      onClick={() => (value === null ? onAsk(ASK_PROMPT[slot]) : onConfirm(slot, value))}
      aria-label={`${label}: ${value ?? "not set"}. ${state}`}
      className={`inline-flex min-h-11 flex-col items-start justify-center rounded-card border px-3 py-1 text-left text-sm transition-colors duration-150 active:bg-card-hover ${
        confirmed
          ? "border-line-strong bg-green-tint text-green"
          : "border-line-strong bg-amber-tint text-ink"
      }`}
    >
      <span className="flex items-center gap-1 text-xs font-semibold">
        {confirmed ? <Tick draw={!wasConfirmed} className="h-3.5 w-3.5" /> : <span aria-hidden>●</span>}
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
              className="inline-flex min-h-11 items-center rounded-card border border-line-strong bg-card px-3 text-sm text-ink transition-colors duration-150 active:bg-card-hover"
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
}) => {
  const draft = card.status === "Draft";
  return (
    // The amber keyline says it is the contractor's move: a draft is theirs to
    // check and send. Once it has gone out, the card goes quiet.
    <Surface className={`flex flex-col gap-3 ${draft ? "keyline-move" : ""}`} data-testid="quote-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow">Quote</p>
          <p className="display truncate text-lg font-bold text-ink">
            {card.customerName ?? card.title}
          </p>
          {card.customerName && (
            <p className="truncate text-sm text-ink-secondary">{card.title}</p>
          )}
        </div>
        <StatusChip status={card.status} />
      </div>

      {card.lines.length > 0 ? (
        <ul className="flex flex-col divide-y divide-line border-y border-line">
          {card.lines.map((line, index) => (
            <li key={index} className="flex items-baseline justify-between gap-3 py-2">
              <span className="min-w-0 text-sm text-ink">
                {line.description}
                <span className="text-xs text-ink-secondary">
                  {" "}
                  ({line.quantity} {line.unit})
                </span>
              </span>
              <Money amount={line.amount} className="shrink-0" />
            </li>
          ))}
          {card.moreLines > 0 && (
            <li className="py-2 text-xs text-ink-secondary">+ {card.moreLines} more</li>
          )}
        </ul>
      ) : (
        <p className="text-sm text-ink-secondary">No lines yet.</p>
      )}

      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-ink-secondary">
          Total{card.vatRegistered ? " incl. VAT" : ""}
        </span>
        <Money amount={card.total} size="total" data-testid="quote-card-total" />
      </div>

      <div className="flex flex-col gap-2">
        <p className="eyebrow">This quote assumes</p>
        <div className="flex flex-wrap gap-2" role="group" aria-label="What this quote assumes">
          {card.assumptions.map((assumption) => (
            <AssumptionChip
              key={assumption.slot}
              assumption={assumption}
              disabled={busy || !draft}
              onConfirm={(slot, value) => onConfirmSlot(card.jobId, slot, value)}
              onAsk={onAsk}
            />
          ))}
        </div>
      </div>

      {draft && card.blockers.length > 0 && (
        // Why it can't go yet. Amber-ink on the amber tint: the readable pair.
        <ul className="flex flex-col gap-1 rounded-card bg-amber-tint p-3 text-sm text-amber-ink">
          {card.blockers.map((blocker) => (
            <li key={blocker}>{blocker}</li>
          ))}
        </ul>
      )}

      {draft ? (
        <DraftActions card={card} busy={busy} onSend={onSend} onAsk={onAsk} />
      ) : (
        <div className="flex flex-col gap-1 border-t border-line pt-3 text-sm">
          <p className="text-ink-secondary">{card.nextStep}</p>
          <InlineLink href={`/jobs/${card.jobId}`}>Open the job</InlineLink>
        </div>
      )}
    </Surface>
  );
};

const amountLabel = (card: ConfirmCard): string =>
  card.action === "create_invoice"
    ? "Invoice amount"
    : card.vatIncluded
      ? "Total incl. VAT"
      : "Total";

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
  // Same rule as the assumption ticks: draw it when it happens, not when an old
  // conversation is reopened.
  const [initialState] = useState(state);
  const pending = state === "pending";
  return (
    <Surface className={`flex flex-col gap-3 ${pending ? "keyline-move" : ""}`} data-testid="confirm-card">
      <p className="eyebrow">{pending ? "Check, then confirm" : "Confirmation"}</p>
      <p className="display text-lg font-bold text-ink">{card.title}</p>

      {card.amount !== undefined ? (
        <div className="flex flex-col gap-1 border-y border-line py-3">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm text-ink-secondary">{amountLabel(card)}</span>
            <Money amount={card.amount} size="total" />
          </div>
          {card.recipient && (
            <p className="text-sm text-ink-secondary">To {card.recipient}</p>
          )}
        </div>
      ) : (
        <p className="text-sm text-ink-secondary">{card.summary}</p>
      )}

      {pending ? (
        <>
          <p className="text-sm text-ink-secondary">Nothing happens until you tap.</p>
          <Button
            disabled={busy || working}
            className="w-full"
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
        </>
      ) : state === "done" ? (
        <p className="inline-flex items-center gap-2 text-sm font-semibold text-green">
          <Tick draw={initialState !== "done"} />
          Done
        </p>
      ) : state === "refused" ? (
        <div role="status" className="rounded-card border border-red bg-red-tint p-3 text-sm text-red">
          {card.outcomeMessage ?? "That didn't go through. Ask me again."}
        </div>
      ) : state === "unknown" ? (
        <div role="status" className="rounded-card border border-line-strong bg-card-hover p-3 text-sm text-ink-secondary">
          I can&apos;t tell whether that went through. Check the job page before asking me again.
        </div>
      ) : (
        <p className="text-sm font-semibold text-ink-secondary">Expired. Ask me again.</p>
      )}
    </Surface>
  );
};

// Where a job is on the path: the job page's own stepper, so the two agree. The
// amber keyline appears only while the next move is the contractor's.
export const ProgressCardView = ({ card }: { card: ProgressCard }) => (
  <Surface
    className={`flex flex-col gap-3 ${card.movesWith === "you" ? "keyline-move" : ""}`}
    data-testid="progress-card"
  >
    <div className="min-w-0">
      <p className="eyebrow">Progress</p>
      <p className="display truncate text-lg font-bold text-ink">
        {card.customerName ?? card.title}
      </p>
      {card.customerName && <p className="truncate text-sm text-ink-secondary">{card.title}</p>}
    </div>
    <PipelineStepper stages={card.stages} />
    <div className="flex flex-col gap-1 border-t border-line pt-3 text-sm">
      <p className="text-ink-secondary">{card.nextStep}</p>
      <InlineLink href={`/jobs/${card.jobId}`}>Open the job</InlineLink>
    </div>
  </Surface>
);

// Who owes what, as of when it was asked. A snapshot, and it says so.
export const MoneyCardView = ({ card }: { card: MoneyCard }) => (
  <Surface className="flex flex-col gap-3" data-testid="money-card">
    <div className="flex items-baseline justify-between gap-3">
      <p className="eyebrow">Owed to you</p>
      <p className="text-xs text-ink-secondary">As of {formatDate(card.asOf)}</p>
    </div>
    {card.owedBy.length === 0 ? (
      <p className="text-sm text-ink">You&apos;re all square. Nobody owes you anything.</p>
    ) : (
      <>
        <Money amount={card.owed} size="hero" data-testid="money-card-owed" />
        <ul className="flex flex-col divide-y divide-line border-y border-line">
          {card.owedBy.map((row, index) => (
            <li key={index} className="flex items-baseline justify-between gap-3 py-2">
              <span className="min-w-0 truncate text-sm text-ink">{row.customerName}</span>
              <Money amount={row.amount} className="shrink-0" />
            </li>
          ))}
          {card.moreOwedBy > 0 && (
            <li className="py-2 text-xs text-ink-secondary">+ {card.moreOwedBy} more</li>
          )}
        </ul>
      </>
    )}
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-sm text-ink-secondary">Safe to spend</span>
      <Money amount={card.safeToSpend} size="total" />
    </div>
  </Surface>
);
