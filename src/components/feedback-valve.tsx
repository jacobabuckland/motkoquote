"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { logClientError } from "@/lib/errors-client";

// Public / unauthenticated surfaces the valve must never appear on. Contractor
// screens (everything else behind auth) get it.
const HIDDEN_PREFIXES = ["/q/", "/c/", "/i/", "/login", "/signup", "/auth"];

export const FeedbackValve = () => {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">(
    "idle",
  );

  const hidden =
    !pathname || HIDDEN_PREFIXES.some((p) => pathname === p || pathname.startsWith(p));
  if (hidden) return null;

  const close = () => {
    setOpen(false);
    setStatus("idle");
    setMessage("");
  };

  const submit = async () => {
    const trimmed = message.trim();
    if (!trimmed) return;
    setStatus("sending");
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed, path: pathname }),
      });
      setStatus(res.ok ? "sent" : "error");
    } catch (error) {
      logClientError("feedback_valve", error);
      setStatus("error");
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-40 rounded-full border border-border bg-surface px-4 py-2 text-sm font-medium text-foreground shadow-md hover:bg-surface-hover"
      >
        Spotted a problem?
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40">
          <div
            className="absolute inset-0"
            onClick={close}
            aria-hidden="true"
          />
          <div className="relative z-10 w-full max-w-md rounded-t-lg bg-surface p-5 shadow-lg">
            {status === "sent" ? (
              <div className="flex flex-col gap-4">
                <p className="text-sm">
                  Got it — thanks. Jacob reads every one of these.
                </p>
                <Button onClick={close}>Close</Button>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <h2 className="text-base font-semibold">Spotted a problem?</h2>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="What happened? Rough and quick is fine."
                  rows={4}
                  className="w-full resize-none rounded-sm border border-border bg-background p-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                />
                {status === "error" && (
                  <p className="text-sm text-error">
                    Couldn&apos;t send that — try again.
                  </p>
                )}
                <div className="flex justify-end gap-2">
                  <Button variant="tertiary" onClick={close}>
                    Cancel
                  </Button>
                  <Button
                    onClick={() => void submit()}
                    disabled={status === "sending" || !message.trim()}
                  >
                    {status === "sending" ? "Sending…" : "Send"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
};
