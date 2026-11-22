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
import { ConfirmCardView, QuoteCardView } from "./chat-cards";

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

  const append = (more: ChatMessageView[]) => setMessages((current) => [...current, ...more]);

  const submit = async () => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    setText("");
    const optimistic: ChatMessageView = {
      id: `local-${Date.now()}`,
      role: "user",
      content: trimmed,
      cards: [],
      createdAt: new Date().toISOString(),
    };
    append([optimistic]);
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
    setBusy(false);
  };

  const patchQuoteCards = (card: Card | null) => {
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

  const onConfirmSlot = async (jobId: string, slot: AssumptionSlot) => {
    setBusy(true);
    setError(null);
    const result = await confirmAssumption({ jobId, slot });
    if (result.ok) patchQuoteCards(result.card);
    else setError(result.error);
    setBusy(false);
  };

  const onSend = async (jobId: string) => {
    if (!threadId) return;
    setBusy(true);
    setError(null);
    const result = await proposeSendQuoteFromCard({ threadId, jobId });
    if (result.ok) append(result.messages);
    else setError(result.error);
    setBusy(false);
  };

  const onConfirm = async (card: ConfirmCard) => {
    setError(null);
    const result = await confirmPendingAction({
      threadId: card.threadId,
      pendingId: card.pendingActionId,
    });
    if (result.ok) {
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
      const fresh = await reloadChat({ threadId: card.threadId });
      if (fresh.ok) setMessages(fresh.messages);
    } else {
      setError(result.error);
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
              card.type === "quote" ? (
                <div key={index} className="w-full">
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
