"use client";

import { useLayoutEffect, type RefObject } from "react";
import { Button } from "@/components/ui/button";
import { MicIcon, SendIcon } from "./chat-icons";

const MAX_HEIGHT_PX = 144;

// The input bar. It grows with what you type, up to about six lines, then
// scrolls. Send is an icon button so the bar stays one tidy row; the mic is
// present and quiet because voice is coming, and says so rather than being
// missing or pretending.
export const Composer = ({
  value,
  onChange,
  onSubmit,
  busy,
  error,
  inputRef,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (viaKeyboard: boolean) => void;
  busy: boolean;
  error: string | null;
  inputRef: RefObject<HTMLTextAreaElement | null>;
}) => {
  useLayoutEffect(() => {
    const element = inputRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, MAX_HEIGHT_PX)}px`;
  }, [value, inputRef]);

  return (
    <form
      className="sticky bottom-0 -mx-5 flex flex-col gap-2 border-t border-line-strong bg-ground px-5 pb-safe pt-3"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(false);
      }}
    >
      {error && (
        // A contained panel next to what failed, never loose coloured text.
        <div role="alert" className="rounded-card border border-red bg-red-tint p-3 text-sm text-red">
          {error}
        </div>
      )}
      <div className="flex items-end gap-2">
        <textarea
          ref={inputRef}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              onSubmit(true);
            }
          }}
          aria-label="Message Motko"
          placeholder="Message Motko"
          rows={1}
          maxLength={2000}
          className="max-h-36 min-h-11 flex-1 resize-none rounded-control border border-line-strong bg-card px-3 py-2.5 text-sm text-ink"
        />
        <button
          type="button"
          disabled
          aria-label="Voice is coming soon"
          title="Voice is coming soon"
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-sm border border-line-strong bg-muted-fill text-muted-ink"
        >
          <MicIcon />
        </button>
        <Button
          type="submit"
          aria-label="Send message"
          disabled={busy || value.trim().length === 0}
          className="w-11 shrink-0 px-0"
        >
          <SendIcon />
        </Button>
      </div>
    </form>
  );
};
