"use client";

import { useState } from "react";
import type { CostIntakeAdapter } from "@/components/voice/cost-intake-adapter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";

/**
 * Voice cost capture component.
 *
 * Parallel to JobIntake but scoped to capturing a single cost:
 * - Amount (parsed deterministically from transcript)
 * - Counterparty (who/where)
 * - Category (inferred)
 * - Job (matched)
 *
 * Architecture:
 * - WebRTC connection to OpenAI Realtime API
 * - Live transcript display
 * - Confirmation screen before write
 *
 * This is a simplified implementation that establishes the component structure.
 * Full WebRTC voice flow implementation follows the same pattern as JobIntake.
 */

type CallState = "connecting" | "listening" | "thinking" | "confirming" | "error";

export const CostIntake = ({ adapter }: { adapter: CostIntakeAdapter }) => {
  const [callState, setCallState] = useState<CallState>("connecting");
  const [error] = useState<string | null>(null);
  const [transcript] = useState<string[]>([]);

  // Placeholder implementation — the full WebRTC voice flow would go here,
  // following the same pattern as JobIntake:
  // 1. Request microphone permission
  // 2. Create RTCPeerConnection
  // 3. Connect to OpenAI Realtime API
  // 4. Stream audio and handle tool calls
  // 5. Draft cost from captured data
  // 6. Show confirmation screen
  // 7. Call adapter.complete() on confirmation

  const statusLabel: Record<CallState, string> = {
    connecting: "Connecting…",
    listening: "Listening — tell me about the cost",
    thinking: "Got it — one sec…",
    confirming: "Review and confirm",
    error: "Something went wrong",
  };

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        backHref={adapter.backHref}
        backLabel={adapter.backLabel}
        action={adapter.headerAction}
      />

      <main className="flex flex-1 flex-col items-center justify-center gap-6 p-6">
        {/* Live transcript display */}
        <div
          data-testid="voice-transcript"
          className="w-full max-w-sm rounded-lg border border-border bg-surface p-3 text-sm"
          style={{ maxHeight: "200px", overflowY: "auto" }}
        >
          {transcript.map((line, i) => (
            <div key={i} className="mb-2 last:mb-0">
              {line}
            </div>
          ))}
        </div>

        <div className="flex w-full max-w-sm flex-col items-center gap-6">
          <div className="flex flex-col items-center gap-2 text-center">
            <h1 className="text-2xl font-semibold">Add cost</h1>
            <p className="text-sm text-text-secondary" aria-live="polite">
              {statusLabel[callState]}
            </p>
          </div>

          {callState === "error" && error && (
            <Card className="w-full p-4">
              <p className="text-sm text-error">{error}</p>
            </Card>
          )}

          {/* Placeholder for the voice orb / confirmation UI */}
          <div className="relative flex h-32 w-32 items-center justify-center">
            <div className="relative flex h-20 w-20 items-center justify-center rounded-full bg-accent text-sm font-medium text-accent-foreground">
              {callState === "connecting"
                ? "…"
                : callState === "listening"
                  ? "Listening"
                  : callState === "thinking"
                    ? "Thinking"
                    : "Ready"}
            </div>
          </div>

          {callState === "listening" && (
            <Button
              type="button"
              variant="primary"
              onClick={() => setCallState("confirming")}
              className="w-full"
            >
              Done speaking
            </Button>
          )}
        </div>
      </main>
    </div>
  );
};
