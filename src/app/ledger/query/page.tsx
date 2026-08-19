"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { classifyMicError, type MicFailureKind } from "@/lib/mic";
import { MicExplainer, MicFailureScreen } from "@/components/voice/mic-permission-screen";
import {
  getOwedToYou,
  getYouOwe,
  getYouOweCounterparty,
  getJobProfit,
  getWhatsLeft,
} from "@/app/ledger/query-actions";

type CallState =
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "finishing"
  | "error";

type TranscriptEntry = {
  id: string;
  role: "assistant" | "user";
  text: string;
};

/**
 * Voice ledger query page.
 *
 * Listens for ONE question about money (what am I owed, what do I owe, etc.),
 * speaks the answer, and closes.
 *
 * Route: /ledger/query
 */
export default function LedgerQueryPage() {
  const router = useRouter();
  const [callState, setCallState] = useState<CallState>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [micActive, setMicActive] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [micFailure, setMicFailure] = useState<MicFailureKind | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const endedRef = useRef(false);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const contractorIdRef = useRef<string | null>(null);

  const cleanup = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    dcRef.current?.close();
    pcRef.current?.close();
  };

  const finishSession = () => {
    if (endedRef.current) return;
    endedRef.current = true;
    setCallState("finishing");
    cleanup();
    // Navigate back to dashboard after a brief delay
    setTimeout(() => {
      router.push("/jobs");
    }, 1000);
  };

  const appendTranscriptDelta = (role: TranscriptEntry["role"], id: string, delta: string) => {
    if (!delta) return;
    setTranscript((prev) => {
      const existing = prev.find((entry) => entry.id === id);
      if (existing) {
        return prev.map((entry) =>
          entry.id === id ? { ...entry, text: entry.text + delta } : entry,
        );
      }
      return [...prev, { id, role, text: delta }];
    });
  };

  const finalizeTranscriptEntry = (id: string, finalText: string) => {
    if (!finalText) return;
    setTranscript((prev) =>
      prev.some((entry) => entry.id === id)
        ? prev.map((entry) => (entry.id === id ? { ...entry, text: finalText } : entry))
        : [...prev, { id, role: "assistant", text: finalText }],
    );
  };

  const addTranscriptEntry = (role: TranscriptEntry["role"], id: string, text: string) => {
    if (!text) return;
    setTranscript((prev) => [...prev, { id, role, text }]);
  };

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [transcript]);

  const handleToolCall = async (name: string, callId: string, argsJson: string) => {
    const dc = dcRef.current;
    const contractorId = contractorIdRef.current;
    if (!dc || !contractorId) return;

    try {
      let result: unknown = null;

      if (name === "get_owed_to_you") {
        const data = await getOwedToYou(contractorId);
        result = { data };
      } else if (name === "get_you_owe") {
        const data = await getYouOwe(contractorId);
        result = { data };
      } else if (name === "get_you_owe_counterparty") {
        const args = JSON.parse(argsJson) as { counterparty_name: string };
        const data = await getYouOweCounterparty(contractorId, args.counterparty_name);
        result = { data };
      } else if (name === "get_job_profit") {
        const args = JSON.parse(argsJson) as { job_identifier: string };
        try {
          const data = await getJobProfit(contractorId, args.job_identifier);
          result = data;
        } catch (error) {
          // getJobProfit throws "Job not found" when it can't find the job
          // Return this as a structured result so the voice session can say
          // "I couldn't find that job" instead of "That job's not invoiced yet"
          result = {
            error: error instanceof Error ? error.message : "Job not found",
            notFound: true,
          };
        }
      } else if (name === "get_whats_left") {
        const data = await getWhatsLeft(contractorId);
        result = { amount: data };
      }

      // Send the result back to the Realtime session
      dc.send(
        JSON.stringify({
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: callId,
            output: JSON.stringify(result),
          },
        }),
      );
      dc.send(JSON.stringify({ type: "response.create" }));
    } catch (error) {
      // Send error back to the session for unexpected errors
      dc.send(
        JSON.stringify({
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: callId,
            output: JSON.stringify({
              error: error instanceof Error ? error.message : "Unknown error",
            }),
          },
        }),
      );
      dc.send(JSON.stringify({ type: "response.create" }));
    }
  };

  useEffect(() => {
    // Attempt 0 is the pre-permission explainer
    if (attempt === 0) return;

    let cancelled = false;

    const connect = async () => {
      try {
        // Fetch contractor ID first (we need it for tool calls)
        if (!contractorIdRef.current) {
          const { createClient } = await import("@/lib/supabase/client");
          const supabase = createClient();
          const {
            data: { user },
          } = await supabase.auth.getUser();
          if (user) {
            const { data: contractor } = await supabase
              .from("contractors")
              .select("id")
              .eq("owner_user_id", user.id)
              .single();
            if (contractor) {
              contractorIdRef.current = contractor.id;
            }
          }
        }

        // Mint a Realtime session token
        const response = await fetch("/api/ledger/query-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });

        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(
            body.error ?? "Couldn't start the voice session — try again in a moment.",
          );
        }

        const { clientSecret } = (await response.json()) as { clientSecret: string };
        if (cancelled) return;

        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
          });
        } catch (micErr) {
          if (cancelled) return;
          setMicFailure(classifyMicError(micErr));
          setCallState("error");
          return;
        }
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;

        const pc = new RTCPeerConnection();
        pcRef.current = pc;
        stream.getTracks().forEach((track) => pc.addTrack(track, stream));

        const remoteAudio = new Audio();
        remoteAudio.autoplay = true;
        pc.ontrack = (event) => {
          remoteAudio.srcObject = event.streams[0] ?? null;
        };

        const dc = pc.createDataChannel("oai-events");
        dcRef.current = dc;

        dc.onopen = () => {
          setCallState("listening");
          // Trigger opening assistant turn
          dc.send(JSON.stringify({ type: "response.create" }));
        };

        dc.onmessage = (event) => {
          const data = JSON.parse(event.data) as {
            type: string;
            item_id?: string;
            delta?: string;
            transcript?: string;
            name?: string;
            call_id?: string;
            arguments?: string;
          };

          if (data.type === "input_audio_buffer.speech_started") {
            setCallState("listening");
            setMicActive(true);
          } else if (data.type === "input_audio_buffer.speech_stopped") {
            setMicActive(false);
          } else if (data.type === "response.created") {
            setCallState("thinking");
          } else if (data.type === "response.output_audio.delta") {
            setCallState("speaking");
          } else if (data.type === "response.output_audio_transcript.delta") {
            appendTranscriptDelta("assistant", data.item_id ?? "assistant", data.delta ?? "");
          } else if (data.type === "response.output_audio_transcript.done") {
            finalizeTranscriptEntry(data.item_id ?? "assistant", data.transcript ?? "");
          } else if (
            data.type === "conversation.item.input_audio_transcription.completed"
          ) {
            addTranscriptEntry("user", data.item_id ?? crypto.randomUUID(), data.transcript ?? "");
          } else if (data.type === "response.function_call_arguments.done") {
            void handleToolCall(data.name ?? "", data.call_id ?? "", data.arguments ?? "{}");
          } else if (data.type === "response.done") {
            setCallState((prev) => (prev === "finishing" ? prev : "listening"));
          }
        };

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        const sdpResponse = await fetch("https://api.openai.com/v1/realtime/calls", {
          method: "POST",
          body: offer.sdp,
          headers: {
            Authorization: `Bearer ${clientSecret}`,
            "Content-Type": "application/sdp",
          },
        });

        if (!sdpResponse.ok) {
          throw new Error("Couldn't connect the live call — try again.");
        }

        const answerSdp = await sdpResponse.text();
        await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof Error
            ? err.message
            : "We couldn't start the call — check your microphone permissions and try again.",
        );
        setCallState("error");
      }
    };

    void connect();

    return () => {
      cancelled = true;
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  const retry = () => {
    window.location.reload();
  };

  const startCall = () => {
    setError(null);
    setMicFailure(null);
    setCallState("connecting");
    setAttempt((n) => n + 1);
  };

  const goBack = () => {
    router.push("/jobs");
  };

  const toggleMute = () => {
    const stream = streamRef.current;
    if (!stream) return;
    const next = !muted;
    stream.getAudioTracks().forEach((track) => {
      track.enabled = !next;
    });
    setMuted(next);
  };

  const statusLabel: Record<CallState, string> = {
    connecting: "Connecting…",
    listening: "Listening — ask about money",
    thinking: "Thinking…",
    speaking: "Speaking…",
    finishing: "Done",
    error: "Something went wrong",
  };

  const header = (
    <PageHeader
      backHref="/jobs"
      backLabel="Back to dashboard"
    />
  );

  if (attempt === 0 || micFailure) {
    return (
      <div className="flex flex-1 flex-col">
        {header}
        <main className="flex flex-1 flex-col items-center justify-center gap-6 p-6">
          {micFailure ? (
            <MicFailureScreen
              kind={micFailure}
              onRetry={startCall}
              onManual={goBack}
              manualLabel="Back to dashboard"
            />
          ) : (
            <MicExplainer
              intro="Ask me one question about money: what you're owed, what you owe, what a job made, or what's left. I'll speak the answer and close."
              startLabel="Start voice query"
              starting={false}
              onStart={startCall}
              onManual={goBack}
              manualLabel="Back to dashboard"
            />
          )}
        </main>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      {header}

      <main className="flex flex-1 flex-col items-center justify-center gap-6 p-6">
        <div className="flex w-full max-w-sm flex-col items-center gap-6">
          <div className="flex flex-col items-center gap-2 text-center">
            <h1 className="text-2xl font-semibold">Ask about money</h1>
            <p className="text-sm text-text-secondary">{statusLabel[callState]}</p>
          </div>

          <div className="flex items-center gap-3">
            <div
              className={`flex h-20 w-20 items-center justify-center rounded-full text-sm font-medium text-accent-foreground ${
                callState === "speaking" || callState === "listening"
                  ? "bg-accent"
                  : "bg-accent/50"
              } ${micActive ? "animate-pulse ring-4 ring-accent/40" : ""}`}
              aria-live="polite"
            >
              {callState === "connecting" || callState === "finishing" ? "…" : "Live"}
            </div>
          </div>

          {(callState === "listening" || callState === "speaking" || callState === "thinking") && (
            <div className="flex flex-col items-center gap-3">
              <button
                type="button"
                onClick={toggleMute}
                className="inline-flex min-h-11 items-center text-sm font-medium text-accent underline underline-offset-4 hover:text-accent-hover"
              >
                {muted ? "Unmute" : "Mute"}
              </button>
              <button
                type="button"
                onClick={finishSession}
                className="inline-flex min-h-11 items-center text-sm font-medium text-text-secondary underline underline-offset-4"
              >
                Done
              </button>
              <Link
                href="/jobs"
                className="inline-flex min-h-11 items-center text-sm font-medium text-text-secondary underline underline-offset-4"
              >
                Back to dashboard
              </Link>
            </div>
          )}

          {transcript.length > 0 && (
            <Card className="flex w-full flex-col gap-2">
              <h2 className="text-xs font-medium uppercase tracking-wide text-text-secondary">
                Conversation
              </h2>
              <div className="flex max-h-56 flex-col gap-2 overflow-y-auto text-sm">
                {transcript.map((entry) => (
                  <p
                    key={entry.id}
                    className={
                      entry.role === "assistant"
                        ? "text-text-secondary"
                        : "font-medium text-foreground"
                    }
                  >
                    <span className="font-medium">
                      {entry.role === "assistant" ? "Motko: " : "You: "}
                    </span>
                    {entry.text}
                  </p>
                ))}
                <div ref={transcriptEndRef} />
              </div>
            </Card>
          )}

          {error && (
            <div className="flex flex-col items-center gap-2 text-center">
              <p className="text-sm text-error">{error}</p>
              <button
                type="button"
                onClick={retry}
                className="inline-flex min-h-11 items-center text-sm font-medium text-accent underline underline-offset-4 hover:text-accent-hover"
              >
                Try again
              </button>
              <Link
                href="/jobs"
                className="inline-flex min-h-11 items-center text-sm font-medium text-text-secondary underline underline-offset-4"
              >
                Back to dashboard
              </Link>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
