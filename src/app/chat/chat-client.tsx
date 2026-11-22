"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { InlineLink } from "@/components/ui/inline-link";
import { error as errorHaptic, select as selectHaptic, success as successHaptic, tap as tapHaptic } from "@/lib/haptics";
import type { AttentionItem } from "@/lib/pa/needs-attention";
import type { ChatMessageView } from "@/lib/pa/service";
import type { AssumptionSlot, Card, ConfirmCard } from "@/lib/pa/types";
import {
  confirmAssumption,
  confirmPendingAction,
  proposeSendQuoteFromCard,
  reloadChat,
  sendChatMessage,
} from "./actions";
import { ConfirmCardView, QuoteCardView } from "./chat-cards";
import { Composer } from "./chat-composer";
import { LedgerStrip, YourMove } from "./ledger-strip";

// A message as the thread holds it. `fresh` marks one that arrived during this
// visit, so it settles in once; history that was already there never animates.
// `clientKey` keeps a bubble's identity when the optimistic copy is swapped for
// the stored one, so it does not remount and replay.
type ThreadMessage = ChatMessageView & { fresh?: boolean; clientKey?: string };

// The current day as the browser sees it, and nothing at all on the server or
// during hydration: a day label depends on the reader's time zone, so rendering
// it on the server would disagree with the client and trigger a mismatch.
let clientNow: number | null = null;
const subscribeNever = () => () => {};
const readClientNow = () => (clientNow ??= Date.now());
const useClientNow = (): number | null => useSyncExternalStore(subscribeNever, readClientNow, () => null);

const dayStart = (ms: number): number => {
  const date = new Date(ms);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
};

const dayLabel = (iso: string, now: number): string => {
  const at = new Date(iso).getTime();
  const days = Math.round((dayStart(now) - dayStart(at)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return new Date(at).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
};

const STARTERS: { label: string; text: string; send: boolean }[] = [
  { label: "Quote a job", text: "Quote ", send: false },
  { label: "What needs me?", text: "What needs me?", send: true },
  { label: "Who owes me?", text: "Who owes me money?", send: true },
];

const CALM_ERROR = "That didn't go through. Nothing has been sent. Try again in a moment.";

export const ChatClient = ({
  initialThreadId,
  initialMessages,
  attention,
  owed = null,
}: {
  initialThreadId: string | null;
  initialMessages: ChatMessageView[];
  attention: AttentionItem[];
  owed?: number | null;
}) => {
  const [threadId, setThreadId] = useState<string | null>(initialThreadId);
  const [messages, setMessages] = useState<ThreadMessage[]>(initialMessages);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const now = useClientNow();

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [messages, working]);

  const ask = useCallback((prefill: string) => {
    setText(prefill);
    inputRef.current?.focus();
  }, []);

  const append = (more: ChatMessageView[]) =>
    setMessages((current) => [...current, ...more.map((message) => ({ ...message, fresh: true }))]);

  // Every server call goes through here: busy is always released, and a
  // rejected action becomes a visible message rather than a stuck screen.
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch {
      errorHaptic();
      setError(CALM_ERROR);
    } finally {
      setBusy(false);
    }
  };

  const send = async (raw: string, restore: (value: string) => void) => {
    const trimmed = raw.trim();
    if (!trimmed || busy) return;
    const optimistic: ThreadMessage = {
      id: `local-${Date.now()}`,
      role: "user",
      content: trimmed,
      cards: [],
      createdAt: new Date().toISOString(),
      fresh: true,
    };
    setMessages((current) => [...current, optimistic]);
    setWorking(true);
    await run(async () => {
      try {
        const result = await sendChatMessage({ threadId, text: trimmed });
        if (result.ok) {
          if (result.threadId) setThreadId(result.threadId);
          // Replace the optimistic bubble with the stored pair, keeping the
          // bubble's identity so it does not remount and settle a second time.
          const [stored, ...rest] = result.messages;
          setMessages((current) => [
            ...current.filter((message) => message.id !== optimistic.id),
            ...(stored ? [{ ...stored, fresh: true, clientKey: optimistic.id }] : []),
            ...rest.map((message) => ({ ...message, fresh: true })),
          ]);
        } else {
          errorHaptic();
          setError(result.error);
          setMessages((current) => current.filter((message) => message.id !== optimistic.id));
          restore(trimmed);
        }
      } catch (failure) {
        setMessages((current) => current.filter((message) => message.id !== optimistic.id));
        restore(trimmed);
        throw failure;
      } finally {
        setWorking(false);
      }
    });
  };

  // A primary Button already taps when it is pressed, so only the keyboard's
  // Return key, which is no button, needs to do it here.
  const submit = async (viaKeyboard: boolean) => {
    if (!text.trim() || busy) return;
    if (viaKeyboard) tapHaptic();
    const typed = text;
    setText("");
    await send(typed, setText);
  };

  // A starter, a tap on the ledger or a row's "Ask Motko": none of them is a
  // primary Button, so each taps here. Sent as it stands, leaving whatever is in
  // the composer alone.
  const sendNow = (message: string) => {
    tapHaptic();
    return send(message, () => {});
  };

  const refreshThread = async (
    id: string,
    links: Map<string, string | undefined> = new Map(),
  ) => {
    const fresh = await reloadChat({ threadId: id });
    if (fresh.ok) {
      setMessages(fresh.messages.map((m) => (links.has(m.id) ? { ...m, link: links.get(m.id) } : m)));
    }
  };

  const patchQuoteCards = (card: Card | null | undefined) => {
    if (!card || card.type !== "quote") return;
    setMessages((current) =>
      current.map((message) => ({
        ...message,
        cards: message.cards.map((existing) =>
          existing.type === "quote" && existing.jobId === card.jobId ? card : existing,
        ),
      })),
    );
  };

  const onConfirmSlot = (jobId: string, slot: AssumptionSlot, expectedValue: string) => {
    selectHaptic();
    return run(async () => {
      const result = await confirmAssumption({ jobId, slot, expectedValue });
      patchQuoteCards(result.card);
      if (!result.ok) {
        errorHaptic();
        setError(result.error);
      }
    });
  };

  const onSend = (jobId: string) =>
    run(async () => {
      if (!threadId) return;
      const result = await proposeSendQuoteFromCard({ threadId, jobId });
      if (result.ok) append(result.messages);
      else {
        errorHaptic();
        setError(result.error);
      }
    });

  const onConfirm = async (card: ConfirmCard) => {
    setError(null);
    try {
      const result = await confirmPendingAction({
        threadId: card.threadId,
        pendingId: card.pendingActionId,
      });
      if (!result.ok) {
        errorHaptic();
        setError(result.error);
        // A refused or interrupted confirm has been SPENT on the server. Re-read
        // the thread so the card shows what really happened rather than staying
        // tappable, or being marked done by a later tap.
        try {
          await refreshThread(card.threadId);
        } catch {
          // The error above already says it didn't go through.
        }
        return;
      }
      successHaptic();
      append(result.messages);
      // Mark spent locally, then re-read so quote cards drop their Send button.
      setMessages((current) =>
        current.map((message) => ({
          ...message,
          cards: message.cards.map((existing) =>
            existing.type === "confirm" && existing.pendingActionId === card.pendingActionId
              ? { ...existing, state: "done" as const }
              : existing,
          ),
        })),
      );
      // Links aren't stored with a message; keep the one this confirm returned.
      await refreshThread(
        card.threadId,
        new Map(result.messages.filter((m) => m.link).map((m) => [m.id, m.link])),
      );
    } catch {
      errorHaptic();
      setError(CALM_ERROR);
    }
  };

  const empty = messages.length === 0;

  return (
    <div className="flex flex-1 flex-col gap-4">
      <LedgerStrip owed={owed} compact={!empty} onAsk={sendNow} />
      <YourMove items={attention} onAsk={sendNow} />

      {empty && (
        // An invitation, left-aligned, in the voice of the rest of the product.
        <section className="flex flex-col gap-3 py-2" aria-label="Start a conversation">
          <p className="eyebrow">Motko</p>
          <p className="display text-2xl font-bold text-ink">What&apos;s on today?</p>
          <p className="text-sm text-ink-secondary">
            Tell me about a job and I&apos;ll price it from your rates. Nothing goes to a customer
            until you tap.
          </p>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Things to try">
            {STARTERS.map((starter) => (
              <button
                key={starter.label}
                type="button"
                disabled={busy}
                onClick={() => {
                  if (starter.send) {
                    void sendNow(starter.text);
                  } else {
                    selectHaptic();
                    ask(starter.text);
                  }
                }}
                className="inline-flex min-h-11 items-center rounded-card border border-line-strong bg-card px-3 text-sm text-ink transition-colors duration-150 active:bg-card-hover"
              >
                {starter.label}
              </button>
            ))}
          </div>
        </section>
      )}

      <div className="flex flex-1 flex-col gap-1 pb-4" aria-live="polite">
        {messages.map((message, index) => {
          const previous = messages[index - 1];
          const startsGroup = !previous || previous.role !== message.role;
          const newDay =
            now !== null &&
            (!previous || dayStart(new Date(previous.createdAt).getTime()) !== dayStart(new Date(message.createdAt).getTime()));
          return (
            <div key={message.clientKey ?? message.id} className="flex flex-col">
              {newDay && now !== null && (
                <p className="eyebrow mt-3 mb-1 border-b border-line pb-1">{dayLabel(message.createdAt, now)}</p>
              )}
              <div
                className={`flex flex-col gap-2 ${startsGroup && index > 0 ? "mt-3" : ""} ${
                  message.role === "user" ? "items-end" : "items-start"
                } ${message.fresh ? "animate-ledger" : ""}`}
              >
                {startsGroup && message.role === "assistant" && <p className="eyebrow">Motko</p>}
                {message.content &&
                  (message.role === "user" ? (
                    <p className="max-w-[85%] whitespace-pre-wrap rounded-card bg-green px-3 py-2 text-sm text-white">
                      {message.content}
                    </p>
                  ) : (
                    // Motko's own words carry no box. The cards below are what
                    // the eye should find; the talk stays light.
                    <p className="max-w-[92%] whitespace-pre-wrap text-sm leading-relaxed text-ink">
                      {message.content}
                    </p>
                  ))}
                {message.link && <InlineLink href={message.link}>View the job</InlineLink>}
                {message.cards.map((card, cardIndex) => (
                  <div key={cardIndex} className="w-full">
                    {card.type === "quote" ? (
                      <QuoteCardView
                        card={card}
                        busy={busy}
                        onConfirmSlot={onConfirmSlot}
                        onSend={onSend}
                        onAsk={ask}
                      />
                    ) : (
                      <ConfirmCardView card={card} busy={busy} onConfirm={onConfirm} />
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
        {working && (
          <div role="status" className="mt-3 flex items-center gap-2 text-sm text-ink-secondary">
            <span className="flex gap-1" aria-hidden>
              {[0, 1, 2].map((dot) => (
                <span
                  key={dot}
                  className="h-1.5 w-1.5 animate-pulse rounded-full bg-green"
                  style={{ animationDelay: `${dot * 160}ms` }}
                />
              ))}
            </span>
            <span>On it…</span>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <Composer
        value={text}
        onChange={setText}
        onSubmit={(viaKeyboard) => void submit(viaKeyboard)}
        busy={busy}
        error={error}
        inputRef={inputRef}
      />
    </div>
  );
};
