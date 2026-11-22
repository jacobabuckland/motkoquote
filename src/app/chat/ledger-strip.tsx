"use client";

import { useState } from "react";
import { Money } from "@/components/ui/money";
import { PipelineRow } from "@/components/ui/pipeline-row";
import { formatGBP } from "@/lib/format";
import type { AttentionItem } from "@/lib/pa/needs-attention";

// The ledger figure, at the head of the thread. It is the same signature
// element as the dashboard's: the amount that matters, set large in the display
// face on the paper ground, settling once on load. Tapping it asks Motko who
// owes what, so the figure is a door into the conversation rather than a banner.
//
// Compact once a conversation is under way: the thread is the point by then.
export const LedgerStrip = ({
  owed,
  compact,
  onAsk,
}: {
  owed: number | null;
  compact: boolean;
  onAsk: (text: string) => void;
}) => {
  if (owed === null) return null;
  const owing = owed > 0;
  return (
    <button
      type="button"
      onClick={() => onAsk("Who owes me money?")}
      aria-label={
        owing
          ? `${formatGBP(owed)} owed to you. Tap to see who owes you.`
          : `You're all square. Nothing outstanding.`
      }
      className="animate-ledger flex min-h-11 w-full flex-col items-start gap-1 border-b border-line-strong pb-3 text-left transition-colors duration-150 active:bg-card-hover"
    >
      {owing ? (
        <>
          <Money amount={owed} size={compact ? "total" : "hero"} />
          <span className="text-sm text-ink-secondary">owed to you. Tap to see who.</span>
        </>
      ) : (
        <>
          <span className={`display font-bold ${compact ? "text-2xl" : "text-3xl"}`}>
            You&apos;re all square
          </span>
          <span className="text-sm text-ink-secondary">Nothing outstanding.</span>
        </>
      )}
    </button>
  );
};

const SHOWN = 3;

// Jobs where the next move is the contractor's, as the dashboard's rows with the
// amber keyline: the one mark that lets you see your own work first.
export const YourMove = ({
  items,
  onAsk,
}: {
  items: AttentionItem[];
  onAsk: (text: string) => void;
}) => {
  const [all, setAll] = useState(false);
  if (items.length === 0) return null;
  const visible = all ? items : items.slice(0, SHOWN);
  return (
    <section aria-label="Your move" className="flex flex-col gap-2">
      <p className="eyebrow">Your move ({items.length})</p>
      <ul className="flex flex-col gap-2">
        {visible.map((item) => {
          const who = item.customer ?? item.title;
          return (
            <li key={item.jobId}>
              <PipelineRow
                customerName={who}
                href={`/jobs/${item.jobId}`}
                descriptor={item.why}
                yourMove
                action={
                  <button
                    type="button"
                    onClick={() => onAsk(`What's next on the ${who} job?`)}
                    className="inline-flex min-h-11 items-center text-sm font-semibold text-green active:text-green-hover"
                  >
                    Ask Motko
                  </button>
                }
              />
            </li>
          );
        })}
      </ul>
      {items.length > SHOWN && (
        <button
          type="button"
          onClick={() => setAll((open) => !open)}
          className="inline-flex min-h-11 items-center self-start text-sm font-semibold text-green"
        >
          {all ? "Show fewer" : `Show ${items.length - SHOWN} more`}
        </button>
      )}
    </section>
  );
};
