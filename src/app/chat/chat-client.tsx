"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
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
import { ConfirmCardView, liveQuoteCardId, QuoteCardView, QuoteSummaryLine } from "./chat-cards";

const NEEDS_YOU_LABEL = "Needs you";

export const ChatClient = ({
  initialThreadId,
  initialMessages,
  attention,
}: {
  initialThreadId: string | null;
  initialMessages: ChatMessageView[];
  attention: AttentionItem[];
}) => {
  const [threadId, setThreadId] = useState<string | null>(initialThreadId);
  const [messages, setMessages] = useState<ChatMessageView[]>(initialMessages);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [messages, busy]);

  const ask = useCallback((prefill: string) => {
    setText(prefill);
    inputRef.current?.focus();
  }, []);

  // The LAST card for each quote, in thread order, is the live one. Every
  // earlier card for the same quote is history and renders as a summary line.
  const liveCardAt = new Map<string, string>();
  messages.forEach((message) =>
    message.cards.forEach((card, index) => {
      if (card.type === "quote") liveCardAt.set(card.jobId, `${message.id}:${index}`);
    }),
  );

  const append = (more: ChatMessageView[]) => setMessages((current) => [...current, ...more]);

  const CALM_ERROR = "That didn't go through. Nothing has been sent. Try again in a moment.";

  // Every server call goes through here: busy is always released, and a
  // rejected action becomes a visible message rather than a stuck screen.
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch {
      setError(CALM_ERROR);
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setText("");
    const optimistic: ChatMessageView = {
      id: `local-${Date.now()}`,
      role: "user",
      content: trimmed,
      cards: [],
      createdAt: new Date().toISOString(),
    };
    append([optimistic]);
    await run(async () => {
      try {
        const result = await sendChatMessage({ threadId, text: trimmed });
        if (result.ok) {
          if (result.threadId) setThreadId(result.threadId);
          // Replace the optimistic bubble with the stored pair.
          setMessages((current) => [
            ...current.filter((message) => message.id !== optimistic.id),
            ...result.messages,
          ]);
        } else {
          setError(result.error);
          setMessages((current) => current.filter((message) => message.id !== optimistic.id));
          setText(trimmed);
        }
      } catch (error) {
        setMessages((current) => current.filter((message) => message.id !== optimistic.id));
        setText(trimmed);
        throw error;
      }
    });
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

  const onConfirmSlot = (jobId: string, slot: AssumptionSlot, expectedValue: string) =>
    run(async () => {
      const result = await confirmAssumption({ jobId, slot, expectedValue });
      patchQuoteCards(result.card);
      if (!result.ok) setError(result.error);
    });

  const onSend = (jobId: string) =>
    run(async () => {
      if (!threadId) return;
      const result = await proposeSendQuoteFromCard({ threadId, jobId });
      if (result.ok) append(result.messages);
      else setError(result.error);
    });

  const onConfirm = async (card: ConfirmCard) => {
    setError(null);
    try {
      const result = await confirmPendingAction({
        threadId: card.threadId,
        pendingId: card.pendingActionId,
      });
      if (!result.ok) {
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
      setError(CALM_ERROR);
    }
  };

  return (
    <div className="flex flex-1 flex-col gap-3">
      {attention.length > 0 && (
        <section
          aria-label={NEEDS_YOU_LABEL}
          className="rounded-card border border-line-strong bg-amber-tint p-3"
        >
          <p className="eyebrow mb-1 text-amber">
            {NEEDS_YOU_LABEL} ({attention.length})
          </p>
          <ul className="flex flex-col">
            {attention.slice(0, 5).map((item) => (
              <li key={item.jobId}>
                <Link
                  href={`/jobs/${item.jobId}`}
                  className="flex min-h-11 flex-col justify-center text-sm text-ink"
                >
                  <span className="font-semibold">
                    {item.customer ? `${item.customer}: ` : ""}
                    {item.title}
                  </span>
                  <span className="text-ink-secondary">{item.why}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex flex-1 flex-col gap-3 pb-4" aria-live="polite">
        {messages.length === 0 && (
          <p className="py-8 text-center text-sm text-ink-secondary">
            Tell me about a job and I&apos;ll draft the quote. Try &ldquo;quote Dave, 3 days
            rewiring the kitchen&rdquo;.
          </p>
        )}
        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex flex-col gap-2 ${message.role === "user" ? "items-end" : "items-start"}`}
          >
            {message.content && (
              <p
                className={`max-w-[85%] whitespace-pre-wrap rounded-card px-3 py-2 text-sm ${
                  message.role === "user"
                    ? "bg-green text-white"
                    : "border border-line-strong bg-card text-ink"
                }`}
              >
                {message.content}
              </p>
            )}
            {message.link && (
              <Link href={message.link} className="inline-flex min-h-11 items-center text-sm font-semibold text-green underline underline-offset-4">
                View the job
              </Link>
            )}
            {message.cards.map((card, index) =>
              card.type === "quote" && liveCardAt.get(card.jobId) !== `${message.id}:${index}` ? (
                <div key={index} className="w-full">
                  <QuoteSummaryLine card={card} />
                </div>
              ) : card.type === "quote" ? (
                <div key={index} id={liveQuoteCardId(card.jobId)} className="w-full">
                  <QuoteCardView
                    card={card}
                    busy={busy}
                    onConfirmSlot={onConfirmSlot}
                    onSend={onSend}
                    onAsk={ask}
                  />
                </div>
              ) : (
                <div key={index} className="w-full">
                  <ConfirmCardView card={card} busy={busy} onConfirm={onConfirm} />
                </div>
              ),
            )}
          </div>
        ))}
        {busy && <p className="text-sm text-ink-secondary">Thinking…</p>}
        <div ref={endRef} />
      </div>

      <form
        className="sticky bottom-0 -mx-5 flex flex-col gap-2 border-t border-line-strong bg-ground px-5 pb-safe pt-3"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {error && (
          <p role="alert" className="text-sm text-red">
            {error}
          </p>
        )}
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void submit();
              }
            }}
            aria-label="Message Motko"
            placeholder="Message Motko"
            rows={1}
            maxLength={2000}
            className="min-h-11 flex-1 resize-none rounded-control border border-line-strong bg-card px-3 py-2.5 text-sm text-ink"
          />
          <button
            type="button"
            disabled
            aria-label="Voice is coming soon"
            title="Voice is coming soon"
            className="inline-flex h-11 min-w-11 items-center justify-center rounded-sm border border-line-strong bg-muted-fill px-3 text-xs font-semibold text-muted-ink"
          >
            Voice soon
          </button>
          <Button type="submit" aria-label="Send message" disabled={busy || text.trim().length === 0}>
            Send
          </Button>
        </div>
      </form>
    </div>
  );
};
